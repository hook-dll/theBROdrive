/**
 * tools/kit-zfight.ts
 *
 * Z-fighting census of the kit cars (src/carkit): faces of different look that lie in
 * one plane and overlap, so the depth buffer cannot tell which is in front.
 *
 *   nice -n 15 bun tools/kit-zfight.ts [--test] [--json out.json] [vaz2101 ...]   (default: every kit car)
 *
 * Each car is built as `tools/kit-proportions.ts` builds it, closed and open (every
 * `kitMotion` channel at 1 through a `KitRig`, so doors, lids and flaps swing and the
 * drop panes sink as in the game). Every triangle carries the src/carkit line that
 * emitted it (`PartBuilder.tri` is wrapped here, at run time only). Pairs: normals within
 * 3° (either facing: every kit slot is double-sided), planes within 6 mm over a
 * positive-area overlap (shared edges do not count). Pairs group into clusters (same two
 * emitters and colours, same band, within 12 cm), kept from 1 cm². A cluster is seen if
 * a line from its overlap reaches one of 37 exterior or 4 cabin viewpoints past every
 * opaque triangle (bay parts are tried with the bonnet open too). It is visible if it is
 * seen and also covers a pixel at the furthest distance its part is drawn (the shell to
 * 700 m, the detail groups to `KIT_DETAIL_M`; 1440 px, 65°), a cabin pair weighted by
 * the glass's see-through (1 − `kitGlassOpacity`). It is never visible if its two sides
 * share slot and vertex colour, if it involves the kit's placeholder wheels (the pack's
 * replace them), or, from the seat, if the cabin's near plane (0.02 m) parts it within
 * the cabin's 3 m (`CABIN_TAU`).
 *
 * Bands, from the scene pass's 24-bit depth at near 0.08 m (a gap g fights beyond
 * d ≈ sqrt(g·near·2^24/2)):
 *   close    gap < 0.15 mm   fights within 10 m: the lab, the chase cam, the cockpit
 *   10-25 m  0.15-0.93 mm
 *   >25 m    0.93-2 mm
 *   far      2-6 mm
 *
 * Shell holes: every outline cut in the shell under an item (`root.userData.kitHoles`)
 * must be covered, from every exterior viewpoint and a close ring, by the shell and the
 * exterior alone (what mid and far traffic bake): a sight line through it must meet an
 * opaque face before it is 2 mm past the hole (`holeSlits`).
 *
 * Prints per car every visible cluster with both emitters (`file:line`) and every open
 * hole; the summary counts them per band. A kit change should leave every visible and
 * slit column at 0. Nothing here is part of the game.
 */

import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { PartBuilder, cutUnder, type KitSlot, type Outline, type Vec3 } from '../src/carkit/builder';
import { buildKitCar } from '../src/carkit/kit';
import { KIT_SPECS } from '../src/carkit/specs';
import { KitRig, KIT_DETAIL_M, KIT_SHUT_GEOMETRY, kitGlassOpacity } from '../src/carkit/rig';

installAssetShim();

// ---------------------------------------------------------------- tolerances
const COS_NORMAL = Math.cos((3 * Math.PI) / 180);
const FIGHT_GAP = 0.002; // m: coplanar within this = z-fight
const FAR_GAP = 0.006; // m: 2-6 mm = far-view risk
const PAIR_MIN_AREA = 2e-6; // m² (0.02 cm²): smallest pair overlap accumulated into a cluster
const CLUSTER_MIN_AREA = 1e-4; // m² (1 cm²): smallest cluster reported
const PAIR_CELL = 0.1; // m, pair hash cell
const RAY_CELL = 0.04; // m, occlusion grid cell
const DEPTH_NEAR = 0.08; // CAMERA_NEAR, core/renderer.ts; 24-bit depth (UnsignedIntType DepthTexture)
/**
 * Two surfaces `gap` apart fight once their window depths fall within ~2 steps of a
 * 24-bit buffer: Δdepth ≈ gap·near/d², so they fight beyond d = sqrt(gap·near·2^24/2).
 */
const fightDistance = (gap: number): number => Math.sqrt((gap * DEPTH_NEAR * 2 ** 24) / 2);
const gapFightingAt = (d: number): number => (2 * d * d) / (DEPTH_NEAR * 2 ** 24);
/** Band edges: fights within 10 m (lab, chase cam, cockpit), within 25 m (cabin LOD), 2 mm, 6 mm. */
const TAUS = [gapFightingAt(10), gapFightingAt(25), FIGHT_GAP, FAR_GAP];
/**
 * What a fight must cover to be seen: its fighting overlap, where the depth first gives
 * way and beyond, at least MIN_FIGHT_PX pixels on a 1440-line frame at the default 65°
 * (config/gameplay.json). Past that distance the overlap keeps fighting but only shrinks.
 * The detail groups (cabin, bay, boot, underbody) are not drawn beyond `KIT_DETAIL_M`;
 * the shell is, out to the far traffic's reach.
 */
const SCREEN_H = 1440;
const FOV_Y = (65 * Math.PI) / 180;
const MIN_FIGHT_PX = 1;
const SHELL_DRAW_M = 700;
const pxPerM = (d: number): number => SCREEN_H / (2 * d * Math.tan(FOV_Y / 2));
/**
 * The cabin viewpoints are the player's own seat: the cabin camera's near plane is 0.02 m
 * (render/cameras.ts `CABIN_NEAR`) and what it looks at stands within ~3 m, so a pair is
 * seen fighting from them only if it fights at 3 m with that near plane. A cabin seen from
 * further is another car's, and the exterior viewpoints stand for that.
 */
const CABIN_TAU = (2 * 3 * 3) / (0.02 * 2 ** 24);

// ---------------------------------------------------------------- provenance patch
const sites: string[] = [];
const siteIndex = new Map<string, number>();
function intern(s: string): number {
  let i = siteIndex.get(s);
  if (i === undefined) {
    i = sites.length;
    sites.push(s);
    siteIndex.set(s, i);
  }
  return i;
}
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 14;
const FRAME = /\/src\/carkit\/([a-z]+\.ts):(\d+):\d+/;
function callSite(): number {
  const stack = new Error().stack ?? '';
  const out: string[] = [];
  for (const line of stack.split('\n')) {
    const m = FRAME.exec(line);
    if (!m || m[1] === 'builder.ts') continue;
    out.push(`${m[1]}:${m[2]}`);
    if (out.length === 2) break;
  }
  return intern(out.join(' < ') || '?');
}
/** PartBuilder's private slot buffers plus the provenance this script hangs on it (runtime patch). */
interface BuilderInternals {
  slots: Map<KitSlot, { positions: number[]; colors: number[] }>;
  prov?: Map<KitSlot, number[]>;
}
const origTri = PartBuilder.prototype.tri;
const origBuild = PartBuilder.prototype.build;
PartBuilder.prototype.tri = function (this: PartBuilder, slot: KitSlot, a: Vec3, b: Vec3, c: Vec3) {
  // Private fields are read at run time; this script only observes them.
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
const origAppend = PartBuilder.prototype.append;
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

// ---------------------------------------------------------------- triangle soup
interface MeshInfo {
  name: string;
  path: string; // ancestor names below the root, '/'-joined, mesh last
  slot: string; // material name
  zone: string; // exterior | kit_cabin | kit_bay | kit_boot | kit_under | wheel
  rigid: number; // id of nearest kitMotion ancestor (or -1)
  transparent: boolean; // in game: glass is the loader's clear glass
  polygonOffset: boolean;
}
interface Soup {
  n: number;
  v: Float64Array; // 9n
  nrm: Float64Array; // 3n unit normal
  area: Float64Array;
  mesh: Int32Array;
  prov: Int32Array;
  col: Int32Array; // vertex colour (rgb 8-bit packed) of the triangle, -1 if none
  meshes: MeshInfo[];
}

/** The mesh's shut geometry: a sunk drop pane draws a cut copy (rig.ts `KIT_SHUT_GEOMETRY`). */
function geometryOf(mesh: THREE.Mesh): THREE.BufferGeometry {
  return (mesh.userData[KIT_SHUT_GEOMETRY] as THREE.BufferGeometry | undefined) ?? mesh.geometry;
}

function soupFromRoot(root: THREE.Object3D, meshes?: MeshInfo[]): Soup {
  root.updateMatrixWorld(true);
  const list: { mesh: THREE.Mesh; info: MeshInfo }[] = [];
  const infos: MeshInfo[] = meshes ?? [];
  let k = 0;
  let total = 0;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    let info = meshes?.[k];
    if (!info) {
      const names: string[] = [];
      let zone = 'exterior';
      let rigid = -1;
      for (let p: THREE.Object3D | null = node; p && p !== root; p = p.parent) {
        names.unshift(p.name || '?');
        if (/^kit_(cabin|bay|boot|under)$/.test(p.name)) zone = p.name;
        if (/^kit_wheel_/.test(p.name)) zone = 'wheel';
        if (rigid < 0 && p.userData?.kitMotion) rigid = p.id;
      }
      // Kit meshes carry one material each (materials.ts).
      const m = node.material as THREE.Material;
      info = {
        name: node.name,
        path: names.join('/'),
        slot: m.name,
        zone,
        rigid,
        transparent: !!m.transparent || m.name === 'glass',
        polygonOffset: !!m.polygonOffset,
      };
      infos.push(info);
    }
    list.push({ mesh: node, info });
    total += geometryOf(node).getAttribute('position').count / 3;
    k++;
  });
  const v = new Float64Array(total * 9);
  const nrm = new Float64Array(total * 3);
  const area = new Float64Array(total);
  const mesh = new Int32Array(total);
  const prov = new Int32Array(total);
  const col = new Int32Array(total);
  const p = new THREE.Vector3();
  let t = 0;
  list.forEach(({ mesh: node }, mi) => {
    const geometry = geometryOf(node);
    // A pane wound into its door (rig.ts `SinkingPane`) is not drawn: its triangles
    // collapse to a point, so they neither pair nor block a view.
    let shown = true;
    for (let q: THREE.Object3D | null = node; q && q !== root; q = q.parent) if (!q.visible) shown = false;
    if (shown && geometry !== node.geometry) throw new Error(`${node.name}: a part-sunk pane; pose drop panes fully up or down`);
    const pos = geometry.getAttribute('position');
    const color = geometry.getAttribute('color');
    const pv: number[] = geometry.userData.prov ?? [];
    const vc = (node.material as THREE.Material & { vertexColors?: boolean }).vertexColors === true;
    const index = geometry.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      for (let j = 0; j < 3; j++) {
        const vi = index ? index.getX(i + (shown ? j : 0)) : i + (shown ? j : 0);
        p.fromBufferAttribute(pos, vi).applyMatrix4(node.matrixWorld);
        v[t * 9 + j * 3] = p.x;
        v[t * 9 + j * 3 + 1] = p.y;
        v[t * 9 + j * 3 + 2] = p.z;
      }
      const o = t * 9;
      const ux = v[o + 3] - v[o], uy = v[o + 4] - v[o + 1], uz = v[o + 5] - v[o + 2];
      const wx = v[o + 6] - v[o], wy = v[o + 7] - v[o + 1], wz = v[o + 8] - v[o + 2];
      let cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
      const len = Math.hypot(cx, cy, cz);
      area[t] = len / 2;
      if (len > 0) { cx /= len; cy /= len; cz /= len; }
      nrm[t * 3] = cx; nrm[t * 3 + 1] = cy; nrm[t * 3 + 2] = cz;
      mesh[t] = mi;
      prov[t] = pv[i / 3] ?? intern('?');
      if (vc && color) {
        const ci = index ? index.getX(i) : i;
        col[t] = (Math.round(color.getX(ci) * 255) << 16) | (Math.round(color.getY(ci) * 255) << 8) | Math.round(color.getZ(ci) * 255);
      } else col[t] = -1;
      t++;
    }
  });
  return { n: total, v, nrm, area, mesh, prov, col, meshes: infos };
}

/** A soup from a raw triangle list (unit test). */
function soupFromTris(tris: { pts: number[]; mesh: number; col?: number }[], meshes: MeshInfo[]): Soup {
  const n = tris.length;
  const s: Soup = { n, v: new Float64Array(n * 9), nrm: new Float64Array(n * 3), area: new Float64Array(n), mesh: new Int32Array(n), prov: new Int32Array(n), col: new Int32Array(n), meshes };
  tris.forEach((tr, t) => {
    s.v.set(tr.pts, t * 9);
    const o = t * 9, v = s.v;
    const ux = v[o + 3] - v[o], uy = v[o + 4] - v[o + 1], uz = v[o + 5] - v[o + 2];
    const wx = v[o + 6] - v[o], wy = v[o + 7] - v[o + 1], wz = v[o + 8] - v[o + 2];
    const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
    const len = Math.hypot(cx, cy, cz);
    s.area[t] = len / 2;
    s.nrm.set([cx / len, cy / len, cz / len], t * 3);
    s.mesh[t] = tr.mesh;
    s.prov[t] = intern('test');
    s.col[t] = tr.col ?? -1;
  });
  return s;
}

// ---------------------------------------------------------------- geometry helpers
type P2 = [number, number];
function polyArea(p: P2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!, [x1, y1] = p[(i + 1) % p.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}
/** Sutherland–Hodgman: subject clipped by a CCW convex clip polygon. */
function clip(subject: P2[], clipper: P2[]): P2[] {
  let out = subject;
  for (let i = 0; i < clipper.length && out.length > 0; i++) {
    const [ax, ay] = clipper[i]!, [bx, by] = clipper[(i + 1) % clipper.length]!;
    const side = (p: P2) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!, prev = input[(j + input.length - 1) % input.length]!;
      const sc = side(cur), sp = side(prev);
      if (sc >= 0) {
        if (sp < 0) { const t = sp / (sp - sc); out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]); }
        out.push(cur);
      } else if (sp >= 0) {
        const t = sp / (sp - sc);
        out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
      }
    }
  }
  return out;
}

/** Keeps the part of a convex polygon where the affine `f` is ≤ 0. */
function clipAffine(poly: P2[], f: (q: P2) => number): P2[] {
  const out: P2[] = [];
  for (let j = 0; j < poly.length; j++) {
    const cur = poly[j]!, prev = poly[(j + poly.length - 1) % poly.length]!;
    const fc = f(cur), fp = f(prev);
    if (fc <= 0) {
      if (fp > 0) { const t = fp / (fp - fc); out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]); }
      out.push(cur);
    } else if (fp <= 0) {
      const t = fp / (fp - fc);
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
  }
  return out;
}

interface PairHit {
  a: number;
  b: number;
  area: number; // m²
  gap: number; // max |B plane − A plane| over the overlap, m
  gapMin: number;
  /** Overlap area where |B − A| < TAUS[k]. */
  bands: number[];
  /** Overlap area where |B − A| < tau, for any tau. */
  within: (tau: number) => number;
  n: [number, number, number];
  /** Points inside the overlap (on A's plane) and B's height above A there along nA: the centroid and 80% towards each corner. */
  samples: { p: [number, number, number]; hB: number }[];
}

/**
 * Coplanar test for triangles a, b: normals within 3° (either facing), B's plane within
 * FAR_GAP of A's over their projected overlap, overlap area > PAIR_MIN_AREA.
 */
function testPair(s: Soup, a: number, b: number): PairHit | null {
  const n = s.nrm, v = s.v;
  const d = n[a * 3] * n[b * 3] + n[a * 3 + 1] * n[b * 3 + 1] + n[a * 3 + 2] * n[b * 3 + 2];
  if (Math.abs(d) < COS_NORMAL) return null;
  const nx = n[a * 3], ny = n[a * 3 + 1], nz = n[a * 3 + 2];
  const ox = v[a * 9], oy = v[a * 9 + 1], oz = v[a * 9 + 2];
  // Quick reject: every B vertex far from A's plane on the same side.
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < 3; j++) {
    const h = (v[b * 9 + j * 3] - ox) * nx + (v[b * 9 + j * 3 + 1] - oy) * ny + (v[b * 9 + j * 3 + 2] - oz) * nz;
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  if (lo > FAR_GAP || hi < -FAR_GAP) return null;
  // Basis on A's plane.
  let ux = v[a * 9 + 3] - ox, uy = v[a * 9 + 4] - oy, uz = v[a * 9 + 5] - oz;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
  const proj = (t: number, j: number): P2 => {
    const px = v[t * 9 + j * 3] - ox, py = v[t * 9 + j * 3 + 1] - oy, pz = v[t * 9 + j * 3 + 2] - oz;
    return [px * ux + py * uy + pz * uz, px * wx + py * wy + pz * wz];
  };
  let A: P2[] = [proj(a, 0), proj(a, 1), proj(a, 2)];
  let B: P2[] = [proj(b, 0), proj(b, 1), proj(b, 2)];
  if (polyArea(A) < 0) A = A.reverse();
  if (polyArea(B) < 0) B = B.reverse();
  const I = clip(B, A);
  if (I.length < 3) return null;
  const area = polyArea(I);
  if (area < PAIR_MIN_AREA) return null;
  // B's plane height over A's plane at the overlap's corners: B plane through B0 with normal nb.
  let bnx = n[b * 3], bny = n[b * 3 + 1], bnz = n[b * 3 + 2];
  if (d < 0) { bnx = -bnx; bny = -bny; bnz = -bnz; }
  const bdn = bnx * nx + bny * ny + bnz * nz;
  const b0x = v[b * 9], b0y = v[b * 9 + 1], b0z = v[b * 9 + 2];
  const heightAt = (q: P2): number => {
    const px = ox + ux * q[0] + wx * q[1], py = oy + uy * q[0] + wy * q[1], pz = oz + uz * q[0] + wz * q[1];
    // Solve for h: (p + n h − B0)·nb = 0.
    return -((px - b0x) * bnx + (py - b0y) * bny + (pz - b0z) * bnz) / bdn;
  };
  let gap = 0, gapMin = Infinity;
  for (const q of I) {
    const h = Math.abs(heightAt(q));
    gap = Math.max(gap, h);
    gapMin = Math.min(gapMin, h);
  }
  if (gapMin > FAR_GAP) return null;
  // The height is affine on the plane: clip the overlap to |h| < tau for each band.
  const h00 = heightAt([0, 0]), hx = heightAt([1, 0]) - h00, hy = heightAt([0, 1]) - h00;
  const within = (tau: number): number => {
    if (gap < tau) return area;
    const lo = clipAffine(I, (q) => h00 + hx * q[0] + hy * q[1] - tau);
    const both = clipAffine(lo, (q) => -(h00 + hx * q[0] + hy * q[1]) - tau);
    return both.length < 3 ? 0 : Math.abs(polyArea(both));
  };
  const bands = TAUS.map(within);
  // Centroid of the overlap polygon.
  let cxs = 0, cys = 0, aw = 0;
  for (let i = 0; i < I.length; i++) {
    const [x0, y0] = I[i]!, [x1, y1] = I[(i + 1) % I.length]!;
    const cr = x0 * y1 - x1 * y0;
    cxs += (x0 + x1) * cr; cys += (y0 + y1) * cr; aw += cr;
  }
  const cq: P2 = [cxs / (3 * aw), cys / (3 * aw)];
  const lift = (q: P2): [number, number, number] => [ox + ux * q[0] + wx * q[1], oy + uy * q[0] + wy * q[1], oz + uz * q[0] + wz * q[1]];
  const qs: P2[] = [cq, ...I.map((q): P2 => [cq[0] + (q[0] - cq[0]) * 0.8, cq[1] + (q[1] - cq[1]) * 0.8])];
  return { a, b, area, gap, gapMin, bands, within, n: [nx, ny, nz], samples: qs.map((q) => ({ p: lift(q), hB: heightAt(q) })) };
}

/** Every coplanar overlapping pair; `keep(a, b)` filters before the geometric test. */
function findPairs(s: Soup, keep?: (a: number, b: number) => boolean): PairHit[] {
  const cells = new Map<number, number[]>();
  const pad = FAR_GAP;
  const K = 1 << 10; // cells per axis key span
  const key = (i: number, j: number, k: number) => ((i + 512) * K + (j + 512)) * K + (k + 512);
  for (let t = 0; t < s.n; t++) {
    if (s.area[t] < 1e-9) continue;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let j = 0; j < 3; j++) {
      const x = s.v[t * 9 + j * 3], y = s.v[t * 9 + j * 3 + 1], z = s.v[t * 9 + j * 3 + 2];
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
    }
    const i0 = Math.floor((x0 - pad) / PAIR_CELL), i1 = Math.floor((x1 + pad) / PAIR_CELL);
    const j0 = Math.floor((y0 - pad) / PAIR_CELL), j1 = Math.floor((y1 + pad) / PAIR_CELL);
    const k0 = Math.floor((z0 - pad) / PAIR_CELL), k1 = Math.floor((z1 + pad) / PAIR_CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const kk = key(i, j, k);
      let c = cells.get(kk);
      if (!c) cells.set(kk, (c = []));
      c.push(t);
    }
  }
  const seen = new Set<number>();
  const hits: PairHit[] = [];
  const n = s.nrm;
  for (const list of cells.values()) {
    for (let x = 0; x < list.length; x++) {
      const a = list[x]!;
      for (let y = x + 1; y < list.length; y++) {
        const b = list[y]!;
        const d = n[a * 3] * n[b * 3] + n[a * 3 + 1] * n[b * 3 + 1] + n[a * 3 + 2] * n[b * 3 + 2];
        if (Math.abs(d) < COS_NORMAL) continue;
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const pk = lo * s.n + hi;
        if (seen.has(pk)) continue;
        seen.add(pk);
        if (keep && !keep(lo, hi)) continue;
        const h = testPair(s, lo, hi);
        if (h) hits.push(h);
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------- occlusion grid
class RayGrid {
  readonly min: [number, number, number];
  readonly dims: [number, number, number];
  readonly start: Int32Array;
  readonly items: Int32Array;
  readonly stamp: Int32Array;
  private ray = 0;
  constructor(readonly s: Soup, occluder: (t: number) => boolean) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < s.n * 3; i++) {
      const x = s.v[i * 3], y = s.v[i * 3 + 1], z = s.v[i * 3 + 2];
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
        const x = s.v[t * 9 + j * 3], y = s.v[t * 9 + j * 3 + 1], z = s.v[t * 9 + j * 3 + 2];
        a0 = Math.min(a0, x); b0 = Math.min(b0, y); c0 = Math.min(c0, z);
        a1 = Math.max(a1, x); b1 = Math.max(b1, y); c1 = Math.max(c1, z);
      }
      const f = (val: number, ax: 0 | 1 | 2) => Math.max(0, Math.min(this.dims[ax] - 1, Math.floor((val - this.min[ax]) / RAY_CELL)));
      return [f(a0, 0), f(a1, 0), f(b0, 1), f(b1, 1), f(c0, 2), f(c1, 2)];
    };
    for (let t = 0; t < s.n; t++) {
      if (!occluder(t) || s.area[t] < 1e-10) { ranges.push([]); continue; }
      const r = span(t);
      ranges.push(r);
      for (let i = r[0]!; i <= r[1]!; i++) for (let j = r[2]!; j <= r[3]!; j++) for (let k = r[4]!; k <= r[5]!; k++) counts[(i * Y + j) * Z + k]++;
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

  private hitTri(t: number, o: number[], d: number[], tmax: number): boolean {
    const v = this.s.v, b = t * 9;
    const e1x = v[b + 3] - v[b], e1y = v[b + 4] - v[b + 1], e1z = v[b + 5] - v[b + 2];
    const e2x = v[b + 6] - v[b], e2y = v[b + 7] - v[b + 1], e2z = v[b + 8] - v[b + 2];
    const px = d[1]! * e2z - d[2]! * e2y, py = d[2]! * e2x - d[0]! * e2z, pz = d[0]! * e2y - d[1]! * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) return false;
    const inv = 1 / det;
    const tx = o[0]! - v[b], ty = o[1]! - v[b + 1], tz = o[2]! - v[b + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return false;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const w = (d[0]! * qx + d[1]! * qy + d[2]! * qz) * inv;
    if (w < 0 || u + w > 1) return false;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return tt > 1e-6 && tt < tmax;
  }

  /** True if the segment o→p is blocked by an occluder other than `skipA`/`skipB`. */
  blocked(o: number[], p: number[], skipA: number, skipB: number): boolean {
    const dx = p[0]! - o[0]!, dy = p[1]! - o[1]!, dz = p[2]! - o[2]!;
    const len = Math.hypot(dx, dy, dz);
    const d = [dx / len, dy / len, dz / len];
    // Clip to the grid box.
    let t0 = 0, t1 = len;
    for (let ax = 0; ax < 3; ax++) {
      const lo = this.min[ax]!, hi = lo + this.dims[ax]! * RAY_CELL;
      if (Math.abs(d[ax]!) < 1e-12) { if (o[ax]! < lo || o[ax]! > hi) return false; continue; }
      let a = (lo - o[ax]!) / d[ax]!, b = (hi - o[ax]!) / d[ax]!;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
    const stamp = ++this.ray;
    const [X, Y, Z] = this.dims;
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
      for (let q = this.start[c]!; q < this.start[c + 1]!; q++) {
        const t = this.items[q]!;
        if (t === skipA || t === skipB || this.stamp[t] === stamp) continue;
        this.stamp[t] = stamp;
        if (this.hitTri(t, o, d, tmax)) return true;
      }
      let ax = tMaxA[0]! < tMaxA[1]! ? (tMaxA[0]! < tMaxA[2]! ? 0 : 2) : tMaxA[1]! < tMaxA[2]! ? 1 : 2;
      if (tMaxA[ax]! > t1) return false;
      cell[ax] = cell[ax]! + step[ax]!;
      if (cell[ax]! < 0 || cell[ax]! >= this.dims[ax]!) return false;
      tMaxA[ax] = tMaxA[ax]! + tDelta[ax]!;
    }
  }
}

/** Which viewpoints see the pair's overlap (either sample), from the right side of the plane. */
function seenBy(grid: RayGrid, h: PairHit, views: number[][]): boolean[] {
  return views.map((eye) => {
    for (const { p: c, hB } of h.samples) {
      const side = (eye[0]! - c[0]) * h.n[0] + (eye[1]! - c[1]) * h.n[1] + (eye[2]! - c[2]) * h.n[2] > 0 ? 1 : -1;
      const off = Math.max(0, side * hB) + 3e-4;
      const o = [c[0] + h.n[0] * side * off, c[1] + h.n[1] * side * off, c[2] + h.n[2] * side * off];
      if (!grid.blocked(o, eye, h.a, h.b)) return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------- shell holes
/** A sight line counts as looking into the body once it is this far past the hole's plane, along itself. */
const HOLE_PAST = 0.002;
/** Sample points stand at least this far inside every edge of a hole's outline. */
const HOLE_INSET = 0.0015;

interface Slit {
  owner: string;
  at: [number, number, number];
  view: number[];
}

/**
 * Every hole cut in the shell under an item (`KitHole`, `root.userData.kitHoles`) must be
 * covered by it from every side: a sight line from any exterior viewpoint through a point
 * inside the hole's outline, on to 2 mm past the hole's plane, has to meet an opaque face
 * first. One that does not looks through a slit into the body. Points next to each
 * corner and each edge's middle (at least 1.5 mm inside every edge), and the centre;
 * viewpoints on the hole's outer side, not grazing it. The line crosses the plane inside
 * the hole, so a shut gap beside it is not taken for one.
 */
function holeSlits(root: THREE.Object3D, grid: RayGrid, views: number[][]): { holes: number; slits: Slit[] } {
  const holes = (root.userData.kitHoles ?? []) as { owner: string; outline: Outline }[];
  const slits: Slit[] = [];
  for (const { owner, outline } of holes) {
    const poly = outline.poly;
    const c = [0, 0, 0];
    for (const p of poly) for (let ax = 0; ax < 3; ax++) c[ax] += p[ax]! / poly.length;
    const n = [0, 0, 0];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    // Outward: away from a point on the car's long axis at mid height.
    const out = n[0]! * c[0]! + n[1]! * (c[1]! - 0.55) + n[2]! * c[2]! >= 0 ? 1 : -1;
    for (let ax = 0; ax < 3; ax++) n[ax] = (n[ax]! / len) * out;
    // Distance from q to the nearest edge's line.
    const edgeDistance = (q: readonly number[]): number => {
      let best = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
        const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const w = [q[0]! - a[0], q[1]! - a[1], q[2]! - a[2]];
        const el = Math.hypot(e[0]!, e[1]!, e[2]!);
        if (el < 1e-9) continue;
        const cx = w[1]! * e[2]! - w[2]! * e[1]!, cy = w[2]! * e[0]! - w[0]! * e[2]!, cz = w[0]! * e[1]! - w[1]! * e[0]!;
        best = Math.min(best, Math.hypot(cx, cy, cz) / el);
      }
      return best;
    };
    // Moved from p towards the centre until HOLE_INSET clear of every edge (the centre if the hole is narrower).
    const inset = (p: readonly number[]): number[] => {
      for (let k = 0; k < 1; k += 0.01) {
        const q = [0, 1, 2].map((ax) => p[ax]! + (c[ax]! - p[ax]!) * k);
        if (edgeDistance(q) >= HOLE_INSET) return q;
      }
      return c;
    };
    const samples = [c];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      samples.push(inset(p), inset([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]));
    });
    let found: Slit | undefined;
    for (const s of samples) {
      for (const eye of views) {
        const d = [s[0]! - eye[0]!, s[1]! - eye[1]!, s[2]! - eye[2]!];
        const dl = Math.hypot(d[0]!, d[1]!, d[2]!);
        // Only from the outer side, and not grazing (within 5° of the hole's plane).
        if (-(d[0]! * n[0]! + d[1]! * n[1]! + d[2]! * n[2]!) < 0.087 * dl) continue;
        const past = [0, 1, 2].map((ax) => s[ax]! + (d[ax]! / dl) * HOLE_PAST);
        if (!grid.blocked(eye, past, -1, -1)) {
          found = { owner, at: s.map((x) => Math.round(x * 1000) / 1000) as [number, number, number], view: eye.map((x) => Math.round(x * 100) / 100) };
          break;
        }
      }
      if (found) break;
    }
    if (found) slits.push(found);
  }
  return { holes: holes.length, slits };
}

// ---------------------------------------------------------------- unit test
function selfTest(): void {
  const M = (name: string): MeshInfo => ({ name, path: name, slot: 'paint', zone: 'exterior', rigid: -1, transparent: false, polygonOffset: false });
  const meshes = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(M);
  const sq = (x0: number, z0: number, x1: number, z1: number, y: number, mesh: number, tilt = 0) => {
    const Y = (x: number) => y + (x - x0) * Math.tan(tilt);
    const p = [[x0, Y(x0), z0], [x1, Y(x1), z0], [x1, Y(x1), z1], [x0, Y(x0), z1]];
    return [{ pts: [...p[0]!, ...p[1]!, ...p[2]!], mesh }, { pts: [...p[0]!, ...p[2]!, ...p[3]!], mesh }];
  };
  const tris = [
    ...sq(0, 0, 0.1, 0.1, 0, 0), // A: 10 cm square, y = 0
    ...sq(0.05, 0.05, 0.15, 0.15, 0, 1), // B: exactly coplanar, overlaps A by 25 cm²
    ...sq(0.1, 0, 0.2, 0.1, 0, 2), // C: shares A's edge x = 0.1 only (touching, no area)
    ...sq(1, 0, 1.1, 0.1, 0, 3), // D: base for the gap cases
    ...sq(1, 0, 1.1, 0.1, 0.001, 4), // E: 1 mm over D → fight
    ...sq(1, 0, 1.1, 0.1, 0.004, 5), // F: 4 mm over D → far risk (also 3 mm over E)
    ...sq(2, 0, 2.1, 0.1, 0, 6), ...sq(2, 0, 2.1, 0.1, 0, 6, (10 * Math.PI) / 180), // G vs G tilted 10° → none
  ];
  // Opposite winding on B (double-sided opposite-facing must still count).
  const bt = tris[2]!.pts; tris[2]!.pts = [...bt.slice(0, 3), ...bt.slice(6, 9), ...bt.slice(3, 6)];
  const s = soupFromTris(tris, meshes);
  const hits = findPairs(s);
  const by = (ma: number, mb: number) => hits.filter((h) => (s.mesh[h.a] === ma && s.mesh[h.b] === mb) || (s.mesh[h.a] === mb && s.mesh[h.b] === ma));
  const sum = (hs: PairHit[]) => hs.reduce((x, h) => x + h.area, 0);
  const ok = (cond: boolean, what: string) => { if (!cond) throw new Error(`self-test failed: ${what}`); console.log(`  ok  ${what}`); };
  ok(Math.abs(sum(by(0, 1)) - 0.0025) < 1e-6, `A/B coplanar overlap = ${(sum(by(0, 1)) * 1e4).toFixed(2)} cm² (expected 25)`);
  ok(by(0, 2).length === 0, 'A/C shared edge: no pair');
  ok(by(1, 2).length > 0 && Math.abs(sum(by(1, 2)) - 0.0025) < 1e-6, 'B/C overlap 25 cm²');
  ok(by(0, 0).length === 0 && by(3, 3).length === 0, 'two halves of one quad: no pair');
  const de = by(3, 4);
  ok(Math.abs(sum(de) - 0.01) < 1e-6 && de.every((h) => Math.abs(h.gap - 0.001) < 1e-6), 'D/E 1 mm gap: 100 cm², gap 1 mm (fight)');
  ok(by(3, 5).every((h) => h.gap > FIGHT_GAP) && sum(by(3, 5)) > 0.0099, 'D/F 4 mm: far-view class');
  ok(by(6, 6).length === 0, 'G tilted 10°: no pair');
  // Occlusion: a lid 1 cm over A/B blocks the view from above but not from below.
  const lid = sq(-0.05, -0.05, 0.25, 0.25, 0.01, 0);
  const s2 = soupFromTris([...tris, ...lid], meshes);
  const grid = new RayGrid(s2, () => true);
  const h = findPairs(s2).find((x) => s2.mesh[x.a] === 0 && s2.mesh[x.b] === 1 && x.area > 1e-4)!;
  const seen = seenBy(grid, h, [[0.07, 3, 0.07], [0.07, -3, 0.07]]);
  ok(!seen[0] && seen[1], 'occlusion: lid hides the overlap from above, not from below');
}

// ---------------------------------------------------------------- per car
interface Cluster {
  car: string;
  pose: string; // closed | open | both
  meshA: MeshInfo;
  meshB: MeshInfo;
  provA: string;
  provB: string;
  colA: number;
  colB: number;
  sameLook: boolean;
  band: number; // 0 close, 1 10-25 m, 2 >25 m, 3 far (TAUS)
  area: number; // m², whole overlap within 6 mm
  bands: number[]; // m², overlap within TAUS[k]
  gapMin: number;
  gapMax: number;
  dFight: number; // m: beyond this distance some of it fights (24-bit depth, near 0.08)
  detail: boolean; // one side is in a group not drawn beyond KIT_DETAIL_M (cabin, bay, boot, under)
  pairs: number;
  px: number; // pixels it fights over at the worst distance it is drawn at (SCREEN_H, FOV_Y)
  s: number; y: number; x: number; // area-weighted centroid, closed pose
  normal: [number, number, number];
  extViews: number; // exterior viewpoints that see it (of EXT_N), either pose
  cabViews: number; // cabin viewpoints (of CAB_N), either pose
  extClosed: number; cabClosed: number; extOpen: number; cabOpen: number;
  severity: number;
}

const EXT_N_HOLDER = { n: 0 };
const CAB_N = 4;

function viewpoints(root: THREE.Object3D, length: number): { ext: number[][]; cab: number[][] } {
  const ext: number[][] = [];
  const r = length / 2 + 2.2;
  for (let az = 0; az < 360; az += 30) {
    const a = (az * Math.PI) / 180;
    for (const [rr, h] of [[r, 0.35], [r, 1.6], [r + 1, 3.2]] as const) ext.push([Math.sin(a) * rr, h, Math.cos(a) * rr]);
  }
  ext.push([0, 4.5, 0]);
  EXT_N_HOLDER.n = ext.length;
  const eye = root.getObjectByName('kit_driver_eye');
  if (!eye) throw new Error('no kit_driver_eye');
  root.updateMatrixWorld(true);
  const e = new THREE.Vector3().setFromMatrixPosition(eye.matrixWorld);
  const cab = [[e.x, e.y, e.z], [-e.x, e.y, e.z], [e.x, e.y, e.z - 0.85], [-e.x, e.y, e.z - 0.85]];
  return { ext, cab };
}

/** A close ring for the holes' check: a metre off the car at three heights, every 15°. */
function nearViews(length: number): number[][] {
  const out: number[][] = [];
  for (let az = 0; az < 360; az += 15) {
    const a = (az * Math.PI) / 180;
    for (const h of [0.3, 0.8, 1.3]) out.push([Math.sin(a) * 1.9, h, Math.cos(a) * (length / 2 + 1)]);
  }
  return out;
}

/** Every motion channel at 0 (closed) or 1 (open), posed by the game's own rig. */
function setPose(root: THREE.Object3D, rig: KitRig, open: boolean): void {
  root.traverse((node) => {
    const m = node.userData.kitMotion as { channel: string } | undefined;
    if (m) rig.set(m.channel, open ? 1 : 0, true);
  });
  rig.update(0);
  root.updateMatrixWorld(true);
}

function scanCar(id: string): { clusters: Cluster[]; tris: number; pairs: number; ms: number; holes: number; slits: Slit[] } {
  const t0 = performance.now();
  const spec = KIT_SPECS[id];
  const root = buildKitCar(id);
  const rig = new KitRig(root, false);
  setPose(root, rig, false);
  const closed = soupFromRoot(root);
  const { ext, cab } = viewpoints(root, spec.length);
  setPose(root, rig, true);
  const open = soupFromRoot(root, closed.meshes);
  setPose(root, rig, false);
  if (open.n !== closed.n) throw new Error(`${id}: pose changed the triangle count`);

  const occ = (s: Soup) => (t: number) => !s.meshes[s.mesh[t]!]!.transparent;
  const hitsClosed = findPairs(closed);
  const rigid = (s: Soup, t: number) => s.meshes[s.mesh[t]!]!.rigid;
  const hitsOpen = findPairs(open, (a, b) => rigid(open, a) !== rigid(open, b));
  const gridClosed = new RayGrid(closed, occ(closed));
  const gridOpen = new RayGrid(open, occ(open));
  // Holes are checked against what a car past `KIT_DETAIL_M` still draws, as the mid and
  // far traffic meshes bake it (render/farcars.ts): no detail group may be what covers one.
  const shellOnly = new RayGrid(closed, (t) => occ(closed)(t) && !closed.meshes[closed.mesh[t]!]!.zone.startsWith('kit_'));
  const { holes, slits } = holeSlits(root, shellOnly, [...ext, ...nearViews(spec.length)]);

  type Tagged = { h: PairHit; pose: 'closed' | 'open' };
  const all: Tagged[] = [...hitsClosed.map((h) => ({ h, pose: 'closed' as const })), ...hitsOpen.map((h) => ({ h, pose: 'open' as const }))];

  // Group by (mesh, prov, colour) of both sides, then split spatially.
  const groups = new Map<string, Tagged[]>();
  for (const tg of all) {
    const { h } = tg;
    const s = closed;
    const ka = `${s.mesh[h.a]}|${s.prov[h.a]}|${s.col[h.a]}`, kb = `${s.mesh[h.b]}|${s.prov[h.b]}|${s.col[h.b]}`;
    // One emitter often makes both faces of a slab: its back flush (gap 0) and its front a few mm off.
    const band = TAUS.findIndex((tau) => h.gapMin < tau);
    const key = `${ka < kb ? `${ka}#${kb}` : `${kb}#${ka}`}#${band}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(tg);
  }

  const clusters: Cluster[] = [];
  const half = spec.length / 2;
  for (const [key, list] of groups) {
    // Single-linkage: closed-pose centroids within 12 cm and normals within 10°.
    const cen = list.map(({ h }) => {
      const s = closed;
      const c = [0, 0, 0];
      for (const t of [h.a, h.b]) for (let j = 0; j < 3; j++) for (let ax = 0; ax < 3; ax++) c[ax] += s.v[t * 9 + j * 3 + ax]! / 6;
      return c;
    });
    const nrmOf = (h: PairHit) => [closed.nrm[h.a * 3]!, closed.nrm[h.a * 3 + 1]!, closed.nrm[h.a * 3 + 2]!];
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const ci = cen[i]!, cj = cen[j]!;
      if ((ci[0]! - cj[0]!) ** 2 + (ci[1]! - cj[1]!) ** 2 + (ci[2]! - cj[2]!) ** 2 > 0.12 ** 2) continue;
      const ni = nrmOf(list[i]!.h), nj = nrmOf(list[j]!.h);
      if (Math.abs(ni[0]! * nj[0]! + ni[1]! * nj[1]! + ni[2]! * nj[2]!) < Math.cos((10 * Math.PI) / 180)) continue;
      parent[find(i)] = find(j);
    }
    const comps = new Map<number, number[]>();
    list.forEach((_, i) => { const r = find(i); let c = comps.get(r); if (!c) comps.set(r, (c = [])); c.push(i); });
    for (const idx of comps.values()) {
      const items = idx.map((i) => list[i]!);
      // Area: closed and open overlaps of the same pair are one area; count each pair once (max).
      const byPair = new Map<string, Tagged[]>();
      for (const it of items) { const k = `${it.h.a}-${it.h.b}`; let l = byPair.get(k); if (!l) byPair.set(k, (l = [])); l.push(it); }
      let area = 0, gapMin = Infinity, gapMax = 0, sx = 0, sy = 0, sz = 0;
      const bands = TAUS.map(() => 0);
      const poses = new Set<string>();
      for (const [, l] of byPair) {
        const best = l.reduce((p, q) => (q.h.area > p.h.area ? q : p));
        area += best.h.area;
        best.h.bands.forEach((x, k) => (bands[k] += x));
        for (const x of l) { gapMin = Math.min(gapMin, x.h.gapMin); gapMax = Math.max(gapMax, x.h.gap); poses.add(x.pose); }
      }
      if (area < CLUSTER_MIN_AREA) continue;
      for (const i of idx) { const w = list[i]!.h.area; sx += cen[i]![0]! * w; sy += cen[i]![1]! * w; sz += cen[i]![2]! * w; }
      let wsum = 0;
      for (const i of idx) wsum += list[i]!.h.area;
      // Visibility from the 4 largest pairs, in each pose the pair is coplanar in: a pair
      // inside one rigid group (engine bay and body, door card and door) is coplanar in
      // both, and the open pose is where a bay or a jamb shows.
      const top = [...items].sort((p, q) => q.h.area - p.h.area).slice(0, 8);
      const seen = { closed: { ext: new Array(ext.length).fill(false), cab: new Array(cab.length).fill(false) }, open: { ext: new Array(ext.length).fill(false), cab: new Array(cab.length).fill(false) } };
      for (const it of top) {
        const tries: [PairHit, 'closed' | 'open'][] = [[it.h, it.pose]];
        if (it.pose === 'closed' && rigid(closed, it.h.a) === rigid(closed, it.h.b)) {
          const ho = testPair(open, it.h.a, it.h.b);
          if (ho) tries.push([ho, 'open']);
        }
        for (const [h, pose] of tries) {
          const grid = pose === 'closed' ? gridClosed : gridOpen;
          seenBy(grid, h, ext).forEach((v, i) => { if (v) seen[pose].ext[i] = true; });
          seenBy(grid, h, cab).forEach((v, i) => { if (v) seen[pose].cab[i] = true; });
        }
      }
      const count = (xs: boolean[]) => xs.filter(Boolean).length;
      const extSeen = seen.closed.ext.map((v, i) => v || seen.open.ext[i]);
      const cabSeen = seen.closed.cab.map((v, i) => v || seen.open.cab[i]);
      const h0 = items[0]!.h;
      let a = h0.a, b = h0.b;
      const [kA] = key.split('#');
      if (`${closed.mesh[a]}|${closed.prov[a]}|${closed.col[a]}` !== kA) [a, b] = [b, a];
      const mA = closed.meshes[closed.mesh[a]!]!, mB = closed.meshes[closed.mesh[b]!]!;
      const sameLook = mA.slot === mB.slot && closed.col[a] === closed.col[b];
      const extViews = extSeen.filter(Boolean).length;
      // The seat sees a fight only one that fights within the cabin's reach (CABIN_TAU).
      const cabViews = gapMin < CABIN_TAU ? cabSeen.filter(Boolean).length : 0;
      const band = TAUS.findIndex((tau) => gapMin < tau);
      const detail = mA.zone.startsWith('kit_') || mB.zone.startsWith('kit_');
      const vis = Math.max(extViews / ext.length, (0.75 * cabViews) / cab.length);
      // Pixels it fights over, at the worst distance it is drawn at: the overlap within the
      // depth step there, times the pixels a square metre covers there. The cabin is seen
      // from outside through its glass, which lets 1 − opacity of it through
      // (`kitGlassOpacity`: clear to 30 m, a tinted mirror by `KIT_DETAIL_M`).
      const cabin = mA.zone === 'kit_cabin' || mB.zone === 'kit_cabin';
      const best = [...byPair.values()].map((l) => l.reduce((p, q) => (q.h.area > p.h.area ? q : p)).h);
      let px = 0;
      for (let d = 1; d <= (detail ? KIT_DETAIL_M : SHELL_DRAW_M); d *= 1.05) {
        const tau = gapFightingAt(d);
        let fighting = 0;
        for (const h of best) fighting += h.within(tau);
        px = Math.max(px, fighting * pxPerM(d) ** 2 * (cabin ? 1 - kitGlassOpacity(d) : 1));
      }
      // The kit's own wheels are placeholders: the loader shods every car with the pack's
      // wheel sets (render/carmodel.ts `cloneWheels`), so a fight with one is never drawn.
      const placeholder = mA.zone === 'wheel' || mB.zone === 'wheel';
      const severity = sameLook || placeholder || px < MIN_FIGHT_PX ? 0 : px * vis;
      clusters.push({
        car: id,
        pose: poses.size === 2 ? 'both' : [...poses][0]!,
        meshA: mA, meshB: mB,
        provA: sites[closed.prov[a]!]!, provB: sites[closed.prov[b]!]!,
        colA: closed.col[a]!, colB: closed.col[b]!,
        sameLook, band, area, bands, gapMin, gapMax, dFight: fightDistance(gapMin), detail, pairs: byPair.size, px,
        s: half - sz / wsum, y: sy / wsum, x: sx / wsum,
        normal: nrmOf(h0) as [number, number, number],
        extViews, cabViews, extClosed: count(seen.closed.ext), cabClosed: count(seen.closed.cab), extOpen: count(seen.open.ext), cabOpen: count(seen.open.cab), severity,
      });
    }
  }
  return { clusters, tris: closed.n, pairs: hitsClosed.length + hitsOpen.length, ms: performance.now() - t0, holes, slits };
}

// ---------------------------------------------------------------- main
const BAND_NAMES = ['close', '10-25 m', '>25 m', 'far'];
const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
console.log('self-test:');
selfTest();
if (args.includes('--test')) process.exit(0);
const named = args.filter((a, i) => !a.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1));
const ids = named.length > 0 ? named.map((a) => a.replace(/^kit_/, '')) : Object.keys(KIT_SPECS);
const results: { id: string; tris: number; pairs: number; ms: number; clusters: Cluster[]; holes: number; slits: Slit[] }[] = [];
const rows: string[] = [];
let closeVisible = 0;
let slitCount = 0;
for (const id of ids) {
  const r = scanCar(id);
  results.push({ id, ...r });
  const count = (band: number, f: (c: Cluster) => boolean): number => r.clusters.filter((c) => c.band === band && f(c)).length;
  const visible = (c: Cluster): boolean => c.severity > 0;
  const shown = r.clusters.filter(visible).sort((p, q) => p.band - q.band || q.severity - p.severity);
  closeVisible += count(0, visible);
  rows.push(
    `${id.padEnd(9)} ${String(r.tris).padStart(6)} ${String(r.clusters.length).padStart(9)}   ${String(count(0, visible)).padStart(7)} ${String(count(0, (c) => !visible(c) && !c.sameLook)).padStart(6)} ${String(count(0, (c) => c.sameLook)).padStart(9)}   ${String(count(1, visible)).padStart(7)}   ${String(r.clusters.filter((c) => visible(c) && c.band >= 2).length).padStart(7)}   ${String(r.holes).padStart(5)} ${String(r.slits.length).padStart(5)}`,
  );
  slitCount += r.slits.length;
  console.log(`\n${id}: ${r.tris} triangles, ${r.clusters.length} clusters, ${r.holes} shell holes, ${(r.ms / 1000).toFixed(1)} s`);
  for (const s of r.slits) console.log(`  slit    ${s.owner} hole open at ${s.at.join(', ')} from ${s.view.join(', ')}`);
  for (const c of shown) {
    const at = `s ${c.s.toFixed(2)} y ${c.y.toFixed(2)} x ${c.x >= 0 ? '+' : ''}${c.x.toFixed(2)}`;
    console.log(
      `  ${BAND_NAMES[c.band]!.padEnd(7)} ${c.px.toFixed(1).padStart(6)} px  ${c.meshA.path} [${c.provA}]  /  ${c.meshB.path} [${c.provB}]  ${at}  ${(c.area * 1e4).toFixed(0)} cm²  gap ${(c.gapMin * 1e3).toFixed(2)} mm  views ext ${c.extClosed}/${c.extOpen} cab ${c.cabClosed}/${c.cabOpen}`,
    );
  }
}
console.log('\ncar        tris  clusters   close: visible hidden same-look   10-25 m visible   >25 m/far visible   holes slits');
for (const row of rows) console.log(row);
console.log(`\n${closeVisible} visible close-range clusters, ${slitCount} shell holes open to a viewpoint`);
if (jsonPath) {
  await Bun.write(jsonPath, JSON.stringify({ extViews: EXT_N_HOLDER.n, cabViews: CAB_N, results }, null, 1));
  console.log(`wrote ${jsonPath}`);
}
