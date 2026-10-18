/**
 * tools/kit-surface.ts
 *
 * Dents, kinks and over-complexity on every kit car, found on the built car and its loft.
 *
 *   nice -n 15 bun tools/kit-surface.ts [--json out.json] [--no-images] [id ...]   (default: every kit car)
 *
 * DENTS AND KINKS. The tub is lofted through the spec's `stations` (body.ts): each row of
 * the side (sill, crease, belt, the shoulder's edge) runs straight from station to
 * station, so the side turns only at stations, and the rows themselves are the intended
 * feature lines (with the door cuts, the arch lips round the wheels and the shut lines,
 * which the generator draws from the spec and which are never flagged). What is checked
 * is how the side turns at each station:
 *   uneven   a row's plan turns at one station much harder than at its neighbours while
 *            they turn the same way: the curve breaks there (the Astra F's wing before
 *            41b9498: −18° at s 0.30 between −2° and −4.5°). Flagged when the turn is over
 *            2.5 times the larger neighbour's and 5° more than it, the neighbours turning
 *            at least 1.5° the same way;
 *   s-bend   two neighbouring stations, under 0.5 m apart, turning opposite ways by over
 *            3° each: a bulge or a dent in plan;
 *   lean     the side's lean between two rows (sill–crease, crease–belt) going in and out
 *            from station to station, by over 0.9° each way: facets that turn in and out
 *            (the same Astra wing: 9.1°, 5.7°, 6.7°, 5.7°, 9.1°, 7.9°);
 *   deck     the same `uneven` and `s-bend` tests on the deck's centre line in profile
 *            (bonnet and boot lid).
 * Intended breaks: the first and last turn of a row (the station next to an end, where
 * the side turns into the face or the tail) and any station the spec marks `corner`
 * (`TubStation.corner`, with its source) are never flagged.
 * On the built mesh, for every painted shell panel (body, doors, bonnet, boot or
 * tailgate, flap), the skin is what an exterior viewpoint (37 round the car, as
 * kit-zfight's) sees, and:
 *   concave  a fold of more than 5° between two upward-facing skin triangles of a bonnet,
 *            boot lid, tailgate or the roof that bends inward: a dent in a surface the
 *            deck's crown and the roof's make convex (the crown's own facets fold under
 *            5°; the roof's rail chamfer and its 6 cm header rows at the screen and the
 *            back light are drawn so and not tested);
 *   flip     (listed, not a gate) up-facing skin wound inward. Lighting is double sided,
 *            but the condition shader reads "up" off the stored normal for dust and rust
 *            (render/materials.ts `vCondWorldNormal`), so such a facet stays clean on a
 *            dirty car.
 * Hits of one kind on one owner within 0.2 m are one finding. Every dent is printed with
 * its owner (`BodyFrame.flankOwner` on the side), s, height and value, and gets a crop in
 * build/kitcheck/<car>/surface-<n>.png (an oblique view at the spot, grazing light, the
 * spot ringed red).
 *
 * COMPLEXITY. Per car: triangles per zone (body and trim, cabin, bay, boot, underbody,
 * wheels) against the budget (src/carkit/README.md: 8–13k a car; over 15k fails);
 * per panel, sliver triangles (an angle under 1°) and tiny ones (under 1 mm²); stations
 * that add nothing (every row and the deck within 1 mm of the line through their
 * neighbours); and the parts (each triangle's emitter, `installProvenance`) whose triangle
 * count is out of proportion to their size. Each finding names a simplification.
 *
 * Gates (exit 1): any dent or kink above; a car over 15 000 triangles; a panel whose
 * slivers are over 30 % of it (and over 20 triangles: a strip cut into ribbons); a part of
 * over 200 triangles at over 4 triangles per cm² of its bounding box's largest face.
 * Warnings are printed and listed (over 13 000 triangles, panels over 10 % slivers or
 * tiny triangles, redundant stations, smaller dense parts, flips).
 *
 * Nothing here is part of the game bundle.
 */

import { readdirSync, unlinkSync } from 'node:fs';
import { installAssetShim } from './assetshim';
import {
  buildCar, centroid, dot3, installProvenance, kitIds, lookAt, norm, outDir, RayGrid, savePng, siteParts, soupOf, sub, trace,
  dot, type Finding, type KitCar, type Soup, type V3,
} from './kitlib';

installProvenance();
installAssetShim();

// ---------------------------------------------------------------- tolerances
const UNEVEN_RATIO = 2.5;
const UNEVEN_EXCESS = 5; // degrees
const UNEVEN_NEIGHBOUR = 1.5; // degrees: the neighbours must really turn
const SBEND_DEG = 3;
const SBEND_SPAN = 0.5; // m
const LEAN_ZIG = 0.9; // degrees
/** Folds of a crowned lid's or the roof's own facets stay under this; a dent is more. */
const CONCAVE_DEG = 5;
/** The roof's front and rear header rows (the screen's and the back light's) are drawn so. */
const ROOF_HEADER = 0.06;
/** A flip counts on skin facing up at least this much (the dust's "up"), from 1 cm². */
const FLIP_UP = 0.3;
const FLIP_AREA = 1e-4;
/** Hits closer than this (same kind, owner and side) are one finding. */
const CLUSTER_M = 0.2;
const BUDGET = 13000;
const BUDGET_HARD = 15000;
const SLIVER_DEG = 1;
const TINY_AREA = 1e-6; // m²
const SLIVER_SHARE = 0.3;
const SLIVER_WARN = 0.1;
const SLIVER_MIN = 20;
const REDUNDANT_M = 0.001;
const DENSE_WARN = 2; // triangles per cm² of the bbox's largest face
const DENSE_FAIL = 4;
const DENSE_MIN_TRIS = 60;
const DENSE_FAIL_TRIS = 200;

const deg = (r: number): number => (r * 180) / Math.PI;

export interface SurfaceHit {
  kind: 'uneven' | 's-bend' | 'lean' | 'deck' | 'flip' | 'concave';
  owner: string;
  s: number;
  y: number;
  x: number;
  value: number;
  what: string;
  image?: string;
}

// ---------------------------------------------------------------- loft

/** Turns (degrees) of a polyline v(s) at each interior station: + bends towards +v. */
function turns(ss: readonly number[], v: readonly number[]): (number | undefined)[] {
  return ss.map((_, i) => {
    if (i === 0 || i + 1 >= ss.length) return undefined;
    const a = Math.atan2(v[i]! - v[i - 1]!, ss[i]! - ss[i - 1]!);
    const b = Math.atan2(v[i + 1]! - v[i]!, ss[i + 1]! - ss[i]!);
    return deg(b - a);
  });
}

/** The `uneven` and `s-bend` hits of one polyline. */
function curveHits(ss: readonly number[], v: readonly number[], intended: (i: number) => boolean, at: (i: number) => { owner: string; y: number; x: number }, label: string, kind: 'uneven' | 'deck'): SurfaceHit[] {
  const th = turns(ss, v);
  const out: SurfaceHit[] = [];
  for (let i = 1; i + 1 < ss.length; i++) {
    const t = th[i]!;
    if (intended(i)) continue;
    const nb = [th[i - 1], th[i + 1]].filter((x): x is number => x !== undefined);
    const big = Math.max(...nb.map(Math.abs));
    if (nb.length > 0 && nb.every((x) => Math.sign(x) === Math.sign(t) && Math.abs(x) >= UNEVEN_NEIGHBOUR) && Math.abs(t) > UNEVEN_RATIO * big && Math.abs(t) - big > UNEVEN_EXCESS) {
      out.push({ kind, ...at(i), s: ss[i]!, value: Math.abs(t), what: `${label} turns ${t.toFixed(1)}° at s ${ss[i]!.toFixed(2)} between ${nb.map((x) => `${x.toFixed(1)}°`).join(' and ')}: the curve breaks (smooth the stations round it)` });
    }
    const n = th[i + 1];
    if (n !== undefined && !intended(i + 1) && Math.sign(n) !== Math.sign(t) && Math.min(Math.abs(n), Math.abs(t)) > SBEND_DEG && ss[i + 1]! - ss[i]! < SBEND_SPAN) {
      out.push({ kind: kind === 'deck' ? 'deck' : 's-bend', ...at(i), s: (ss[i]! + ss[i + 1]!) / 2, value: Math.min(Math.abs(n), Math.abs(t)), what: `${label} turns ${t.toFixed(1)}° at s ${ss[i]!.toFixed(2)} and ${n.toFixed(1)}° at ${ss[i + 1]!.toFixed(2)}: in and out (a dent or a bulge; one of the two stations is off the line)` });
    }
  }
  return out;
}

export function loftHits(car: KitCar): SurfaceHit[] {
  const { spec, frame } = car;
  const byS = new Map<number, (typeof spec.stations)[number]>();
  for (const st of spec.stations) byS.set(st.s, st);
  const ss = [...byS.keys()].sort((a, b) => a - b);
  const n = ss.length;
  const secs = ss.map((s) => frame.section(s));
  // The first and last turn are the corners into the face and the tail; a station the spec
  // marks `corner` is drawn so.
  const intended = (i: number): boolean => i <= 1 || i >= n - 2 || byS.get(ss[i]!)!.corner === true;
  const rows = [['sill', 'r1'], ['crease', 'r2'], ['belt', 'r3'], ['shoulder edge', 'r4']] as const;
  const out: SurfaceHit[] = [];
  for (const [name, key] of rows) {
    const at = (i: number) => {
      const [x, y] = secs[i]![key];
      return { owner: frame.flankOwner(ss[i]!, Math.min(y, spec.stations[0]!.belt), 1), y, x };
    };
    out.push(...curveHits(ss, secs.map((sec) => sec[key][0]), intended, at, `the ${name}'s plan`, 'uneven'));
  }
  // The deck's centre line in profile, over the bonnet and over the boot.
  for (const [from, to, owner] of [[0, frame.cowl, 'bonnet'], [frame.rearBase, spec.length, frame.lidOwner]] as const) {
    const idx = ss.map((s, i) => [s, i] as const).filter(([s]) => s >= from && s <= to).map(([, i]) => i);
    if (idx.length < 3) continue;
    const sub = idx.map((i) => ss[i]!);
    const subIntended = (k: number): boolean => intended(idx[k]!);
    out.push(...curveHits(sub, idx.map((i) => secs[i]!.st.deck), subIntended, (k) => ({ owner, y: secs[idx[k]!]!.st.deck, x: 0 }), `the ${owner}'s centre line`, 'deck'));
  }
  // The side's lean between rows going in and out.
  for (const [lo, hi] of [['r1', 'r2'], ['r2', 'r3']] as const) {
    const al = secs.map((sec) => deg(Math.atan2(sec[lo][0] - sec[hi][0], sec[hi][1] - sec[lo][1])));
    for (let i = 1; i + 1 < n; i++) {
      if (byS.get(ss[i]!)!.corner) continue;
      const d1 = al[i]! - al[i - 1]!, d2 = al[i + 1]! - al[i]!;
      if (d1 * d2 >= 0 || Math.min(Math.abs(d1), Math.abs(d2)) <= LEAN_ZIG) continue;
      const y = (secs[i]![lo][1] + secs[i]![hi][1]) / 2;
      const band = lo === 'r1' ? 'sill–crease' : 'crease–belt';
      out.push({
        kind: 'lean', owner: frame.flankOwner(ss[i]!, y, 1), s: ss[i]!, y, x: (secs[i]![lo][0] + secs[i]![hi][0]) / 2,
        value: Math.min(Math.abs(d1), Math.abs(d2)),
        what: `the side's ${band} lean ${al.slice(i - 1, i + 2).map((a) => `${a.toFixed(1)}°`).join(' → ')} at s ${ss[i - 1]!.toFixed(2)}/${ss[i]!.toFixed(2)}/${ss[i + 1]!.toFixed(2)}: in and out (even the lean, e.g. one rate per metre of rise)`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the built mesh

/** 37 exterior viewpoints, as kit-zfight's. */
function exteriorViews(length: number): V3[] {
  const out: V3[] = [];
  const r = length / 2 + 2.2;
  for (let az = 0; az < 360; az += 30) {
    const a = (az * Math.PI) / 180;
    for (const [rr, h] of [[r, 0.35], [r, 1.6], [r + 1, 3.2]] as const) out.push([Math.sin(a) * rr, h, Math.cos(a) * rr]);
  }
  out.push([0, 4.5, 0]);
  return out;
}

const PANEL = /^(body|door_[fr][lr]|bonnet|boot|tailgate(_[lr])?|flap)$/;

export function meshHits(car: KitCar, s: Soup, grid: RayGrid): SurfaceHit[] {
  const views = exteriorViews(car.spec.length);
  const out: SurfaceHit[] = [];
  // Skin: painted shell triangles an exterior view sees; `outward` from the side it sees.
  const outward = new Map<number, V3>();
  for (let t = 0; t < s.n; t++) {
    const m = s.meshes[s.mesh[t]!]!;
    if (m.slot !== 'paint' || m.zone !== 'exterior' || m.hidden || !PANEL.test(m.owner) || s.area[t]! < 1e-7) continue;
    const c = centroid(s, t);
    const n: V3 = [s.nrm[t * 3]!, s.nrm[t * 3 + 1]!, s.nrm[t * 3 + 2]!];
    for (const v of views) {
      const side = dot3(sub(v, c), n) > 0 ? 1 : -1;
      const o: V3 = [c[0] + n[0] * side * 3e-4, c[1] + n[1] * side * 3e-4, c[2] + n[2] * side * 3e-4];
      if (grid.blocked(o, v, t)) continue;
      outward.set(t, [n[0] * side, n[1] * side, n[2] * side]);
      break;
    }
  }
  // Edges between skin triangles of one mesh, welded at 0.1 mm.
  const key = (x: number, y: number, z: number): string => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const edges = new Map<string, number[]>();
  for (const t of outward.keys()) {
    const k = [0, 1, 2].map((j) => key(s.v[t * 9 + j * 3]!, s.v[t * 9 + j * 3 + 1]!, s.v[t * 9 + j * 3 + 2]!));
    for (let j = 0; j < 3; j++) {
      const a = k[j]!, b = k[(j + 1) % 3]!;
      const e = `${s.mesh[t]}|${a < b ? `${a}|${b}` : `${b}|${a}`}`;
      let l = edges.get(e);
      if (!l) edges.set(e, (l = []));
      l.push(t);
    }
  }
  // Flips: up-facing skin wound inward. Lighting is double sided, but the condition shader's
  // dust and rust read "up" off the stored normal (render/materials.ts `vCondWorldNormal`):
  // such a facet stays clean on a dirty bonnet.
  for (const [t, n] of outward) {
    if (n[1] < FLIP_UP || s.area[t]! < FLIP_AREA) continue;
    if (dot3([s.nrm[t * 3]!, s.nrm[t * 3 + 1]!, s.nrm[t * 3 + 2]!], n) >= 0) continue;
    const c = centroid(s, t);
    const m = s.meshes[s.mesh[t]!]!;
    out.push({ kind: 'flip', owner: m.owner, s: car.s(c[2]), y: c[1], x: c[0], value: s.area[t]! * 1e4, what: `${m.path}: up-facing skin wound inward (its normal points into the car): dust and wear read it as an underside; wind it outward` });
  }
  // Concave folds on the up-facing skin of the lids and of the roof inside its edges (the
  // rail's chamfer at the sides, the headers at its ends).
  const roofEdge = car.spec.cabin.rail + car.spec.cabin.railRise + 0.005;
  const above = (t: number): boolean => s.v[t * 9 + 1]! > roofEdge && s.v[t * 9 + 4]! > roofEdge && s.v[t * 9 + 7]! > roofEdge;
  let roofS0 = Infinity, roofS1 = -Infinity;
  for (const t of outward.keys()) {
    if (s.meshes[s.mesh[t]!]!.owner !== 'body' || !above(t)) continue;
    for (let j = 0; j < 3; j++) {
      roofS0 = Math.min(roofS0, car.s(s.v[t * 9 + j * 3 + 2]!));
      roofS1 = Math.max(roofS1, car.s(s.v[t * 9 + j * 3 + 2]!));
    }
  }
  const inRoof = (t: number): boolean => {
    if (!above(t)) return false;
    const ts = car.s(centroid(s, t)[2]);
    return ts > roofS0 + ROOF_HEADER && ts < roofS1 - ROOF_HEADER;
  };
  for (const l of edges.values()) {
    if (l.length !== 2) continue;
    const [a, b] = l as [number, number];
    const na = outward.get(a)!, nb = outward.get(b)!;
    if (na[1] < 0.6 || nb[1] < 0.6) continue;
    const m = s.meshes[s.mesh[a]!]!;
    const ca = centroid(s, a), cb = centroid(s, b);
    const lid = /^(bonnet|boot|tailgate)/.test(m.owner);
    if (!lid && !(m.owner === 'body' && inRoof(a) && inRoof(b))) continue;
    const fold = deg(Math.acos(Math.max(-1, Math.min(1, dot3(na, nb)))));
    if (fold <= CONCAVE_DEG) continue;
    // Concave: b's centroid stands out of a's plane on its outer side.
    if (dot3(na, sub(cb, ca)) <= 0) continue;
    const mid: V3 = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2];
    out.push({ kind: 'concave', owner: m.owner === 'body' ? 'roof' : m.owner, s: car.s(mid[2]), y: mid[1], x: mid[0], value: fold, what: `folds in ${fold.toFixed(1)}°: a dent in a crowned surface (the stations or the roof's rows break there)` });
  }
  return cluster(out);
}

/** Hits of one kind on one owner within `CLUSTER_M` of each other, as one: the worst of them, counted. */
function cluster(hits: SurfaceHit[]): SurfaceHit[] {
  const parent = hits.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
    const a = hits[i]!, b = hits[j]!;
    if (a.kind !== b.kind || a.owner !== b.owner || Math.sign(a.x) !== Math.sign(b.x)) continue;
    if (Math.hypot(a.s - b.s, a.y - b.y, a.x - b.x) < CLUSTER_M) parent[find(i)] = find(j);
  }
  const groups = new Map<number, SurfaceHit[]>();
  hits.forEach((h, i) => {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(h);
  });
  return [...groups.values()].map((g) => {
    const worst = g.reduce((p, q) => (q.value > p.value ? q : p));
    const s0 = Math.min(...g.map((h) => h.s)), s1 = Math.max(...g.map((h) => h.s));
    const where = `s ${s0.toFixed(2)}${s1 - s0 > 0.01 ? `–${s1.toFixed(2)}` : ''}, x ${worst.x >= 0 ? '+' : ''}${worst.x.toFixed(2)}`;
    const size = worst.kind === 'flip' ? `${g.reduce((a, h) => a + h.value, 0).toFixed(0)} cm² in ${g.length} triangle(s)` : `${g.length} edge(s), worst`;
    return { ...worst, what: `${where}: ${size} ${worst.what}` };
  });
}

// ---------------------------------------------------------------- complexity

export interface Complexity {
  total: number;
  zones: Record<string, number>;
  findings: Finding[];
}

export function complexity(car: KitCar, s: Soup, prov: Int32Array): Complexity {
  const findings: Finding[] = [];
  const id = car.id;
  const zones: Record<string, number> = {};
  for (let t = 0; t < s.n; t++) {
    const m = s.meshes[s.mesh[t]!]!;
    const z = m.zone === 'exterior' ? 'body+trim' : m.zone.replace(/^kit_/, '');
    zones[z] = (zones[z] ?? 0) + 1;
  }
  const total = s.n;
  if (total > BUDGET_HARD) findings.push({ car: id, level: 'fail', what: `${total} triangles, over the hard limit ${BUDGET_HARD} (budget ${BUDGET}): ${Object.entries(zones).map(([k, v]) => `${k} ${v}`).join(', ')}` });
  else if (total > BUDGET) findings.push({ car: id, level: 'warn', what: `${total} triangles, over the budget ${BUDGET}: ${Object.entries(zones).map(([k, v]) => `${k} ${v}`).join(', ')}` });

  // Slivers and tiny triangles per mesh (not the placeholder wheels: the pack's replace them).
  const perMesh = new Map<number, { n: number; sliver: number; tiny: number }>();
  for (let t = 0; t < s.n; t++) {
    if (s.meshes[s.mesh[t]!]!.zone === 'wheel') continue;
    let c = perMesh.get(s.mesh[t]!);
    if (!c) perMesh.set(s.mesh[t]!, (c = { n: 0, sliver: 0, tiny: 0 }));
    c.n++;
    const o = t * 9;
    const p = [0, 1, 2].map((j): V3 => [s.v[o + j * 3]!, s.v[o + j * 3 + 1]!, s.v[o + j * 3 + 2]!]);
    let minAngle = 180;
    for (let j = 0; j < 3; j++) {
      const u = norm(sub(p[(j + 1) % 3]!, p[j]!)), w = norm(sub(p[(j + 2) % 3]!, p[j]!));
      minAngle = Math.min(minAngle, deg(Math.acos(Math.max(-1, Math.min(1, dot3(u, w))))));
    }
    if (minAngle < SLIVER_DEG) c.sliver++;
    if (s.area[t]! < TINY_AREA) c.tiny++;
  }
  for (const [mi, c] of perMesh) {
    const m = s.meshes[mi]!;
    if (c.sliver > SLIVER_MIN && c.sliver > SLIVER_SHARE * c.n) {
      findings.push({ car: id, level: 'fail', what: `${m.path}: ${c.sliver} of ${c.n} triangles are slivers (an angle under ${SLIVER_DEG}°): cut it along fewer, straighter lines or let simplifyFlats merge the run` });
    } else if (c.sliver + c.tiny >= 10 && c.sliver + c.tiny > SLIVER_WARN * c.n) {
      findings.push({ car: id, level: 'warn', what: `${m.path}: ${c.sliver} slivers (under ${SLIVER_DEG}°) and ${c.tiny} triangles under 1 mm² of ${c.n}: the cuts leave ribbons simplifyFlats cannot merge` });
    }
  }

  // Stations on the line through their neighbours.
  const ss = [...new Set(car.spec.stations.map((st) => st.s))].sort((a, b) => a - b);
  for (let i = 1; i + 1 < ss.length; i++) {
    const [a, b, c] = [ss[i - 1]!, ss[i]!, ss[i + 1]!];
    const k = (b - a) / (c - a);
    const sa = car.frame.section(a), sb = car.frame.section(b), sc = car.frame.section(c);
    let worst = 0;
    for (const key of ['r0', 'r1', 'r2', 'r3', 'r4'] as const) {
      for (const ax of [0, 1]) worst = Math.max(worst, Math.abs(sb[key][ax]! - (sa[key][ax]! + (sc[key][ax]! - sa[key][ax]!) * k)));
    }
    worst = Math.max(worst, Math.abs(sb.st.deck - (sa.st.deck + (sc.st.deck - sa.st.deck) * k)), Math.abs((sb.st.flat ?? 0) - ((sa.st.flat ?? 0) + ((sc.st.flat ?? 0) - (sa.st.flat ?? 0)) * k)));
    const notch = car.spec.stations.find((st) => st.s === b)?.notch !== undefined;
    if (worst < REDUNDANT_M && !notch) findings.push({ car: id, level: 'warn', what: `station s ${b.toFixed(3)} lies within ${(worst * 1000).toFixed(2)} mm of the line through s ${a.toFixed(3)} and ${c.toFixed(3)}: drop it` });
  }

  // Parts out of proportion: triangles per cm² of their bounding box's largest face.
  const parts = new Map<string, { n: number; min: V3; max: V3 }>();
  for (let t = 0; t < s.n; t++) {
    const m = s.meshes[s.mesh[t]!]!;
    if (m.zone === 'wheel') continue;
    const part = `${siteParts[prov[t]!] ?? '?'} [${m.path.split('/').slice(-2).join('/')}]`;
    let p = parts.get(part);
    if (!p) parts.set(part, (p = { n: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
    p.n++;
    for (let j = 0; j < 9; j++) {
      const ax = j % 3;
      p.min[ax] = Math.min(p.min[ax]!, s.v[t * 9 + j]!);
      p.max[ax] = Math.max(p.max[ax]!, s.v[t * 9 + j]!);
    }
  }
  for (const [part, p] of parts) {
    if (p.n < DENSE_MIN_TRIS) continue;
    const e = [0, 1, 2].map((ax) => Math.max(0.005, p.max[ax]! - p.min[ax]!) * 100).sort((a, b) => b - a);
    const face = e[0]! * e[1]!;
    const density = p.n / face;
    if (density > DENSE_FAIL && p.n > DENSE_FAIL_TRIS) findings.push({ car: id, level: 'fail', what: `${part}: ${p.n} triangles in ${e[0]!.toFixed(0)} × ${e[1]!.toFixed(0)} cm (${density.toFixed(1)}/cm²): build it from fewer segments` });
    else if (density > DENSE_WARN) findings.push({ car: id, level: 'warn', what: `${part}: ${p.n} triangles in ${e[0]!.toFixed(0)} × ${e[1]!.toFixed(0)} cm (${density.toFixed(1)}/cm²): fewer segments would read the same at its size` });
  }
  return { total, zones, findings };
}

// ---------------------------------------------------------------- per car

export async function checkSurface(id: string, images: boolean): Promise<{ hits: SurfaceHit[]; complexity: Complexity }> {
  const car = buildCar(id);
  const s = soupOf(car.root);
  const prov = new Int32Array(s.n);
  {
    let t = 0;
    for (const m of s.meshes) {
      const pv: number[] = m.node.geometry.userData.prov ?? [];
      const count = (m.node.geometry.index ? m.node.geometry.index.count : m.node.geometry.getAttribute('position').count) / 3;
      for (let i = 0; i < count; i++) prov[t++] = pv[i] ?? -1;
    }
  }
  const grid = new RayGrid(s, (t) => !s.meshes[s.mesh[t]!]!.glass && !s.meshes[s.mesh[t]!]!.hidden);
  const hits = [...loftHits(car), ...meshHits(car, s, grid)];
  const dents = hits.filter((h) => h.kind !== 'flip');
  if (images) {
    const dir = await outDir(id);
    for (const f of readdirSync(dir)) if (/^surface-\d+\.png$/.test(f)) unlinkSync(`${dir}${f}`);
    const view = new RayGrid(s, (t) => !s.meshes[s.mesh[t]!]!.hidden);
    for (const [i, h] of dents.entries()) {
      const at: V3 = [h.x, h.y, car.z(h.s)];
      const side = at[0] < 0 ? -1 : 1;
      const flank = h.kind === 'uneven' || h.kind === 's-bend' || h.kind === 'lean';
      // Oblique, from ahead and outside, so the light grazes the panel.
      const from: V3 = flank ? [at[0] + side * 1.1, at[1] + 0.45, at[2] + 1.4] : [at[0] + side * 0.9, at[1] + 1.1, at[2] + 1.3];
      const cam = lookAt(from, at, 38, 360, 270);
      const img = trace(s, view, 360, 270, cam.ray, undefined, [235, 240, 245, 255]).img;
      const p = cam.project(at);
      if (p) for (let a = 0; a < 48; a++) dot(img, p[0] + Math.cos((a / 48) * Math.PI * 2) * 14, p[1] + Math.sin((a / 48) * Math.PI * 2) * 14, [230, 20, 20, 255], 1);
      h.image = `${dir}surface-${i + 1}.png`;
      await savePng(img, h.image);
    }
  }
  return { hits, complexity: complexity(car, s, prov) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf('--json');
  const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
  const ids = kitIds(args.filter((_, i) => jsonAt < 0 || i !== jsonAt + 1));
  const images = !args.includes('--no-images');
  const results: { id: string; hits: SurfaceHit[]; complexity: Complexity }[] = [];
  const rows: string[] = [];
  for (const id of ids) {
    const r = await checkSurface(id, images);
    results.push({ id, ...r });
    const dents = r.hits.filter((h) => h.kind !== 'flip');
    const flips = r.hits.length - dents.length;
    const fails = r.complexity.findings.filter((f) => f.level === 'fail').length;
    const warns = r.complexity.findings.filter((f) => f.level === 'warn').length;
    rows.push(`${id.padEnd(15)} ${String(dents.length).padStart(5)} ${String(flips).padStart(5)} ${String(r.complexity.total).padStart(7)} ${String(fails).padStart(6)} ${String(warns).padStart(6)}`);
    if (r.hits.length + r.complexity.findings.length === 0) continue;
    console.log(`\n${id}`);
    for (const h of r.hits) console.log(`  ${h.kind === 'flip' ? 'warn ' : ''}${h.kind.padEnd(8)} ${h.owner.padEnd(8)} s ${h.s.toFixed(2)} y ${h.y.toFixed(2)}  ${h.what}${h.image ? `  [${h.image.replace(/.*\/build\//, 'build/')}]` : ''}`);
    for (const f of r.complexity.findings) console.log(`  ${f.level === 'fail' ? 'FAIL' : 'warn'}     ${f.what}`);
  }
  console.log('\ncar             dents flips    tris  fails  warns   (dents and fails break the gate; flips and warns are listed)');
  for (const row of rows) console.log(row);
  if (jsonPath) await Bun.write(jsonPath, JSON.stringify(results, null, 1));
  const failures = results.flatMap((r) => [
    ...r.hits.filter((h) => h.kind !== 'flip').map((h) => `${r.id}: ${h.kind} ${h.owner} s ${h.s.toFixed(2)} y ${h.y.toFixed(2)}: ${h.what}`),
    ...r.complexity.findings.filter((f) => f.level === 'fail').map((f) => `${r.id}: ${f.what}`),
  ]);
  if (failures.length > 0) {
    console.log(`\nFAIL: ${failures.length} dent, kink or complexity finding(s)`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log('\nPASS: no dents or kinks, every car within the complexity gates');
}
