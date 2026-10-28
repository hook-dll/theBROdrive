/**
 * The truck builders' shared palette and shapes (truck.ts, the generic chassis and load
 * bodies; zilfront.ts, the ZIL-130's bonneted front): plain bars, caps, swept sections
 * and profile lookups, every face wound outward.
 */

import * as THREE from 'three';
import { PartBuilder, lerp, newell, type KitSlot, type Vec3 } from './builder';

/** Chassis black: frame, axles, springs, bumper, steps, tank. */
export const BLACK = 0x1d1e1f;
/** Wheel wells, slot backs, the inside of the lamps' rings. */
export const DARK = 0x0d0e0f;
export const RUBBER = 0x19191a;
/** Bare steel: the exhaust, the propeller shaft. */
export const STEEL = 0x5a5c5e;
/**
 * The sharpest triangle a swept part's long faces may split into (`sweep`), clear of
 * kit-surface's 1° slivers: a board's rib 2-3 cm deep and 3.7 m long is cut in three.
 */
const SWEEP_ANGLE = (1.5 * Math.PI) / 180;

/** Piecewise-linear lookup in [s, value] points, held beyond the ends. */
export function tableAt(points: readonly (readonly [number, number])[], s: number): number {
  if (s <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [s1, v1] = points[i]!;
    if (s <= s1) {
      const [s0, v0] = points[i - 1]!;
      return lerp(v0, v1, (s - s0) / (s1 - s0));
    }
  }
  return points[points.length - 1]![1];
}

/** `from`, `to` and every `step` between. */
export function steps(from: number, to: number, step: number): number[] {
  const count = Math.max(1, Math.round((to - from) / step));
  return Array.from({ length: count + 1 }, (_, i) => lerp(from, to, i / count));
}

/** Grid lines sorted, within lo..hi, none closer than 1 mm. */
export function stops(values: readonly number[], lo: number, hi: number): number[] {
  return values
    .filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9)
    .sort((a, c) => a - c)
    .filter((v, i, all) => i === 0 || v > all[i - 1]! + 1e-3);
}

/** A closed ring's cap, cut into triangles that keep to its outline (it may be concave). */
export function cap(b: PartBuilder, slot: KitSlot, ring: readonly Vec3[]): void {
  // The ring lies in a plane of constant z (a section across the car).
  const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
  for (const [i, j, k] of tris) b.tri(slot, ring[i!]!, ring[j!]!, ring[k!]!);
}

/** A square bar `hw` × `hh` from `a` to `c`, its ends closed; `up` picks which way `hh` faces. */
export function bar(b: PartBuilder, slot: KitSlot, a: Vec3, c: Vec3, hw: number, hh: number, up: Vec3 = [0, 1, 0]): void {
  const d = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize();
  let side = d.clone().cross(new THREE.Vector3(...up));
  if (side.lengthSq() < 1e-10) side = d.clone().cross(new THREE.Vector3(0, 0, 1));
  side.normalize();
  const u = side.clone().cross(d);
  const ring = (p: Vec3): Vec3[] =>
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]): Vec3 => [
      p[0] + side.x * sx! * hw + u.x * sy! * hh,
      p[1] + side.y * sx! * hw + u.y * sy! * hh,
      p[2] + side.z * sx! * hw + u.z * sy! * hh,
    ]);
  const r0 = ring(a);
  const r1 = ring(c);
  b.bridge(slot, r0, r1, true);
  b.poly(slot, r0);
  b.poly(slot, r1);
}

/**
 * A closed 2D section swept straight from u0 to u1, `at(u, p)` placing its point p at u
 * (linear in p). Cut across into as many runs as keep every long face's triangles at
 * `SWEEP_ANGLE` or wider at their sharpest, however narrow the section's faces; `caps`
 * closes the ends; the section's edges in `open` (edge j from point j to j + 1) are left
 * out. Every face is wound outward.
 */
export function sweep(b: PartBuilder, slot: KitSlot, section: readonly (readonly [number, number])[], at: (u: number, p: readonly [number, number]) => Vec3, u0: number, u1: number, caps = true, open: readonly number[] = []): void {
  const n = section.length;
  const ring0 = section.map((p) => at(u0, p));
  const length = Math.hypot(...sub3(at(u1, section[0]!), ring0[0]!));
  let narrow = Infinity;
  for (let j = 0; j < n; j++) if (!open.includes(j)) narrow = Math.min(narrow, Math.hypot(...sub3(ring0[(j + 1) % n]!, ring0[j]!)));
  const runs = Math.max(1, Math.ceil((length * Math.tan(SWEEP_ANGLE)) / narrow));
  // The section's winding, so each edge's outward side is known in 2D, then placed.
  let area = 0;
  for (let j = 0; j < n; j++) {
    const [p, q] = [section[j]!, section[(j + 1) % n]!];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const turn = Math.sign(area);
  const rings = Array.from({ length: runs + 1 }, (_, i) => section.map((p) => at(lerp(u0, u1, i / runs), p)));
  const face = (pts: Vec3[], out: Vec3): void => {
    const n3 = newell(pts);
    if (n3[0] * out[0] + n3[1] * out[1] + n3[2] * out[2] < 0) pts.reverse();
    b.poly(slot, pts);
  };
  for (let j = 0; j < n; j++) {
    if (open.includes(j)) continue;
    const [p, q] = [section[j]!, section[(j + 1) % n]!];
    const mid: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const outward: [number, number] = [mid[0] + turn * (q[1] - p[1]), mid[1] - turn * (q[0] - p[0])];
    const out = sub3(at(u0, outward), at(u0, mid));
    for (let i = 0; i < runs; i++) face([rings[i]![j]!, rings[i]![(j + 1) % n]!, rings[i + 1]![(j + 1) % n]!, rings[i + 1]![j]!], out);
  }
  if (!caps) return;
  const tris = THREE.ShapeUtils.triangulateShape(section.map(([x, y]) => new THREE.Vector2(x, y)), []);
  const along = sub3(rings[runs]![0]!, ring0[0]!);
  for (const [ring, sign] of [[ring0, -1], [rings[runs]!, 1]] as const) {
    for (const [i, j, k] of tris) face([ring[i!]!, ring[j!]!, ring[k!]!], [along[0] * sign, along[1] * sign, along[2] * sign]);
  }
}

function sub3(a: Vec3, c: Vec3): Vec3 {
  return [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
}
