/**
 * A CAR'S SHADOW IS ONE SOLID SILHOUETTE: the closed hull every car casts beside its
 * own panels, on the shadow-only layer that no picture draws.
 *
 * Every car body is built of zero-thickness panels and casts from their back faces
 * (render/carmodel.ts `prepareMaterials`), with the floor, the bay and the cabin casting
 * nothing. Light that came in through a panel facing the sun went out wherever no
 * panel faced away from it: under the tail between the rear arch and the bumper (a
 * wedge of sunlit sand inside the shadow under a low sun, from the side), through the
 * door and lid shut lines (thin bright lines across it), under the scuttle at the
 * screen's foot. Measured on the GAZ-31029 by rendering its casters from the sun
 * (owner's report, 2026-10-16).
 *
 * The hull is the body's own cross-sections along its length: at each station the
 * plane cut of every casting panel and pane, its convex hull, read at `DIRECTIONS`
 * fixed directions (the hull's vertex furthest along each, so the polygon lies inside
 * the body's section and keeps its sill, belt and roof corners), lofted from station
 * to station and capped. Stations a straight loft between their neighbours carries
 * within `LOFT_TOLERANCE_M` are dropped. Wheels, mirrors and the parts that cast
 * nothing are left out: the wheels and mirrors cast as themselves, and under the sills
 * between the wheels the sand stays lit, as under a real car.
 *
 * It casts from its back faces like every car part, so it shades nothing inside it:
 * the cabin a kit car lights through its glass is lit as before, and only what lies
 * beyond the body's far side from the light is darkened. A few hundred triangles a
 * model, built once as the model loads and shared by all its cars.
 */

import * as THREE from 'three';
import { SHADOW_ONLY_LAYER } from '../core/renderer';
import { collectPieces } from './farcars';
import { KIT_SHADOW_ATTRIBUTE } from './materials';

/** Spacing of the candidate cross-sections along the car, metres. */
const STATION_STEP_M = 0.05;
/** Points per cross-section, at even angles from +X counter-clockwise. */
const DIRECTIONS = 12;
/** How far a straight loft may stray from a dropped station's section, metres. */
const LOFT_TOLERANCE_M = 0.02;
/** Stations start and end this far inside the body's ends, where a cut is a sliver. */
const END_INSET_M = 0.01;

const _point = new THREE.Vector3();

/** A part that casts its own shadow: the panels and panes, not the lenses, details or mirrors. */
function castsAsBody(mesh: THREE.Mesh, start: number): boolean {
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
    if (node.name.startsWith('mirror')) return false;
  }
  if (mesh.userData.kitSlot === 'glass') return true;
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const shadow = geometry.getAttribute(KIT_SHADOW_ATTRIBUTE);
  if (shadow) {
    const first = geometry.index ? geometry.index.getX(start) : start;
    return shadow.getX(first) > 0.5;
  }
  return mesh.castShadow;
}

/** Convex hull of 2D points (x, y pairs), counter-clockwise, Andrew's monotone chain. */
function convexHull(points: number[]): [number, number][] {
  const list: [number, number][] = [];
  for (let i = 0; i < points.length; i += 2) list.push([points[i]!, points[i + 1]!]);
  list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (list.length < 3) return list;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of list) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

interface Section {
  readonly z: number;
  /** `DIRECTIONS` points as x, y pairs. */
  readonly points: Float64Array;
}

/** The hull vertex furthest along each direction, or null for a cut too thin to cast. */
function sectionAt(z: number, cut: number[]): Section | null {
  const hull = convexHull(cut);
  if (hull.length < 3) return null;
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area * 0.5 < 1e-3) return null;
  const points = new Float64Array(DIRECTIONS * 2);
  for (let k = 0; k < DIRECTIONS; k++) {
    const angle = (k / DIRECTIONS) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let best = -Infinity;
    for (const [x, y] of hull) {
      const reach = x * dx + y * dy;
      if (reach > best) {
        best = reach;
        points[k * 2] = x;
        points[k * 2 + 1] = y;
      }
    }
  }
  return { z, points };
}

/** Distance from (x, y) to the closed polygon `ring` (x, y pairs). */
function distanceToRing(x: number, y: number, ring: Float64Array): number {
  let best = Infinity;
  for (let k = 0; k < ring.length; k += 2) {
    const ax = ring[k]!;
    const ay = ring[k + 1]!;
    const ex = ring[(k + 2) % ring.length]! - ax;
    const ey = ring[(k + 3) % ring.length]! - ay;
    const length = ex * ex + ey * ey;
    const t = length > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / length)) : 0;
    best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
  }
  return best;
}

/**
 * True when every section strictly between `from` and `to` lies within tolerance of
 * their loft. Measured as shapes, each section's points against the lofted ring's
 * edges and back, not point to point: the hull vertex a direction picks can jump along
 * a flat side from one station to the next without the section changing.
 */
function loftCarries(sections: readonly Section[], from: number, to: number): boolean {
  const a = sections[from]!;
  const b = sections[to]!;
  const ring = new Float64Array(DIRECTIONS * 2);
  for (let m = from + 1; m < to; m++) {
    const s = sections[m]!;
    const t = (s.z - a.z) / (b.z - a.z);
    for (let k = 0; k < DIRECTIONS * 2; k++) ring[k] = a.points[k]! + (b.points[k]! - a.points[k]!) * t;
    for (let k = 0; k < DIRECTIONS * 2; k += 2) {
      if (distanceToRing(s.points[k]!, s.points[k + 1]!, ring) > LOFT_TOLERANCE_M) return false;
      if (distanceToRing(ring[k]!, ring[k + 1]!, s.points) > LOFT_TOLERANCE_M) return false;
    }
  }
  return true;
}

/**
 * The shadow hull of a body template (`root`, chassis-local with its own transform, the
 * frame of render/farcars.ts `bakeFarCarGeometry`), or null for a body with no casting
 * panels. The car's length runs along Z.
 */
export function bakeCarShadowHull(root: THREE.Object3D): THREE.BufferGeometry | null {
  const pieces = collectPieces([root], (mesh, _material) => mesh, false).filter((piece) => castsAsBody(piece.mesh, piece.start));
  // Every casting triangle, chassis-local.
  const triangles: number[] = [];
  for (const piece of pieces) {
    const position = piece.geometry.getAttribute('position');
    const index = piece.geometry.index;
    for (let i = piece.start; i < piece.start + piece.count; i++) {
      _point.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(piece.matrix);
      triangles.push(_point.x, _point.y, _point.z);
    }
  }
  if (triangles.length < 9) return null;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 2; i < triangles.length; i += 3) {
    zMin = Math.min(zMin, triangles[i]!);
    zMax = Math.max(zMax, triangles[i]!);
  }
  const first = zMin + END_INSET_M;
  const span = zMax - END_INSET_M - first;
  if (span <= 0) return null;
  const count = Math.ceil(span / STATION_STEP_M) + 1;
  const step = span / (count - 1);
  const cuts: number[][] = Array.from({ length: count }, () => []);
  // Each triangle into the cuts of the stations it spans.
  for (let t = 0; t < triangles.length; t += 9) {
    const z0 = triangles[t + 2]!;
    const z1 = triangles[t + 5]!;
    const z2 = triangles[t + 8]!;
    const lo = Math.max(0, Math.ceil((Math.min(z0, z1, z2) - first) / step));
    const hi = Math.min(count - 1, Math.floor((Math.max(z0, z1, z2) - first) / step));
    for (let s = lo; s <= hi; s++) {
      const z = first + s * step;
      const cut = cuts[s]!;
      for (let e = 0; e < 3; e++) {
        const p = t + e * 3;
        const q = t + ((e + 1) % 3) * 3;
        const pz = triangles[p + 2]! - z;
        const qz = triangles[q + 2]! - z;
        if (pz === 0) cut.push(triangles[p]!, triangles[p + 1]!);
        if ((pz < 0 && qz > 0) || (pz > 0 && qz < 0)) {
          const f = pz / (pz - qz);
          cut.push(
            triangles[p]! + (triangles[q]! - triangles[p]!) * f,
            triangles[p + 1]! + (triangles[q + 1]! - triangles[p + 1]!) * f,
          );
        }
      }
    }
  }
  const sections: Section[] = [];
  for (let s = 0; s < count; s++) {
    const section = sectionAt(first + s * step, cuts[s]!);
    if (section) sections.push(section);
  }
  if (sections.length < 2) return null;
  // Keep a station only where the loft past it would leave the body's sections.
  const kept: Section[] = [sections[0]!];
  let from = 0;
  for (let to = 2; to < sections.length; to++) {
    if (loftCarries(sections, from, to)) continue;
    from = to - 1;
    kept.push(sections[from]!);
  }
  kept.push(sections[sections.length - 1]!);

  const rings = kept.length;
  const positions = new Float32Array((rings * DIRECTIONS + 2) * 3);
  kept.forEach((section, r) => {
    for (let k = 0; k < DIRECTIONS; k++) {
      const v = (r * DIRECTIONS + k) * 3;
      positions[v] = section.points[k * 2]!;
      positions[v + 1] = section.points[k * 2 + 1]!;
      positions[v + 2] = section.z;
    }
  });
  // The caps' centres: each end section's mean point.
  const capCentre = (section: Section, at: number): void => {
    let x = 0;
    let y = 0;
    for (let k = 0; k < DIRECTIONS; k++) {
      x += section.points[k * 2]!;
      y += section.points[k * 2 + 1]!;
    }
    positions[at * 3] = x / DIRECTIONS;
    positions[at * 3 + 1] = y / DIRECTIONS;
    positions[at * 3 + 2] = section.z;
  };
  const tail = rings * DIRECTIONS;
  const nose = tail + 1;
  capCentre(kept[0]!, tail);
  capCentre(kept[rings - 1]!, nose);
  // Counter-clockwise rings along +Z: (a, b, c) faces out.
  const index: number[] = [];
  for (let r = 0; r + 1 < rings; r++) {
    for (let k = 0; k < DIRECTIONS; k++) {
      const a = r * DIRECTIONS + k;
      const b = r * DIRECTIONS + ((k + 1) % DIRECTIONS);
      const c = b + DIRECTIONS;
      const d = a + DIRECTIONS;
      index.push(a, b, c, a, c, d);
    }
  }
  for (let k = 0; k < DIRECTIONS; k++) {
    const next = (k + 1) % DIRECTIONS;
    index.push(tail, next, k);
    index.push(nose, (rings - 1) * DIRECTIONS + k, (rings - 1) * DIRECTIONS + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

let hullMaterial: THREE.MeshBasicMaterial | null = null;

/**
 * One car's hull as a mesh on the shadow-only layer (core/renderer.ts
 * `SHADOW_ONLY_LAYER`): it casts every shadow-casting light's shadow from its back
 * faces, as every car part does, and no picture draws it. Its depth program is the
 * plain mesh's, which `Renderer.waitForFrameShaders` links at boot
 * (`depthVariantSamples`); its scene program is never needed.
 */
export function carShadowHullMesh(geometry: THREE.BufferGeometry): THREE.Mesh {
  hullMaterial ??= new THREE.MeshBasicMaterial({ name: 'car-shadow-hull', colorWrite: false });
  hullMaterial.shadowSide = THREE.BackSide;
  const mesh = new THREE.Mesh(geometry, hullMaterial);
  mesh.name = 'car-shadow-hull';
  mesh.layers.set(SHADOW_ONLY_LAYER);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}
