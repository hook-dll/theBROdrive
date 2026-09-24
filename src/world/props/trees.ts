import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { applyComicShading } from '../../render/comic';
import { TreeKind } from '../deserttiledata';
import type { Season } from '../landcover';

/**
 * THE WOOD'S TREES: low-poly silhouettes, built here, in the desert's language.
 *
 * Silhouette over detail. A spruce is known by its outline — tiers of ragged, drooping
 * skirts narrowing to a spire — not by a needle texture; a birch by its white trunk
 * with dark marks and an airy crown; a lime or an aspen by a round full crown. Every
 * face carries one flat colour in its vertices; the comic shading splits the light into
 * bands and the post pass inks the outline. No textures anywhere, so nothing reads as a
 * photograph and nothing crawls.
 *
 * Near and far are the same tree drawn from the same seeded shape: the near level has
 * rounder leaf masses, more trunk facets and the bark dashes; the far level keeps the
 * silhouette on a fraction of the triangles. The forest's impostors are baked from the
 * far level and take over past `IMPOSTOR_FROM_M` (world/forest.ts).
 */

export interface TreePart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;
  /** Shadow material for alpha-cut foliage; null, since nothing here is cut out. */
  readonly depthMaterial: THREE.MeshDepthMaterial | null;
  readonly foliage: boolean;
}

export type TreeLod = readonly TreePart[];

export interface TreeVariant {
  readonly near: TreeLod;
  readonly far: TreeLod;
}

/** Trunk collider radius per kind at scale 1, metres; 0 for things a car drives through. */
export const TREE_TRUNK_RADIUS: readonly number[] = [0.2, 0.26, 0, 0.3];

interface Palette {
  readonly spruce: readonly number[];
  readonly spruceUnder: number;
  readonly birchLeaf: readonly number[];
  readonly broadLeaf: readonly number[];
  readonly bush: readonly number[];
  readonly birchBark: number;
  readonly birchMark: number;
  readonly birchButt: number;
  readonly twig: number;
  readonly trunk: number;
}

/** Light, warm and few: the palette is part of the style. */
const PALETTES: Record<Season, Palette> = {
  summer: {
    spruce: [0x3f7a60, 0x4c886a],
    spruceUnder: 0x34664f,
    birchLeaf: [0xa9bd6a, 0x9db463, 0xb6c776],
    broadLeaf: [0x76a055, 0x70984f, 0x7ea85c],
    bush: [0x6f9150, 0x69894b, 0x779757],
    birchBark: 0xeeece4,
    birchMark: 0x3d3b42,
    birchButt: 0x857e76,
    twig: 0x5d5752,
    trunk: 0x7f756b,
  },
};

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One flat colour per face, from its centroid. Non-indexed, flat normals. */
function flatColour(g: THREE.BufferGeometry, colour: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  const p = geo.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    col.setHex(colour(cx, cy, cz));
    for (let k = 0; k < 3; k++) c.set([col.r, col.g, col.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.computeVertexNormals();
  return geo;
}

function spruceGeometry(seed: number, pal: Palette): TreeShape {
  const rnd = (i: number): number => hash2(seed * 31 + i, seed * 7 - i);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(flatColour(new THREE.CylinderGeometry(0.12, 0.26, 4, 5).translate(0, 2, 0), () => pal.trunk));
  const tiers = 6 + Math.floor(rnd(0) * 2);
  const H = 17 + rnd(1) * 5;
  const base = 2.2;
  for (let t = 0; t < tiers; t++) {
    const k = t / tiers;
    const y0 = base + k * (H - base - 2.5);
    const y1 = y0 + ((H - base) / tiers) * 1.55;
    const R = (3.3 + rnd(t + 60) * 0.5) * (1 - k * 0.82) + 0.35;
    const points = 8 + Math.floor(rnd(t + 70) * 3);
    const pos: number[] = [];
    const twist = rnd(t + 10) * 3;
    for (let i = 0; i < points * 2; i++) {
      const a0 = twist + (i / (points * 2)) * Math.PI * 2;
      const a1 = twist + ((i + 1) / (points * 2)) * Math.PI * 2;
      const r0 = i % 2 === 0 ? R * (0.9 + rnd(t * 50 + i) * 0.2) : R * 0.6;
      const r1 = (i + 1) % 2 === 0 ? R * (0.9 + rnd(t * 50 + i + 1) * 0.2) : R * 0.6;
      // Outer points droop; the notches between them sit higher: a ragged skirt.
      const d0 = i % 2 === 0 ? -0.55 - rnd(t * 40 + i) * 0.4 : 0.25;
      const d1 = (i + 1) % 2 === 0 ? -0.55 - rnd(t * 40 + i + 1) * 0.4 : 0.25;
      const p0 = [Math.cos(a0) * r0, y0 + d0, Math.sin(a0) * r0];
      const p1 = [Math.cos(a1) * r1, y0 + d1, Math.sin(a1) * r1];
      pos.push(0, y1, 0, p1[0]!, p1[1]!, p1[2]!, p0[0]!, p0[1]!, p0[2]!);
      // Underside back to the trunk: a skirt is solid, not a lampshade.
      pos.push(0, y0 + 0.6, 0, p0[0]!, p0[1]!, p0[2]!, p1[0]!, p1[1]!, p1[2]!);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const shade = pal.spruce[t % pal.spruce.length]!;
    parts.push(flatColour(g, (_x, y) => (y < y0 + 0.15 ? pal.spruceUnder : shade)));
  }
  // A spruce's tiers SHOULD shade the ones below: that is the dark band under every
  // skirt. It is solid enough not to crawl, so it stays one part that takes shadows.
  return { wood: mergeGeometries(parts), leaves: null };
}

type Rnd = () => number;

/** A small seeded stream: a tree draws its shape in order, the same for both levels. */
function rng(seed: number): Rnd {
  let s = Math.imul(seed + 1, 0x9e3779b1) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ring {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
}

/** A faceted tube through horizontal rings, open at both ends. Flat colour per quad. */
function tube(rings: readonly Ring[], sides: number, colour: (ring: number, side: number) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const at = (ring: Ring, s: number): [number, number, number] => {
    const a = (s / sides) * Math.PI * 2;
    return [ring.x + Math.cos(a) * ring.r, ring.y, ring.z + Math.sin(a) * ring.r];
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let s = 0; s < sides; s++) {
      const a = at(rings[i]!, s);
      const b = at(rings[i]!, s + 1);
      const u = at(rings[i + 1]!, s);
      const d = at(rings[i + 1]!, s + 1);
      pos.push(...a, ...u, ...b, ...b, ...u, ...d);
      c.setHex(colour(i, s));
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * One mass of leaves: a lumpy ellipsoid. The lumps come from the direction alone, so
 * the faces stay joined; neighbouring faces take slightly different tones of the same
 * green, which is what makes a crown read as foliage and not as a gem. A `hanging`
 * mass narrows to a point below — a birch's leaves stream down from the twig — where
 * an ordinary one has a soft flat shelf underneath.
 */
function blob(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  near: boolean,
  tones: readonly number[],
  seed: number,
  hanging = false,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, near ? 1 : 0);
  const p = g.getAttribute('position');
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k);
    const y = p.getY(k);
    const z = p.getZ(k);
    const f = 1 + 0.14 * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 - seed * 1.3) + 0.07 * Math.sin(y * 4.3 + seed * 0.7);
    let across = 1;
    let down = 1;
    if (y < 0) {
      if (hanging) {
        // Rounded, not a spear: a narrower point read as one giant leaf.
        across = 1 + 0.38 * y;
        down = 1.35;
      } else down = 0.78;
    }
    p.setXYZ(k, cx + x * rx * f * across, cy + y * ry * f * down, cz + z * rz * f * across);
  }
  return flatColour(g, (x, y, z) => {
    const h = hash2(Math.floor(x * 7.3 + y * 3.1) + seed * 13, Math.floor(z * 7.3 - y * 5.7));
    const pick = h < 0.55 ? 0 : h < 0.82 ? 1 : 2;
    return tones[pick % tones.length]!;
  });
}

/** A branch from `from` out to `to`, arching through `bend`: three rings, thinning. */
function limb(
  from: THREE.Vector3,
  bend: THREE.Vector3,
  to: THREE.Vector3,
  r0: number,
  r1: number,
  sides: number,
  colour: number,
): THREE.BufferGeometry {
  const rings: Ring[] = [
    { x: from.x, y: from.y, z: from.z, r: r0 },
    { x: bend.x, y: bend.y, z: bend.z, r: (r0 + r1) / 2 },
    { x: to.x, y: to.y, z: to.z, r: r1 },
  ];
  // Rings are horizontal, so a limb is drawn as a stack of offset rings along its
  // path; on a near-level limb that is a flattened tube, which at a branch's girth
  // reads the same as a round one.
  return tube(rings, sides, () => colour);
}

/** Where the trunk axis is at height `y`: linear between its rings. */
function axisAt(rings: readonly Ring[], y: number, out: THREE.Vector3): THREE.Vector3 {
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    if (y <= b.y || i + 2 === rings.length) {
      const t = Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y)));
      out.set(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t);
      return out;
    }
  }
  return out.set(0, y, 0);
}

function radiusAt(rings: readonly Ring[], y: number): number {
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    if (y <= b.y) return a.r + (b.r - a.r) * Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y)));
  }
  return rings[rings.length - 1]!.r;
}

/**
 * A trunk that sways a little on its way up, flared at the foot. Every random draw
 * happens before the rings are laid, so the near and the far level of one tree are
 * the same tree at a different ring count.
 */
function trunkRings(rnd: Rnd, height: number, r0: number, taper: number, sway: number, count: number): Ring[] {
  const leanX = (rnd() - 0.5) * sway * 2;
  const leanZ = (rnd() - 0.5) * sway * 2;
  const phase = rnd() * Math.PI * 2;
  const rings: Ring[] = [{ x: 0, y: -0.4, z: 0, r: r0 * 1.45 }];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const wob = Math.sin(t * 4.2 + phase) * sway * 0.35 * t;
    rings.push({
      x: leanX * t * t + wob,
      y: t * height,
      z: leanZ * t * t + Math.cos(t * 3.7 + phase) * sway * 0.3 * t,
      r: r0 * (1 - taper * t) * (i === 0 ? 1.25 : 1),
    });
  }
  return rings;
}

/**
 * Rings inserted into a trunk at the given heights, on its own axis and taper: the
 * foot of a stem carries detail (fissures, the dark butt) finer than the ring pitch.
 */
function refine(rings: readonly Ring[], heights: readonly number[]): Ring[] {
  const out = [...rings];
  const p = new THREE.Vector3();
  for (const y of heights) {
    const i = out.findIndex((r) => r.y > y);
    if (i <= 0) continue;
    axisAt(out, y, p);
    out.splice(i, 0, { x: p.x, y, z: p.z, r: radiusAt(out, y) });
  }
  return out;
}

/**
 * Lights a crown as ONE soft volume. Every leaf mass keeps its own lumpy outline, but
 * its normals are bent toward the crown's ellipsoid, so the light falls across the
 * whole crown in one terminator instead of glinting off every facet — the facets were
 * what made the old crowns read as cut gems. The crown is also darker and cooler
 * underneath and inside, lighter on top: the self-shade a real crown has.
 */
function finishCrown(g: THREE.BufferGeometry, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const c = g.getAttribute('color');
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const dx = (p.getX(i) - cx) / rx;
    const dy = (p.getY(i) - cy) / ry;
    const dz = (p.getZ(i) - cz) / rz;
    s.set(dx / rx, dy / ry, dz / rz).normalize();
    v.set(n.getX(i), n.getY(i), n.getZ(i)).multiplyScalar(0.15).addScaledVector(s, 0.85).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    const up = Math.max(0, Math.min(1, dy * 0.5 + 0.5));
    const depth = Math.min(1, Math.hypot(dx, dy, dz));
    const k = (0.8 + 0.28 * up) * (0.84 + 0.16 * depth);
    c.setXYZ(i, c.getX(i) * k * (0.96 + 0.04 * up), c.getY(i) * k, c.getZ(i) * k * (1.06 - 0.06 * up));
  }
  return g;
}

/** A tree as two parts: wood takes shadows; leaves do not shadow themselves (acne). */
interface TreeShape {
  readonly wood: THREE.BufferGeometry | null;
  readonly leaves: THREE.BufferGeometry | null;
}

/**
 * A silver birch: a slender white stem, black and fissured at the foot, marked all the
 * way up with short dark dashes and a dark chevron under each branch; dark twiggy
 * branches out of the upper half carrying a narrow, tall crown of hanging masses with
 * sky between them.
 */
function birchGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 7919 + 13);
  const H = 12 + rnd() * 4;
  const butt = 0.8 + rnd() * 0.7;
  const rings = refine(trunkRings(rnd, H * 0.94, 0.19, 0.8, 0.35, near ? 10 : 6), near ? [0.35, 0.75, 1.2, 1.7, 2.3] : [0.8, 1.6]);
  const sides = near ? 7 : 5;
  const parts: THREE.BufferGeometry[] = [
    tube(rings, sides, (ring, side) => {
      const y = (rings[ring]!.y + rings[ring + 1]!.y) / 2;
      const h = hash2(side * 7 + seed, ring * 3 + 1);
      // The far level paints the butt on its faces; the near level lays plates over a
      // white stem (see below), so its faces stay white above the ground line.
      if (near) return y < 0.2 ? pal.birchButt : pal.birchBark;
      if (y < butt * 0.6) return h < 0.35 ? pal.birchMark : pal.birchButt;
      if (y < butt * 1.5) return h < 0.3 ? pal.birchButt : pal.birchBark;
      return pal.birchBark;
    }),
  ];
  const leaves: THREE.BufferGeometry[] = [];
  const from = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const junctions: [number, number][] = [];
  const limbs = 8 + Math.floor(rnd() * 3);
  const turn = rnd() * Math.PI * 2;
  // The crown takes the upper two thirds: a birch in the open is leafy far down.
  const crownBase = H * (0.28 + rnd() * 0.06);
  const crownW = 2.0 + rnd() * 0.6;
  for (let j = 0; j < limbs; j++) {
    const k = j / limbs;
    const y = crownBase + (H * 0.84 - crownBase) * k + rnd() * 0.4;
    const a = turn + j * 2.4 + rnd() * 0.5;
    // Lower branches reach furthest and hang lowest: the crown is an upright oval,
    // widest below its middle, and its lower skirt droops.
    const reach = crownW * (1.25 - 0.7 * k) * (0.8 + rnd() * 0.3);
    axisAt(rings, y, from);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    bend.set(from.x + dx * reach * 0.5, y + reach * (0.45 + 0.3 * k), from.z + dz * reach * 0.5);
    // The tip hangs: a weeping birch's branch rises, then falls away.
    to.set(from.x + dx * reach, y + reach * (0.1 + 0.45 * k), from.z + dz * reach);
    parts.push(limb(from, bend, to, 0.06, 0.02, near ? 4 : 3, pal.twig));
    junctions.push([y, a]);
    const r = (1.2 - 0.5 * k) * (0.8 + rnd() * 0.35);
    leaves.push(blob(to.x, to.y - 0.3, to.z, r, r * (1.3 + rnd() * 0.3), r, near, rotated(pal.birchLeaf, j), seed * 31 + j, true));
    // A second, smaller mass half-way out: the branch is leafy along its length.
    const r2 = r * (0.6 + rnd() * 0.2);
    leaves.push(blob(bend.x, bend.y - 0.2, bend.z, r2, r2 * 1.3, r2, near, rotated(pal.birchLeaf, j + 1), seed * 31 + j + 40, true));
  }
  // The leader and the crown's heart, so it is one crown and not a mobile.
  const top = axisAt(rings, H * 0.94, new THREE.Vector3());
  leaves.push(blob(top.x, H * 0.9, top.z, 0.8, 1.5, 0.8, near, pal.birchLeaf, seed * 31 + 90, true));
  const heart = axisAt(rings, H * 0.62, new THREE.Vector3());
  const fill = 1.3 + rnd() * 0.3;
  leaves.push(blob(heart.x, H * 0.62, heart.z, fill, fill * 1.6, fill, near, rotated(pal.birchLeaf, 1), seed * 31 + 91, true));
  const crownMidY = (crownBase + H) / 2;
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), heart.x, crownMidY, heart.z, crownW + 0.8, (H - crownBase) / 2 + 0.8, crownW + 0.8);
  if (near) {
    // The rough foot: grey plates rising from the ground in pointed tongues of
    // different heights, dark fissures between them. No level edge anywhere.
    const plates = 7 + Math.floor(rnd() * 3);
    for (let q = 0; q < plates; q++) {
      const a0 = (q / plates) * Math.PI * 2 + rnd() * 0.3;
      const top = butt * (0.55 + rnd() * 0.9);
      parts.push(barkPlate(rings, a0, (Math.PI * 2) / plates + 0.25, top, pal.birchButt, 1.03));
      if (rnd() < 0.7) parts.push(barkPlate(rings, a0 + rnd() * 0.5, 0.18 + rnd() * 0.2, top * (0.5 + rnd() * 0.4), pal.birchMark, 1.045));
    }
    // Bark marks: thin dark lenses across the stem, never rings, thickest toward the
    // foot, and a wide dark chevron under every branch. Past 110 m they are under a
    // pixel, so the far level has none.
    const marks = 26 + Math.floor(rnd() * 10);
    for (let m = 0; m < marks; m++) {
      const y = butt * 1.1 + Math.pow(rnd(), 1.8) * (H * 0.72 - butt * 1.1);
      const big = rnd() < 0.12;
      const h = big ? 0.09 + rnd() * 0.07 : 0.025 + rnd() * 0.045;
      const arc = big ? 1.4 + rnd() * 1.1 : 0.5 + rnd() * 1.2;
      parts.push(barkDash(rings, y, h, rnd() * Math.PI * 2, arc, pal.birchMark));
    }
    for (const [y, a] of junctions) {
      if (y > H * 0.75) continue;
      parts.push(barkDash(rings, y - 0.25, 0.16, a - 0.65, 1.3, pal.birchMark));
    }
  }
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * One plate of rough bark at a birch's foot: from below the ground up to `top`, as
 * wide as `arc`, its upper edge rising to a point in the middle.
 */
function barkPlate(rings: readonly Ring[], a0: number, arc: number, top: number, colour: number, lift: number): THREE.BufferGeometry {
  const steps = 4;
  const pos: number[] = [];
  const c = new THREE.Vector3();
  const edge = (s: number): [number[], number[]] => {
    const t = s / steps;
    const a = a0 + arc * t;
    const y = top * (1 - 0.45 * Math.abs(2 * t - 1));
    axisAt(rings, y, c);
    const r0 = radiusAt(rings, -0.2) * lift;
    const r1 = radiusAt(rings, y) * lift;
    return [
      [c.x + Math.cos(a) * r0, -0.2, c.z + Math.sin(a) * r0],
      [c.x + Math.cos(a) * r1, y, c.z + Math.sin(a) * r1],
    ];
  };
  for (let s = 0; s < steps; s++) {
    const [a, u] = edge(s);
    const [b, d] = edge(s + 1);
    pos.push(...a, ...u, ...b, ...b, ...u, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return flatColour(g, () => colour);
}

/**
 * A birch's dark mark: a thin lens wrapped part-way round the stem, pointed at both
 * ends and fullest in the middle, standing just proud of the bark.
 */
function barkDash(rings: readonly Ring[], y: number, h: number, a0: number, arc: number, colour: number): THREE.BufferGeometry {
  const centre = axisAt(rings, y, new THREE.Vector3());
  const r = radiusAt(rings, y) * 1.03;
  const steps = 5;
  const tilt = (hash2(Math.floor(a0 * 1000), Math.floor(y * 1000)) - 0.5) * h * 0.8;
  const pos: number[] = [];
  const edge = (s: number): [number[], number[]] => {
    const t = s / steps;
    const a = a0 + arc * t;
    const half = (h / 2) * Math.pow(Math.sin(Math.PI * t), 0.7);
    const mid = y + tilt * (t - 0.5);
    const x = centre.x + Math.cos(a) * r;
    const z = centre.z + Math.sin(a) * r;
    return [
      [x, mid - half, z],
      [x, mid + half, z],
    ];
  };
  for (let s = 0; s < steps; s++) {
    const [a, u] = edge(s);
    const [b, d] = edge(s + 1);
    pos.push(...a, ...u, ...b, ...b, ...u, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return flatColour(g, () => colour);
}

/** The tones of a palette, starting at `k`: neighbouring masses lead with a different green. */
function rotated(tones: readonly number[], k: number): number[] {
  return tones.map((_, i) => tones[(i + k) % tones.length]!);
}

/** Every part non-indexed with position and colour only, so they merge. */
function asFlat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'color' && name !== 'normal') geo.deleteAttribute(name);
  }
  return geo;
}

/**
 * A lime, an aspen, a young oak by the road: a short stout grey stem, a few limbs
 * showing under the crown, and one full oval crown on the upper two thirds — a round
 * core with lumps of leaves pushed out of its surface, most on top and at the sides.
 */
function broadGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 104729 + 7);
  const H = 9 + rnd() * 3.5;
  const fork = H * (0.28 + rnd() * 0.06);
  const rings = trunkRings(rnd, fork + 0.6, 0.32, 0.3, 0.25, near ? 5 : 3);
  const parts: THREE.BufferGeometry[] = [tube(rings, near ? 7 : 5, () => pal.trunk)];
  const leaves: THREE.BufferGeometry[] = [];
  const top = rings[rings.length - 1]!;
  const from = new THREE.Vector3(top.x, fork, top.z);
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const rx = 2.7 + rnd() * 0.7;
  const ry = (H - fork) / 2 + 0.3;
  const cy = fork + ry - 0.2;
  leaves.push(blob(top.x, cy, top.z, rx * 0.8, ry * 0.85, rx * 0.8, near, pal.broadLeaf, seed * 17 + 50));
  const masses = 8 + Math.floor(rnd() * 3);
  const turn = rnd() * Math.PI * 2;
  let limbs = 0;
  for (let j = 0; j < masses; j++) {
    const a = turn + j * 2.4 + rnd() * 0.4;
    const e = -0.25 + rnd() * 1.1;
    const flat = Math.sqrt(Math.max(0, 1 - e * e));
    const px = top.x + Math.cos(a) * flat * rx * 0.72;
    const py = cy + e * ry * 0.72;
    const pz = top.z + Math.sin(a) * flat * rx * 0.72;
    const r = (1.3 + rnd() * 0.6) * (1 - 0.2 * Math.max(0, e));
    leaves.push(blob(px, py, pz, r, r * 0.9, r, near, rotated(pal.broadLeaf, j), seed * 17 + j));
    // Limbs to the lower masses: what shows of the wood under a full crown.
    if (e < 0.35 && limbs < 4) {
      limbs++;
      to.set(from.x + (px - from.x) * 0.75, from.y + (py - r * 0.4 - from.y) * 0.75, from.z + (pz - from.z) * 0.75);
      bend.set((from.x + to.x) / 2, (from.y + to.y) / 2 + 0.3, (from.z + to.z) / 2);
      parts.push(limb(from, bend, to, 0.16, 0.07, near ? 5 : 4, pal.trunk));
    }
  }
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), top.x, cy, top.z, rx + 0.8, ry + 0.8, rx + 0.8);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * A hazel or a willow clump: a few thin stems out of one spot, fanning out, carrying
 * upright masses of leaves — taller than wide, narrow at the foot, its stems showing
 * under it.
 */
function bushGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 15485863 + 3);
  const wood: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  const from = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const n = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.45 + rnd() * 0.55;
    const r = (i === 0 ? 0.95 : 0.7) + rnd() * 0.3;
    const h = 1.5 + rnd() * 0.8 - d * 0.5;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    leaves.push(blob(x, h, z, r, r * 1.15, r, near, rotated(pal.bush, i), seed * 19 + i));
    from.set(x * 0.15, -0.2, z * 0.15);
    to.set(x * 0.8, h - r * 0.5, z * 0.8);
    bend.set(x * 0.4, (h - r * 0.5) * 0.5, z * 0.4);
    wood.push(limb(from, bend, to, 0.045, 0.02, 3, pal.twig));
  }
  return {
    wood: mergeGeometries(wood.map(asFlat)),
    leaves: finishCrown(mergeGeometries(leaves.map(asFlat)), 0, 1.5, 0, 1.6, 1.3, 1.6),
  };
}

const material = applyComicShading(
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
  { contourStrength: 0, stippleStrength: 0, shadowWarmth: 0.3 },
);

const VARIANTS: Record<TreeKind, number> = {
  [TreeKind.Birch]: 5,
  [TreeKind.Spruce]: 5,
  [TreeKind.Bush]: 3,
  [TreeKind.Broadleaf]: 4,
};

let variants: readonly TreeVariant[][] | null = null;

/** Every kind's variants, built once. Index by `TreeKind`. */
export function loadTreeVariants(season: Season = 'summer'): Promise<readonly TreeVariant[][]> {
  if (!variants) {
    const pal = PALETTES[season];
    const build: Record<TreeKind, (seed: number, pal: Palette, near: boolean) => TreeShape> = {
      [TreeKind.Birch]: birchGeometry,
      [TreeKind.Spruce]: spruceGeometry,
      [TreeKind.Bush]: bushGeometry,
      [TreeKind.Broadleaf]: broadGeometry,
    };
    const lod = ({ wood, leaves }: TreeShape): TreeLod => {
      const parts: TreePart[] = [];
      for (const [geometry, foliage] of [[wood, false], [leaves, true]] as const) {
        if (!geometry) continue;
        geometry.computeBoundingSphere();
        parts.push({ geometry, material, depthMaterial: null, foliage });
      }
      return parts;
    };
    const kinds = [TreeKind.Birch, TreeKind.Spruce, TreeKind.Bush, TreeKind.Broadleaf];
    variants = kinds.map((kind) =>
      Array.from({ length: VARIANTS[kind] }, (_, seed) => ({
        near: lod(build[kind](seed + 1, pal, true)),
        far: lod(build[kind](seed + 1, pal, false)),
      })),
    );
  }
  return Promise.resolve(variants);
}
