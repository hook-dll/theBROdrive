/**
 * tools/kit-drawing.ts
 *
 * Every kit car, AS BUILT, against its real car's drawing and photos: the numbers in
 * src/carkit/refs/<car>.json (each with its source; the format is in that folder's
 * README.md) against the same quantities measured on the built model, and overlays that
 * show the difference.
 *
 *   nice -n 15 bun tools/kit-drawing.ts [--json out.json] [--no-images] [id ...]   (default: every kit car)
 *
 * MEASURED on the car `buildKitCar` returns, closed, in the kit frame (before the loader
 * fits it to the passport: drawings are read in that frame), never from the spec:
 *   length, width, height       the body's box (no mirrors, wheels, light bar);
 *   wheelbase, overhangs        the `kit_wheel_*` nodes;
 *   screenFoot, screenTop       the windscreen glass in profile: its foremost and rearmost
 *                               points [s, y]; backLightTop / backLightFoot the rear glass's;
 *   beltY, railY                lines from the left (+x) at the front door's middle: the
 *                               lowest and highest height that meet side glass;
 *   sideGlassBelt / …Rail       lines from the left along the car 3 cm over the belt and
 *                               under the rail: each run of side glass [s0, s1];
 *   doorFront, doorRear         the door's skin cut 5 cm under the belt: [s0, s1];
 *   doorBottomY                 the front door's lowest point;
 *   mirror                      the left door mirror's glass centre [s, y];
 *   roofHalfWidth               half the car's width 3 cm under its top;
 *   beltHalfWidth               the skin's half width 5 cm under the belt at the front door;
 *   moulding                    the front door's waist strip [y0, y1];
 *   bonnet, bootLid             the lid's skin on the centre line [s0, s1].
 *   Dash (the cabin as built): gauges (`panel_dim_*` nodes) and their rows (by height),
 *   clusterAt (the gauges' middle within 0.15 m of the wheel's axis: `wheel`), the clock,
 *   vents, stack and console (`root.userData.kitDash`, interior.ts `KitDashItem`), the
 *   steering wheel's spokes (a ring round its hub, probed through its plane) and outer
 *   diameter, the glovebox (`glovebox` node: on the passenger's side or none).
 *
 * COMPARED within each value's `tol`, or the defaults: overall dimensions and wheelbase
 * 0.015 m; positions along the car 0.03; heights 0.025; half widths 0.02; glass runs 0.04
 * per end (and their count); the mirror 0.05; the wheel 0.03; counts, rows, places and
 * yes/no exactly.
 *
 * VERDICTS per car: body VERIFIED (every referenced value within tolerance), MISMATCH (n
 * values out), or UNVERIFIED (no refs file, or no body values in it); dash OK, MISMATCH,
 * or DASH UNVERIFIED (no `dash` block with a photo: the dash is generic or unreferenced).
 * Exits 1 on any MISMATCH. UNVERIFIED is reported, and listed in STATUS.md, not a failure.
 *
 * OVERLAYS in build/kitcheck/<car>/: `drawing-side.png` and `drawing-front.png` (the
 * reference drawing's view, the same view ray-traced orthographically at the drawing's own
 * scale and registration, and the drawing with the model's outline in red over it), and
 * `cabin-vs-photo.png` (the cabin from the driver's eye beside the reference interior
 * photo).
 *
 * Nothing here is part of the game bundle.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import {
  buildCar, centroid, dot3, image, kitIds, loadImage, nodeAt, norm, orthographic, outDir, outline, over, perspective, RayGrid, savePng, sideBySide,
  slice, soupOf, sub, trace, type Image, type KitCar, type Soup, type V3,
} from './kitlib';
import type { KitDashItem } from '../src/carkit/interior';

installAssetShim();

const ROOT = new URL('../', import.meta.url).pathname;

// ---------------------------------------------------------------- refs

type Value = number | string | boolean | number[] | number[][];
interface Ref {
  readonly v: Value;
  readonly src: string;
  readonly tol?: number;
  /**
   * An intended deviation from the real car, with its reason (as reality.ts' known
   * deviations): the built car is held to `v` here instead, and the row is listed.
   */
  readonly accepted?: { readonly v: Value; readonly why: string };
}
interface Registration {
  readonly src: string;
  readonly image: string;
  readonly crop: readonly [number, number, number, number];
  readonly s?: readonly [number, number];
  readonly x?: readonly [number, number];
  readonly y: readonly [number, number];
}
interface RefFile {
  readonly car: string;
  readonly sources: Record<string, { readonly what: string; readonly url?: string; readonly image?: string }>;
  readonly body?: Record<string, Ref>;
  readonly dash?: Record<string, Ref | { readonly src: string; readonly view: string }>;
  readonly dashNote?: string;
  readonly gaps?: readonly string[];
  readonly overlay?: { readonly side?: Registration; readonly front?: Registration };
}

function isRef(r: unknown): r is Ref {
  return typeof r === 'object' && r !== null && 'v' in r && 'src' in r;
}

function readRefs(id: string): RefFile | undefined {
  const path = `${ROOT}src/carkit/refs/${id}.json`;
  if (!existsSync(path)) return undefined;
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null || !('car' in raw) || raw.car !== id || !('sources' in raw)) throw new Error(`${path}: not a refs file for ${id}`);
  return raw as RefFile;
}

/** Default tolerance per key (metres), see the header. */
const TOL: Record<string, number> = {
  length: 0.015, width: 0.015, height: 0.015, wheelbase: 0.015, overhangFront: 0.03, overhangRear: 0.03,
  screenFoot: 0.03, screenTop: 0.03, backLightTop: 0.03, backLightFoot: 0.03,
  // The visible glass: the generator edges every pane with its rubber inside the opening.
  beltY: 0.04, railY: 0.04, doorBottomY: 0.025, moulding: 0.025,
  sideGlassBelt: 0.04, sideGlassRail: 0.04, doorFront: 0.03, doorRear: 0.03, bonnet: 0.03, bootLid: 0.03,
  mirror: 0.05, roofHalfWidth: 0.02, beltHalfWidth: 0.02, wheelDiameter: 0.03,
};

// ---------------------------------------------------------------- measuring

interface Measured {
  body: Record<string, Value | undefined>;
  dash: Record<string, Value | undefined>;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function measureBody(car: KitCar, s: Soup, grid: RayGrid, refs: Record<string, Ref> | undefined): Record<string, Value | undefined> {
  const out: Record<string, Value | undefined> = {};
  const info = (t: number) => s.meshes[s.mesh[t]!]!;
  const shell = (t: number): boolean => {
    const m = info(t);
    return !m.hidden && m.zone === 'exterior' && !/mirror|light_bar|beacon|exhaust/.test(m.path);
  };
  let s0 = Infinity, s1 = -Infinity, h = 0;
  for (let t = 0; t < s.n; t++) {
    if (!shell(t)) continue;
    for (let j = 0; j < 3; j++) {
      const p = t * 9 + j * 3;
      const ss = car.s(s.v[p + 2]!);
      s0 = Math.min(s0, ss); s1 = Math.max(s1, ss);
      h = Math.max(h, s.v[p + 1]!);
    }
  }
  // Width as the loader measures the shell: its lower 55 % (render/carmodel.ts, kit-proportions).
  let w = 0;
  for (let t = 0; t < s.n; t++) {
    if (!shell(t)) continue;
    for (let j = 0; j < 3; j++) if (s.v[t * 9 + j * 3 + 1]! < 0.55 * h) w = Math.max(w, Math.abs(s.v[t * 9 + j * 3]!));
  }
  out.length = r3(s1 - s0);
  out.width = r3(2 * w);
  out.height = r3(h);
  const fl = nodeAt(car.root, 'kit_wheel_fl'), rl = nodeAt(car.root, 'kit_wheel_rl');
  if (fl && rl) {
    out.wheelbase = r3(car.s(rl[2]) - car.s(fl[2]));
    out.overhangFront = r3(car.s(fl[2]) - s0);
    out.overhangRear = r3(s1 - car.s(rl[2]));
  }
  // The greenhouse in profile: the side silhouette's front edge (the A pillar's line,
  // scanning back from ahead of the cowl) and rear edge (the back light's, scanning
  // forward from the tail). A drawn corner [s, y] is checked on the line through two
  // points of that edge 6 and 12 cm inside the corner's height (above the foot, under the
  // top), carried to the corner's own y: where the bonnet or the boot lid runs nearly
  // level, the edge at that very height would be anywhere along it. With no reference, at
  // the glass's lowest and highest point. Wipers and mirrors are skipped.
  const fitting = (t: number): boolean => /wiper|mirror/.test(info(t).path);
  const edge = (y: number, front: boolean): number | undefined => {
    for (let k = 0; k < 2000; k++) {
      const ss = front ? car.frame.cowl - 0.6 + k * 0.003 : s1 + 0.01 - k * 0.003;
      if (ss < 0 || ss > s1 + 0.02) return undefined;
      if (grid.nearest([3, y, car.z(ss)], [-1, 0, 0], 6, fitting)) return ss;
    }
    return undefined;
  };
  const ends = { front: [] as number[], rear: [] as number[] };
  for (let t = 0; t < s.n; t++) {
    const m = info(t);
    if (!m.glass || m.hidden || m.zone !== 'exterior' || Math.abs(s.nrm[t * 3 + 2]!) < 0.4 || Math.abs(s.nrm[t * 3]!) > 0.6) continue;
    const list = car.s(centroid(s, t)[2]) < car.spec.length / 2 ? ends.front : ends.rear;
    for (let j = 0; j < 3; j++) list.push(s.v[t * 9 + j * 3 + 1]!);
  }
  for (const [key, front, foot] of [['screenFoot', true, true], ['screenTop', true, false], ['backLightTop', false, false], ['backLightFoot', false, true]] as const) {
    const ref = refs?.[key]?.v;
    const ys = front ? ends.front : ends.rear;
    const y = Array.isArray(ref) && typeof ref[1] === 'number' ? ref[1] : ys.length > 0 ? (foot ? Math.min(...ys) : Math.max(...ys)) : undefined;
    if (y === undefined) continue;
    const inward = foot ? 1 : -1;
    const a = edge(y + inward * 0.06, front), b = edge(y + inward * 0.12, front);
    out[key] = a === undefined || b === undefined ? undefined : [r3(2 * a - b), r3(y)];
    // ds/dy of the edge: the drawn corner is judged by its distance across that line.
    if (a !== undefined && b !== undefined) out[`${key}Slope`] = (b - a) / (0.06 * inward);
  }

  // Lines from the left: what a side view sees at (s, y), past the mirrors and wipers.
  const side = (ss: number, y: number) => {
    const hit = grid.nearest([3, y, car.z(ss)], [-1, 0, 0], 3, fitting);
    if (!hit) return undefined;
    const m = info(hit.tri);
    return { glass: m.glass && Math.abs(s.nrm[hit.tri * 3]!) > 0.5, x: 3 - hit.t, owner: m.owner };
  };
  /** The side glass's foot and top at s: the first run of glass up from the sill. */
  const pane = (ss: number): [number, number] | undefined => {
    let foot: number | undefined, top: number | undefined;
    for (let y = 0.3; y < h; y += 0.002) {
      if (side(ss, y)?.glass) { foot ??= y; top = y; } else if (foot !== undefined) break;
    }
    return foot === undefined || top === undefined ? undefined : [foot, top];
  };
  /**
   * Runs of side glass along the car: s counts as glass when a line from the left meets
   * side glass anywhere in the band [y0, y1] (every 1 cm), so a pane whose foot rises
   * (a quarter glass behind a rising belt) or a raked edge still counts at its drawn end.
   */
  const runs = (y0: number, y1: number): number[][] => {
    const list: number[][] = [];
    let open: number | undefined;
    for (let ss = 0; ss <= s1; ss += 0.004) {
      let g = false;
      for (let y = y0; y <= y1 + 1e-9 && !g; y += 0.01) g = side(ss, y)?.glass ?? false;
      if (g && open === undefined) open = ss;
      if (!g && open !== undefined) { if (ss - open > 0.02) list.push([r3(open), r3(ss - 0.004)]); open = undefined; }
    }
    return list;
  };
  let doorS0 = Infinity, doorS1 = -Infinity, doorLow = Infinity;
  for (let t = 0; t < s.n; t++) {
    const m = info(t);
    if (m.owner !== 'door_fl' || m.slot !== 'paint' || m.hidden) continue;
    for (let j = 0; j < 3; j++) {
      const ss = car.s(s.v[t * 9 + j * 3 + 2]!);
      doorS0 = Math.min(doorS0, ss); doorS1 = Math.max(doorS1, ss);
      doorLow = Math.min(doorLow, s.v[t * 9 + j * 3 + 1]!);
    }
  }
  const first = doorS0 < doorS1 ? pane((doorS0 + doorS1) / 2) : undefined;
  if (first) {
    // The belt and the rail at the middle of the front door's glass, not of the door: a
    // door's frame runs up the A pillar.
    const belt = runs(first[0] + 0.03, first[0] + 0.03);
    const glassRun = belt.find((r) => r[1]! > doorS0 && r[0]! < doorS1 && r[1]! - r[0]! > 0.2);
    const mid = glassRun ? (glassRun[0]! + glassRun[1]!) / 2 : (doorS0 + doorS1) / 2;
    const [foot, top] = pane(mid) ?? first;
    out.beltY = r3(foot);
    out.railY = r3(top);
    // Just over the belt (a 10 cm band: a quarter glass's foot rises behind the doors) and
    // just under the rail (5 cm: a raked pillar's edge is read at the top).
    out.sideGlassBelt = runs(foot - 0.02, foot + 0.08);
    out.sideGlassRail = runs(top - 0.04, top + 0.01);
    // Shut lines 10 cm under the belt: clear of the mirror's sail at a door's front top.
    const under = foot - 0.1;
    for (const [key, owner] of [['doorFront', 'door_fl'], ['doorRear', 'door_rl']] as const) {
      const segs = slice(s, (t) => info(t).owner === owner && info(t).slot === 'paint' && !info(t).hidden, 1, under);
      if (segs.length === 0) continue;
      const ss = segs.flat().map((p) => car.s(p[2]));
      out[key] = [r3(Math.min(...ss)), r3(Math.max(...ss))];
    }
    const skin = side(mid, foot - 0.05);
    if (skin) out.beltHalfWidth = r3(skin.x);
    // The waist strip on the front door, near its middle.
    let m0 = Infinity, m1 = -Infinity;
    for (let t = 0; t < s.n; t++) {
      const m = info(t);
      if (m.owner !== 'door_fl' || !/waist/.test(m.name) || m.hidden) continue;
      if (Math.abs(car.s(centroid(s, t)[2]) - mid) > 0.15) continue;
      for (let j = 0; j < 3; j++) { m0 = Math.min(m0, s.v[t * 9 + j * 3 + 1]!); m1 = Math.max(m1, s.v[t * 9 + j * 3 + 1]!); }
    }
    if (m0 < m1) out.moulding = [r3(m0), r3(m1)];
    out.doorBottomY = r3(doorLow);
  }
  // The left mirror's glass.
  const glass: V3[] = [];
  for (let t = 0; t < s.n; t++) if (info(t).mirror === 'left') glass.push(centroid(s, t));
  if (glass.length > 0) {
    const c = glass.reduce<V3>((a, p) => [a[0] + p[0] / glass.length, a[1] + p[1] / glass.length, a[2] + p[2] / glass.length], [0, 0, 0]);
    out.mirror = [r3(car.s(c[2])), r3(c[1])];
  }
  const roof = slice(s, shell, 1, h - 0.03);
  if (roof.length > 0) out.roofHalfWidth = r3(Math.max(...roof.flat().map((p) => Math.abs(p[0]))));
  for (const [key, owner] of [['bonnet', 'bonnet'], ['bootLid', 'boot']] as const) {
    const segs = slice(s, (t) => info(t).owner === owner && info(t).slot === 'paint' && !info(t).hidden, 0, 0.0005);
    if (segs.length === 0) continue;
    const ss = segs.flat().map((p) => car.s(p[2]));
    out[key] = [r3(Math.min(...ss)), r3(Math.max(...ss))];
  }
  return out;
}

/** Spokes of the steering wheel: runs of its geometry round a ring between hub and rim, probed through its plane. */
function wheelShape(car: KitCar, s: Soup): { spokes: number; diameter: number } | undefined {
  const tris: number[] = [];
  for (let t = 0; t < s.n; t++) if (/(^|\/)steering_wheel\//.test(s.meshes[s.mesh[t]!]!.path) && !s.meshes[s.mesh[t]!]!.hidden) tris.push(t);
  if (tris.length === 0) return undefined;
  // The rim's plane: the vertices' smallest spread (power iteration on the covariance's inverse is overkill; the rim dominates).
  const pts = tris.flatMap((t) => [0, 1, 2].map((j): V3 => [s.v[t * 9 + j * 3]!, s.v[t * 9 + j * 3 + 1]!, s.v[t * 9 + j * 3 + 2]!]));
  const c = pts.reduce<V3>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
  const cov = new THREE.Matrix3();
  const e = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e[i * 3 + j]! += d[i]! * d[j]!;
  }
  cov.set(e[0]!, e[1]!, e[2]!, e[3]!, e[4]!, e[5]!, e[6]!, e[7]!, e[8]!);
  // Smallest eigenvector: power iteration on (trace·I − C).
  const tr = e[0]! + e[4]! + e[8]!;
  let n = new THREE.Vector3(0.3, 0.5, 0.8).normalize();
  for (let k = 0; k < 60; k++) {
    const v = n.clone().applyMatrix3(cov);
    n = new THREE.Vector3(tr * n.x - v.x, tr * n.y - v.y, tr * n.z - v.z).normalize();
  }
  const axis: V3 = [n.x, n.y, n.z];
  const radial = (p: V3): number => { const d = sub(p, c); const a = dot3(d, axis); return Math.hypot(d[0] - axis[0] * a, d[1] - axis[1] * a, d[2] - axis[2] * a); };
  const R = Math.max(...pts.map(radial));
  const u = norm(Math.abs(axis[1]) < 0.9 ? [axis[2], 0, -axis[0]] : [1, 0, 0]);
  const v = norm([axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]]);
  const own = new Set(tris);
  const grid = new RayGrid(s, (t) => own.has(t));
  const counts: number[] = [];
  for (const k of [0.55, 0.62, 0.7]) {
    const hits: boolean[] = [];
    for (let i = 0; i < 360; i++) {
      const a = (i * Math.PI) / 180;
      const p: V3 = [c[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * R * k, c[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * R * k, c[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * R * k];
      hits.push(grid.nearest([p[0] + axis[0] * 0.2, p[1] + axis[1] * 0.2, p[2] + axis[2] * 0.2], [-axis[0], -axis[1], -axis[2]], 0.4) !== null);
    }
    let runs = 0;
    for (let i = 0; i < 360; i++) if (hits[i] && !hits[(i + 359) % 360]) runs++;
    if (hits.every(Boolean)) runs = 0;
    counts.push(runs);
  }
  counts.sort((a, b) => a - b);
  return { spokes: counts[1]!, diameter: r3(2 * R) };
}

function measureDash(car: KitCar, s: Soup): Record<string, Value | undefined> {
  const out: Record<string, Value | undefined> = {};
  const dials: V3[] = [];
  car.root.traverse((n) => {
    // One `panel_dim_<channel>` group per gauge; two needles on one face count once.
    if (!n.name.startsWith('panel_dim_') || n instanceof THREE.Mesh) return;
    const p = new THREE.Vector3().setFromMatrixPosition(n.matrixWorld);
    if (!dials.some((d) => Math.hypot(d[0] - p.x, d[1] - p.y, d[2] - p.z) < 0.01)) dials.push([p.x, p.y, p.z]);
  });
  out.gauges = dials.length;
  const rows: number[][] = [];
  for (const d of [...dials].sort((a, b) => b[1] - a[1])) {
    const row = rows.find((r) => Math.abs(r[0]! - d[1]) < 0.03);
    if (row) row[1]!++;
    else rows.push([d[1], 1]);
  }
  out.dialRows = rows.map((r) => r[1]!);
  const wheel = car.root.getObjectByName('steering_wheel');
  if (wheel && dials.length > 0) {
    const wx = new THREE.Vector3().setFromMatrixPosition(wheel.matrixWorld).x;
    const mx = dials.reduce((a, d) => a + d[0], 0) / dials.length;
    out.clusterAt = Math.abs(mx - wx) < 0.15 ? 'wheel' : 'centre';
  }
  const shape = wheelShape(car, s);
  if (shape) { out.wheelSpokes = shape.spokes; out.wheelDiameter = shape.diameter; }
  const glove = car.root.getObjectByName('glovebox');
  out.glovebox = glove ? (new THREE.Vector3().setFromMatrixPosition(glove.matrixWorld).x < 0 ? 'passenger' : 'driver') : 'none';
  const items = (car.root.userData.kitDash ?? []) as readonly KitDashItem[];
  out.clock = items.some((i) => i.kind === 'clock');
  out.stack = items.some((i) => i.kind === 'stack');
  out.console = items.some((i) => i.kind === 'console');
  out.vents = items.filter((i) => i.kind === 'vent' || i.kind === 'eyeball').length;
  return out;
}

// ---------------------------------------------------------------- comparing

interface Row {
  key: string;
  ref: Value;
  got: Value | undefined;
  ok: boolean;
  tol?: number;
  src: string;
  /** Listed, not judged: the overall box, which kit-proportions holds to the factory. */
  info?: boolean;
}

/**
 * The overall box is drawn on the period drawing, which stands lower than the passport,
 * and the loader grows the car to the passport (README "Frame of reference"); its
 * per-axis stretch is kit-proportions' advisory (3 %). Here it is listed against that.
 */
const OVERALL = new Set(['length', 'width', 'height']);
const STRETCH = 0.03;

/** `slope` (ds/dy) for a profile corner: its distance is taken across the measured line, not along the car. */
function compare(key: string, ref: Ref, got: Value | undefined, slope?: Value): Row {
  const info = OVERALL.has(key);
  const tol = info && typeof ref.v === 'number' ? Math.abs(ref.v) * STRETCH : ref.tol ?? TOL[key] ?? 0;
  const target = ref.accepted?.v ?? ref.v;
  const row: Row = { key, ref: target, got, ok: false, tol: r3(tol), src: ref.accepted ? `accepted, real ${show(ref.v)}: ${ref.accepted.why}` : ref.src, info };
  if (got === undefined) return row;
  const flat = (v: Value): (number | string | boolean)[] => (Array.isArray(v) ? (v as (number | number[])[]).flat() : [v]);
  const a = flat(target), b = flat(got);
  if (a.length !== b.length) return row;
  if (typeof slope === 'number' && typeof a[0] === 'number' && typeof b[0] === 'number') {
    row.ok = Math.abs(a[0] - b[0]) / Math.hypot(1, slope) <= tol + 1e-9;
    return row;
  }
  row.ok = a.every((x, i) => (typeof x === 'number' && typeof b[i] === 'number' ? Math.abs(x - (b[i] as number)) <= tol + 1e-9 : x === b[i]));
  return row;
}

const show = (v: Value | undefined): string => (v === undefined ? 'n/a' : JSON.stringify(v));

// ---------------------------------------------------------------- overlays

/** The drawing's view, the model traced at its registration, and the drawing with the model's outline. */
async function overlayView(car: KitCar, s: Soup, grid: RayGrid, reg: Registration, view: 'side' | 'front'): Promise<Image | undefined> {
  const path = `${ROOT}${reg.image}`;
  if (!existsSync(path)) return undefined;
  const [x0, y0, x1, y1] = reg.crop;
  const ref = await loadImage(path, reg.crop);
  const w = x1 - x0, h = y1 - y0;
  const half = car.spec.length / 2;
  const toPoint = (px: number, py: number): V3 => {
    const sx = x0 + px + 0.5, sy = y0 + py + 0.5;
    const y = (reg.y[0] - sy) * reg.y[1];
    if (view === 'side') return [0, y, half - (sx - reg.s![0]) * reg.s![1]];
    return [(sx - reg.x![0]) * reg.x![1], y, 0];
  };
  const ray = orthographic(toPoint, view === 'side' ? [-1, 0, 0] : [0, 0, -1]);
  const shifted = view === 'side'
    ? (px: number, py: number) => { const r = ray(px, py)!; return { o: [3, r.o[1], r.o[2]] as V3, d: r.d }; }
    : (px: number, py: number) => { const r = ray(px, py)!; return { o: [r.o[0], r.o[1], half + 3] as V3, d: r.d }; };
  const tr = trace(s, grid, w, h, shifted, undefined, [255, 255, 255, 255]);
  const fill = image(w, h);
  for (let i = 0; i < w * h; i++) if (tr.ids[i]! >= 0) fill.px.set([255, 60, 60, 50], i * 4);
  const lined = over(over(ref, fill), outline(s, tr, [220, 0, 0, 255]));
  return sideBySide([ref, tr.img, lined]);
}

/** The cabin from the driver's eye (70°, a little down, as the photos are taken) beside the reference interior photo. */
async function cabinSheet(car: KitCar, s: Soup, grid: RayGrid, refs: RefFile): Promise<Image | undefined> {
  const photo = refs.dash?.photo;
  const tag = photo && 'src' in photo ? photo.src : undefined;
  const file = tag ? refs.sources[tag]?.image : undefined;
  const eye = nodeAt(car.root, 'kit_driver_eye');
  if (!eye) return undefined;
  const h = 400;
  const cabin = trace(s, grid, 640, h, perspective(eye, 0, -0.18, 70, 640, h).ray, undefined, [235, 240, 245, 255]).img;
  if (!file || !existsSync(`${ROOT}${file}`)) return cabin;
  return sideBySide([cabin, await loadImage(`${ROOT}${file}`, undefined, h)]);
}

// ---------------------------------------------------------------- per car

export interface DrawingResult {
  id: string;
  body: 'VERIFIED' | 'MISMATCH' | 'UNVERIFIED';
  dash: 'OK' | 'MISMATCH' | 'DASH UNVERIFIED';
  rows: Row[];
  dashRows: Row[];
  measured: Measured;
  note?: string;
  images: string[];
}

export async function checkDrawing(id: string, images: boolean): Promise<DrawingResult> {
  const car = buildCar(id);
  const s = soupOf(car.root);
  const grid = new RayGrid(s, (t) => !s.meshes[s.mesh[t]!]!.hidden);
  const refs = readRefs(id);
  const measured: Measured = { body: measureBody(car, s, grid, refs?.body), dash: measureDash(car, s) };
  const rows: Row[] = [];
  const dashRows: Row[] = [];
  for (const [key, ref] of Object.entries(refs?.body ?? {})) rows.push(compare(key, ref, measured.body[key], measured.body[`${key}Slope`]));
  const hasPhoto = !!refs?.dash?.photo;
  for (const [key, ref] of Object.entries(refs?.dash ?? {})) if (key !== 'photo' && isRef(ref)) dashRows.push(compare(key, ref, measured.dash[key]));
  const judged = rows.filter((r) => !r.info);
  const body = judged.length === 0 ? 'UNVERIFIED' : judged.every((r) => r.ok) ? 'VERIFIED' : 'MISMATCH';
  const dash = !hasPhoto || dashRows.length === 0 ? 'DASH UNVERIFIED' : dashRows.every((r) => r.ok) ? 'OK' : 'MISMATCH';
  const saved: string[] = [];
  if (images) {
    const dir = await outDir(id);
    const opaque = new RayGrid(s, (t) => !s.meshes[s.mesh[t]!]!.hidden && !s.meshes[s.mesh[t]!]!.glass);
    for (const view of ['side', 'front'] as const) {
      const reg = refs?.overlay?.[view];
      if (!reg) continue;
      const sheet = await overlayView(car, s, opaque, reg, view);
      if (!sheet) continue;
      await savePng(sheet, `${dir}drawing-${view}.png`);
      saved.push(`${dir}drawing-${view}.png`);
    }
    if (refs) {
      const sheet = await cabinSheet(car, s, grid, refs);
      if (sheet) { await savePng(sheet, `${dir}cabin-vs-photo.png`); saved.push(`${dir}cabin-vs-photo.png`); }
    }
  }
  return { id, body, dash, rows, dashRows, measured, note: refs ? refs.dashNote : 'no src/carkit/refs file', images: saved };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf('--json');
  const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
  const ids = kitIds(args.filter((_, i) => jsonAt < 0 || i !== jsonAt + 1));
  const images = !args.includes('--no-images');
  const results: DrawingResult[] = [];
  for (const id of ids) {
    const r = await checkDrawing(id, images);
    results.push(r);
    const judged = r.rows.filter((x) => !x.info);
    console.log(`\n${id}: body ${r.body} (${judged.filter((x) => x.ok).length}/${judged.length}), dash ${r.dash} (${r.dashRows.filter((x) => x.ok).length}/${r.dashRows.length})${r.note ? ` — ${r.note}` : ''}`);
    for (const row of [...r.rows, ...r.dashRows]) {
      if (row.ok) continue;
      console.log(`  ${row.info ? '~ (kit-proportions)' : '✗'} ${row.key.padEnd(15)} real ${show(row.ref).padEnd(28)} built ${show(row.got).padEnd(28)} ±${row.tol}  [${row.src}]`);
    }
  }
  console.log('\ncar             body         values   dash              values');
  for (const r of results) {
    const judged = r.rows.filter((x) => !x.info);
    console.log(`${r.id.padEnd(15)} ${r.body.padEnd(12)} ${`${judged.filter((x) => x.ok).length}/${judged.length}`.padStart(6)}   ${r.dash.padEnd(16)} ${`${r.dashRows.filter((x) => x.ok).length}/${r.dashRows.length}`.padStart(6)}`);
  }
  if (jsonPath) await Bun.write(jsonPath, JSON.stringify(results, null, 1));
  const bad = results.filter((r) => r.body === 'MISMATCH' || r.dash === 'MISMATCH');
  if (bad.length > 0) {
    console.log(`\nFAIL: ${bad.length} car(s) off their drawing or photos`);
    process.exit(1);
  }
  console.log('\nPASS: every referenced value within tolerance');
}
