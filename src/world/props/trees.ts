import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { applyComicShading } from '../../render/comic';
import {
  applyBarkMapping,
  BARK_ROUGH_U,
  BARK_SMOOTH_U,
  BARK_TILE_AROUND_M,
  BARK_TILE_UP_M,
  leafAtlas,
  leafCellUv,
  SOLID_UV,
  type LeafSprite,
} from '../../render/leafpaint';
import { injectSeason, SEASON_TREE_RANDOM_GLSL } from '../../render/season';
import { TREE_KINDS, TreeKind } from '../deserttiledata';
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
  /**
   * Wood and leaves in one geometry, so a tree is one draw per level, not two. The
   * `aWood` attribute (1 wood, 0 leaves) keeps the one difference the two parts had:
   * leaves take no shadow of their own (see `material`).
   */
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshStandardMaterial;
  /** Shadow material for the alpha-cut leaf cards: they cast their painted outline. */
  readonly depthMaterial: THREE.MeshDepthMaterial | null;
}

export type TreeLod = readonly TreePart[];

export interface TreeVariant {
  readonly near: TreeLod;
  readonly far: TreeLod;
}

/**
 * Trunk collider radius per kind at scale 1, metres, in `TreeKind` order; 0 for things
 * a car drives through.
 */
export const TREE_TRUNK_RADIUS: readonly number[] = [0.2, 0.26, 0, 0.3, 0.34, 0.2, 0.46, 0.26, 0.2, 0.4, 0.12, 0, 0, 0.3, 0];

interface Palette {
  readonly spruce: readonly number[];
  readonly spruceUnder: number;
  readonly birchLeaf: readonly number[];
  readonly limeLeaf: readonly number[];
  readonly mapleLeaf: readonly number[];
  readonly bush: readonly number[];
  readonly pine: readonly number[];
  readonly aspenLeaf: readonly number[];
  readonly oakLeaf: readonly number[];
  readonly alderLeaf: readonly number[];
  readonly willowLeaf: readonly number[];
  readonly rowanLeaf: readonly number[];
  readonly fern: readonly number[];
  readonly juniper: readonly number[];
  /** Grey weathered wood, a stump's or a fallen trunk's. */
  readonly deadwood: number;
  /** A cut face, pale and warm. */
  readonly deadwoodCut: number;
  readonly moss: number;
  readonly birchBark: number;
  readonly birchGrey: number;
  readonly birchMark: number;
  readonly birchButt: number;
  readonly pineBark: number;
  /** Where the grey fissured foot gives way to the thin copper bark above. */
  readonly pineBarkMid: number;
  readonly pineBarkLow: number;
  readonly aspenBark: number;
  readonly aspenButt: number;
  readonly oakBark: number;
  readonly oakFissure: number;
  readonly alderBark: number;
  readonly willowBark: number;
  readonly willowFissure: number;
  readonly rowanBark: number;
  readonly rowanBerry: number;
  readonly twig: number;
  readonly trunk: number;
}

/**
 * Light, warm and few: the palette is part of the style. Each kind keeps a green of
 * its own, as it does in a real wood seen across a field — the pale yellow of birch,
 * aspen's grey, the dark of oak and alder, willow's silver, pine's blue.
 */
const PALETTES: Record<Season, Palette> = {
  summer: {
    // Olive-grey, never teal (docs/shishkin.md): 0x3f7a60 sat at 155 degrees and read
    // as plastic against every painted spruce.
    spruce: [0x557552, 0x62805b],
    spruceUnder: 0x4e6247,
    birchLeaf: [0xb0b56a, 0xa3a962, 0xbcbd76],
    limeLeaf: [0x829a52, 0x7b924d, 0x8aa25a],
    mapleLeaf: [0x92a64e, 0x899d49, 0x9cae58],
    bush: [0x7a8a4f, 0x73824a, 0x829256],
    // Lighter and warmer than spruce: a pine crown against the sky is olive, lit
    // through ("Rye", "Pines sunlit"), never the dark mass a spruce is.
    pine: [0x61744a, 0x6b7e52, 0x586a44],
    aspenLeaf: [0x9ba673, 0x919c6a, 0xa5ae7d],
    oakLeaf: [0x68803f, 0x61783a, 0x718a48],
    alderLeaf: [0x5e7644, 0x586e3f, 0x667f4b],
    willowLeaf: [0xabb18e, 0x9fa684, 0xb5ba99],
    rowanLeaf: [0x8a9e55, 0x80944f, 0x93a75e],
    fern: [0x7d9448, 0x87a052, 0x738a42],
    juniper: [0x55684c, 0x5e7253, 0x4d6045],
    deadwood: 0x8a7d6c,
    deadwoodCut: 0xc4a77c,
    moss: 0x6e7a46,
    // Grown birch is not snow-white: a creamy grey, patched greyer with lichen and
    // weather, and black and furrowed at the foot. Only a young one is white.
    birchBark: 0xcac6bb,
    birchGrey: 0x9d998f,
    birchMark: 0x35333a,
    birchButt: 0x5f5852,
    // Ochre-copper, not orange: Shishkin's pines glow where the sun is on them, and
    // the light does that, not the paint (docs/shishkin.md).
    pineBark: 0xb08058,
    pineBarkMid: 0x937262,
    pineBarkLow: 0x6e6159,
    aspenBark: 0xb6bea5,
    aspenButt: 0x55534e,
    oakBark: 0x857b6c,
    oakFissure: 0x463f3a,
    alderBark: 0x5f5c59,
    willowBark: 0x7e756a,
    willowFissure: 0x5c544b,
    rowanBark: 0x8a8279,
    rowanBerry: 0xe26a2c,
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

/**
 * A spruce: a straight stem to the top, a dark narrow cone for the crown's depth, and
 * round it whorls of branches as cards painted with spruce sprays (render/leafpaint.ts),
 * each drooping from the stem and lifting a little at the tip. Whorls are wide at the
 * foot and shrink to the leader. The cone is what the eye takes for the shade inside
 * a spruce; the sprays give it the ragged, layered edge the solid tiers never had.
 */
function spruceGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = (i: number): number => hash2(seed * 31 + i, seed * 7 - i);
  const H = 17 + rnd(1) * 5;
  const base = 1.6;
  const parts: THREE.BufferGeometry[] = [
    flatColour(new THREE.CylinderGeometry(0.06, 0.26, H, 5).translate(0, H / 2, 0), () => pal.trunk),
  ];
  // The core: darker than the boughs and narrower, so it shows only between them. It
  // is part of the crown, not the wood: as wood it took the boughs' shadow and went
  // black between every whorl.
  const core = asFlat(flatColour(new THREE.ConeGeometry(1.5 + rnd(2) * 0.3, H - base - 0.8, 7, 1, true).translate(0, base + (H - base - 0.8) / 2, 0), () => pal.spruceUnder));
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  // The far level (60 m on, and the impostor bake) keeps the outline on fewer, wider
  // boughs: most of a spruce's cost is the overdraw of its cards.
  const whorls = near ? 12 + Math.floor(rnd(0) * 3) : 8 + Math.floor(rnd(0) * 2);
  for (let t = 0; t < whorls; t++) {
    const k = t / whorls;
    const y = base + k * (H - base - 1.2);
    const R = (3.3 + rnd(t + 60) * 0.5) * (1 - k * 0.88) + 0.35;
    const branches = near ? 6 + Math.floor(rnd(t + 70) * 2) : 5;
    const twist = rnd(t + 10) * 3;
    for (let b = 0; b < branches; b++) {
      const a = twist + (b / branches) * Math.PI * 2 + (rnd(t * 50 + b) - 0.5) * 0.4;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const reach = R * (0.85 + rnd(t * 40 + b) * 0.3);
      // Down at the middle, the tip lifting again: the classic spruce bough.
      const droop = reach * (0.28 + rnd(t * 30 + b) * 0.12);
      const width = reach * (near ? 1.15 : 1.35);
      // Rolled well off flat, either way: seen level, a flat spray is a line.
      const roll = (rnd(t * 20 + b) < 0.5 ? -1 : 1) * (0.45 + rnd(t * 25 + b) * 0.6);
      // Across the branch: horizontal, then rolled about the branch.
      const px = -dz * Math.cos(roll);
      const py = Math.sin(roll);
      const pz = dx * Math.cos(roll);
      const cell = leafCellUv('fir', rnd(t * 90 + b));
      c.setHex(pal.spruce[(t + b) % pal.spruce.length]!);
      const ax = dx * 0.25;
      const az = dz * 0.25;
      const ay = y + 0.2;
      const bx = dx * reach;
      const bz = dz * reach;
      const by = y - droop;
      const corner = (along: number, across: number, u: number, v: number): void => {
        const x = ax + (bx - ax) * along + px * across * width * 0.5;
        const yy = ay + (by - ay) * along + py * across * width * 0.5 + along * (1 - along) * droop * -0.6;
        const z = az + (bz - az) * along + pz * across * width * 0.5;
        pos.push(x, yy, z);
        nor.push(0, 1, 0);
        uv.push(u, v);
        col.push(c.r, c.g, c.b);
      };
      // Two quads along the bough, so it can bend.
      for (const [a0, a1] of near ? ([[0, 0.5], [0.5, 1]] as const) : ([[0, 1]] as const)) {
        const v0 = cell.v0 + (cell.v1 - cell.v0) * a0;
        const v1 = cell.v0 + (cell.v1 - cell.v0) * a1;
        corner(a0, -1, cell.u0, v0);
        corner(a0, 1, cell.u1, v0);
        corner(a1, 1, cell.u1, v1);
        corner(a0, -1, cell.u0, v0);
        corner(a1, 1, cell.u1, v1);
        corner(a1, -1, cell.u0, v1);
      }
    }
  }
  // The leader: a last upright spray at the top.
  const lead = leafCellUv('fir', rnd(99));
  c.setHex(pal.spruce[0]!);
  for (const [a, b2] of [[0, 1], [Math.PI / 2, 1]] as const) {
    const qx = Math.cos(a) * 0.3 * b2;
    const qz = Math.sin(a) * 0.3 * b2;
    const quad = [[-1, 0, lead.u0, lead.v0], [1, 0, lead.u1, lead.v0], [1, 1, lead.u1, lead.v1], [-1, 0, lead.u0, lead.v0], [1, 1, lead.u1, lead.v1], [-1, 1, lead.u0, lead.v1]] as const;
    for (const [sx, sy, u, v] of quad) {
      pos.push(qx * sx, H - 1.4 + sy * 1.6, qz * sx);
      nor.push(0, 1, 0);
      uv.push(u, v);
      col.push(c.r, c.g, c.b);
    }
  }
  const boughs = new THREE.BufferGeometry();
  boughs.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  boughs.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  boughs.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  boughs.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const crown = finishCrown(boughs, 0, base + (H - base) * 0.4, 0, 3.6, (H - base) * 0.6, 3.6);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: mergeGeometries([core, crown]) };
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
/**
 * A tube through `rings`, `sides` faces round, coloured per face. Its bark is a texture
 * (render/leafpaint.ts `applyBarkMapping`): u runs round the trunk in whole tiles, v up
 * it in metres, so the bark's fissures and lenticels keep their size on any girth. Face
 * colours carry only broad changes (the dark foot, pine's copper crown); a pattern in
 * face colours shows as a chessboard of flat facets.
 */
function tube(rings: readonly Ring[], sides: number, colour: (ring: number, side: number) => number, bark: 'rough' | 'smooth' = 'rough'): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const girth = rings.reduce((m, r) => Math.max(m, r.r), 0) * Math.PI * 2;
  const around = Math.max(1, Math.round(girth / BARK_TILE_AROUND_M));
  const u0 = bark === 'smooth' ? BARK_SMOOTH_U : BARK_ROUGH_U;
  const heights: number[] = [0];
  for (let i = 1; i < rings.length; i++) {
    const a = rings[i - 1]!;
    const b = rings[i]!;
    heights.push(heights[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
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
      const ua = u0 + (s / sides) * around;
      const ub = u0 + ((s + 1) / sides) * around;
      const va = heights[i]! / BARK_TILE_UP_M;
      const vb = heights[i + 1]! / BARK_TILE_UP_M;
      uv.push(ua, va, ua, vb, ub, va, ub, va, ua, vb, ub, vb);
      c.setHex(colour(i, s));
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Subdivision of every leaf mass, near and far alike (see `blob`). 0: twenty faces a
 * mass. At 1 (eighty) for every tree out to 420 m a birch wood cost 35 ms of GPU a
 * frame instead of 17; the crown lighting (`finishCrown`) rounds the coarse masses.
 */
const CROWN_DETAIL = 0;

/**
 * The leaf sprite the crown being built is painted with (render/leafpaint.ts), set
 * per kind by `loadTreeVariants` before each build.
 */
let leafSprite: LeafSprite = 'broad';

/**
 * A MASS OF LEAVES as cards: three upright quads crossed and one lying nearly flat, each
 * painted with a cluster of leaves from the leaf atlas and scattered a little inside
 * the mass's ellipsoid. `finishCrown` then bends every normal to the crown's own
 * ellipsoid, so the crown is lit as one soft volume and the cards never show as flat.
 * The flat one is for the view from above: a chase camera looks down into crowns.
 * Eight triangles, where a solid lump took twenty and read as a toy.
 */
function blob(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  tones: readonly number[],
  seed: number,
  hanging = false,
): THREE.BufferGeometry {
  const rnd = rng(seed * 2654435761 + 97);
  const sprite: LeafSprite = hanging && leafSprite === 'small' && rnd() < 0.5 ? 'hanging' : leafSprite;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const yaw0 = rnd() * Math.PI;
  const reach = Math.max(rx, rz);
  for (let k = 0; k < 4; k++) {
    const flat = k === 3;
    const yaw = yaw0 + k * (Math.PI / 3) + (rnd() - 0.5) * 0.5;
    // Upright cards lean a little; the flat one is tipped most of the way over.
    const tilt = flat ? 1.25 + rnd() * 0.25 : (rnd() - 0.5) * 0.6;
    right.set(Math.cos(yaw), 0, Math.sin(yaw));
    normal.set(-Math.sin(yaw), 0, Math.cos(yaw));
    up.set(0, 1, 0).multiplyScalar(Math.cos(tilt)).addScaledVector(normal, -Math.sin(tilt));
    normal.crossVectors(right, up).normalize();
    const hw = (flat ? reach : Math.max(reach, ry * 0.8)) * (1.2 + rnd() * 0.12);
    const hh = (flat ? reach : ry) * (1.2 + rnd() * 0.12) * (hanging && !flat ? 1.15 : 1);
    const ox = cx + (rnd() - 0.5) * rx * 0.4;
    const oy = cy + (rnd() - 0.5) * ry * 0.3 - (hanging && !flat ? ry * 0.15 : 0);
    const oz = cz + (rnd() - 0.5) * rz * 0.4;
    const cell = leafCellUv(flat && sprite === 'hanging' ? leafSprite : sprite, rnd());
    const flip = rnd() < 0.5;
    const u0 = flip ? cell.u1 : cell.u0;
    const u1 = flip ? cell.u0 : cell.u1;
    c.setHex(tones[k % tones.length]!);
    const corner = (a: number, b: number, u: number, v: number): void => {
      pos.push(ox + right.x * a * hw + up.x * b * hh, oy + right.y * a * hw + up.y * b * hh, oz + right.z * a * hw + up.z * b * hh);
      nor.push(normal.x, normal.y, normal.z);
      uv.push(u, v);
      col.push(c.r, c.g, c.b);
    };
    corner(-1, -1, u0, cell.v0);
    corner(1, -1, u1, cell.v0);
    corner(1, 1, u1, cell.v1);
    corner(-1, -1, u0, cell.v0);
    corner(1, 1, u1, cell.v1);
    corner(-1, 1, u0, cell.v1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** A solid lump: what a crown mass used to be, now only for rowan's berry bunches. */
/**
 * One mass of leaves: a lumpy ellipsoid. The lumps come from the direction alone, so
 * the faces stay joined; neighbouring faces take slightly different tones of the same
 * green, which is what makes a crown read as foliage and not as a gem. A `hanging`
 * mass narrows to a point below — a birch's leaves stream down from the twig — where
 * an ordinary one has a soft flat shelf underneath.
 *
 * THE SAME AT EVERY LEVEL. A crown's outline is what the eye tracks as a tree comes
 * near; built finer for the near level, every crown in view changed shape at the swap
 * distance, and driving through a wood was a constant ripple of trees redrawing
 * themselves. The levels differ only in bark marks, trunk facets and stubs, which are
 * below a pixel where they swap.
 */
function lump(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  tones: readonly number[],
  seed: number,
  hanging = false,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, CROWN_DETAIL);
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
  // The dark furrowed foot of a grown birch stands a metre and a half to three high.
  const butt = 1.4 + rnd() * 1.6;
  const rings = refine(trunkRings(rnd, H * 0.94, 0.19, 0.8, 0.35, near ? 10 : 6), near ? [0.35, 0.75, 1.2, 1.7, 2.3, 3.0, 3.8] : [0.8, 1.6, 2.6]);
  const sides = near ? 7 : 5;
  const parts: THREE.BufferGeometry[] = [
    tube(rings, sides, (ring, side) => {
      const y = (rings[ring]!.y + rings[ring + 1]!.y) / 2;
      const h = hash2(side * 7 + seed, 1);
      // The far level paints the butt on its faces; the near level lays plates over a
      // white stem (see below), so its faces stay white above the ground line.
      if (near) return y < 0.2 ? pal.birchButt : pal.birchBark;
      // The far level paints the foot by side, in tongues: never face by face.
      const foot = butt * (0.7 + 0.6 * h);
      return y < foot ? pal.birchButt : y < foot * 1.4 ? pal.birchGrey : pal.birchBark;
    }, 'smooth'),
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
    leaves.push(blob(to.x, to.y - 0.3, to.z, r, r * (1.3 + rnd() * 0.3), r, rotated(pal.birchLeaf, j), seed * 31 + j, true));
    // A second, smaller mass half-way out: the branch is leafy along its length.
    const r2 = r * (0.6 + rnd() * 0.2);
    leaves.push(blob(bend.x, bend.y - 0.2, bend.z, r2, r2 * 1.3, r2, rotated(pal.birchLeaf, j + 1), seed * 31 + j + 40, true));
  }
  // The leader and the crown's heart, so it is one crown and not a mobile.
  const top = axisAt(rings, H * 0.94, new THREE.Vector3());
  leaves.push(blob(top.x, H * 0.9, top.z, 0.8, 1.5, 0.8, pal.birchLeaf, seed * 31 + 90, true));
  const heart = axisAt(rings, H * 0.62, new THREE.Vector3());
  const fill = 1.3 + rnd() * 0.3;
  leaves.push(blob(heart.x, H * 0.62, heart.z, fill, fill * 1.6, fill, rotated(pal.birchLeaf, 1), seed * 31 + 91, true));
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

/** Every part non-indexed with position, colour, normal and uv only, so they merge. */
function asFlat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'color' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
  }
  // Wood and anything else untextured samples the atlas's solid white cell.
  if (!geo.getAttribute('uv')) {
    const count = geo.getAttribute('position').count;
    const uv = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) uv.set(SOLID_UV, i * 2);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return geo;
}

/** Shape of a tree with one full crown on a short stem: lime and maple. */
interface RoundCrown {
  readonly salt: number;
  readonly height: readonly [number, number];
  readonly trunkR: number;
  /** Crown half-width range, metres. */
  readonly width: readonly [number, number];
  /** Crown half-height over half-width: lime is an egg, maple nearly a ball. */
  readonly tall: number;
  readonly leaves: (pal: Palette) => readonly number[];
}

const LIME: RoundCrown = { salt: 104729, height: [10, 14], trunkR: 0.32, width: [2.6, 3.3], tall: 1.3, leaves: (p) => p.limeLeaf };
const MAPLE: RoundCrown = { salt: 130363, height: [9, 12], trunkR: 0.28, width: [3.1, 3.8], tall: 0.92, leaves: (p) => p.mapleLeaf };

/**
 * A short stout grey stem, a few limbs showing under the crown, and one full crown on
 * the upper two thirds — a core with lumps of leaves pushed out of its surface, most
 * on top and at the sides.
 */
function roundCrownGeometry(spec: RoundCrown, seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * spec.salt + 7);
  const H = spec.height[0] + rnd() * (spec.height[1] - spec.height[0]);
  const rx = spec.width[0] + rnd() * (spec.width[1] - spec.width[0]);
  const ry = rx * spec.tall;
  const fork = Math.max(2.2, H - ry * 2 + 0.4);
  const rings = trunkRings(rnd, fork + 0.6, spec.trunkR, 0.3, 0.25, near ? 5 : 3);
  const tones = spec.leaves(pal);
  const parts: THREE.BufferGeometry[] = [tube(rings, near ? 7 : 5, () => pal.trunk)];
  const leaves: THREE.BufferGeometry[] = [];
  const top = rings[rings.length - 1]!;
  const from = new THREE.Vector3(top.x, fork, top.z);
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const cy = H - ry;
  leaves.push(blob(top.x, cy, top.z, rx * 0.8, ry * 0.85, rx * 0.8, tones, seed * 17 + 50));
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
    const r = (0.48 + rnd() * 0.2) * rx * (1 - 0.2 * Math.max(0, e));
    leaves.push(blob(px, py, pz, r, r * 0.9, r, rotated(tones, j), seed * 17 + j));
    // Limbs to the lower masses: what shows of the wood under a full crown.
    if (e < 0.35 && limbs < 4) {
      limbs++;
      to.set(from.x + (px - from.x) * 0.75, from.y + (py - r * 0.4 - from.y) * 0.75, from.z + (pz - from.z) * 0.75);
      bend.set((from.x + to.x) / 2, (from.y + to.y) / 2 + 0.3, (from.z + to.z) / 2);
      parts.push(limb(from, bend, to, spec.trunkR * 0.5, spec.trunkR * 0.22, near ? 5 : 4, pal.trunk));
    }
  }
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), top.x, cy, top.z, rx + 0.8, ry + 0.8, rx + 0.8);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * A Scots pine: a tall stem, grey and scaly below, copper-orange from half-way up,
 * bare but for dead stubs until a flat, uneven crown of dark blue-green clouds on
 * short upswept limbs at the very top.
 */
function pineGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 2654435 + 11);
  const H = 18 + rnd() * 6;
  const copper = H * (0.42 + rnd() * 0.12);
  // A mast pine's stem: thick at the foot for its height.
  const rings = trunkRings(rnd, H * 0.92, 0.34, 0.72, 0.7, near ? 10 : 6);
  const parts: THREE.BufferGeometry[] = [
    tube(rings, near ? 7 : 5, (ring, side) => {
      const y = (rings[ring]!.y + rings[ring + 1]!.y) / 2;
      // Grey foot, a band of both, copper above: the change is a zone, in tongues.
      const edge = copper + (hash2(side + seed, 7) - 0.5) * 2.5;
      return y < edge - 1.6 ? pal.pineBarkLow : y < edge + 1.2 ? pal.pineBarkMid : pal.pineBark;
    }),
  ];
  const leaves: THREE.BufferGeometry[] = [];
  const from = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const crownBase = H * (0.62 + rnd() * 0.06);
  // Many limbs, each carrying a plate at its tip and one half-way: the plates overlap
  // into one ragged, flat-topped mass. Four or five lone plates read as a savanna
  // acacia, not a pine.
  const limbs = 8 + Math.floor(rnd() * 3);
  const turn = rnd() * Math.PI * 2;
  for (let j = 0; j < limbs; j++) {
    const k = j / limbs;
    const y = crownBase + (H * 0.9 - crownBase) * k;
    const a = turn + j * 2.3 + rnd() * 0.6;
    const out = (1.6 + rnd() * 1.4) * (1 - 0.4 * k);
    axisAt(rings, y, from);
    bend.set(from.x + Math.cos(a) * out * 0.5, y + 0.3 + rnd() * 0.4, from.z + Math.sin(a) * out * 0.5);
    to.set(from.x + Math.cos(a) * out, y + 0.6 + rnd() * 0.9, from.z + Math.sin(a) * out);
    parts.push(limb(from, bend, to, 0.1, 0.04, near ? 4 : 3, pal.pineBark));
    // Pine needles sit in flat plates on top of their limbs, not in balls.
    const r = 1.5 + rnd() * 0.6;
    leaves.push(blob(to.x, to.y + 0.25, to.z, r, r * 0.55, r * (0.8 + rnd() * 0.3), rotated(pal.pine, j), seed * 23 + j));
    const r2 = r * 0.75;
    leaves.push(blob(bend.x, bend.y + 0.45, bend.z, r2, r2 * 0.6, r2, rotated(pal.pine, j + 1), seed * 23 + j + 40));
  }
  const top = axisAt(rings, H * 0.92, new THREE.Vector3());
  leaves.push(blob(top.x, H * 0.93, top.z, 1.6, 0.9, 1.6, pal.pine, seed * 23 + 90));
  // Dead stubs on the bare stem: short, pointing down, a pine's bare trunk is never clean.
  if (near) {
    const stubs = 6 + Math.floor(rnd() * 5);
    for (let s = 0; s < stubs; s++) {
      const y = 3 + rnd() * (crownBase - 3.5);
      const a = rnd() * Math.PI * 2;
      const len = 0.35 + rnd() * 0.5;
      axisAt(rings, y, from);
      to.set(from.x + Math.cos(a) * len, y - len * 0.4, from.z + Math.sin(a) * len);
      bend.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      parts.push(limb(from, bend, to, 0.035, 0.012, 3, pal.twig));
    }
  }
  const cy = (crownBase + H) / 2 + 0.5;
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), top.x, cy, top.z, 3.4, (H - crownBase) / 2 + 1, 3.4);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * An aspen: a straight smooth stem, pale grey-green, marked with dark diamonds and
 * darkening at the foot, under a narrow, high, round-lumped crown of a greyer green
 * than the birch beside it.
 */
function aspenGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 40503 + 29);
  const H = 14 + rnd() * 5;
  const butt = 0.6 + rnd() * 0.7;
  const rings = trunkRings(rnd, H * 0.95, 0.2, 0.75, 0.15, near ? 10 : 6);
  const parts: THREE.BufferGeometry[] = [
    tube(rings, near ? 7 : 5, (ring, side) => {
      const y = (rings[ring]!.y + rings[ring + 1]!.y) / 2;
      return y < butt + (hash2(side * 3 + seed, 5) - 0.5) * 0.6 ? pal.aspenButt : pal.aspenBark;
    }, 'smooth'),
  ];
  const leaves: THREE.BufferGeometry[] = [];
  const from = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const junctions: [number, number][] = [];
  const crownBase = H * (0.5 + rnd() * 0.06);
  const crownW = 1.6 + rnd() * 0.5;
  const limbs = 7 + Math.floor(rnd() * 3);
  const turn = rnd() * Math.PI * 2;
  for (let j = 0; j < limbs; j++) {
    const k = j / limbs;
    const y = crownBase + (H * 0.86 - crownBase) * k + rnd() * 0.3;
    const a = turn + j * 2.4 + rnd() * 0.5;
    const reach = crownW * (1.1 - 0.5 * k) * (0.8 + rnd() * 0.3);
    axisAt(rings, y, from);
    // Aspen limbs climb: no weeping tips.
    bend.set(from.x + Math.cos(a) * reach * 0.5, y + reach * 0.6, from.z + Math.sin(a) * reach * 0.5);
    to.set(from.x + Math.cos(a) * reach, y + reach * 0.85, from.z + Math.sin(a) * reach);
    parts.push(limb(from, bend, to, 0.055, 0.02, near ? 4 : 3, pal.twig));
    junctions.push([y, a]);
    const r = (1.05 - 0.35 * k) * (0.85 + rnd() * 0.3);
    leaves.push(blob(to.x, to.y, to.z, r, r * 1.1, r, rotated(pal.aspenLeaf, j), seed * 29 + j));
  }
  const top = axisAt(rings, H * 0.95, new THREE.Vector3());
  leaves.push(blob(top.x, H * 0.92, top.z, 0.9, 1.3, 0.9, pal.aspenLeaf, seed * 29 + 90));
  const heart = axisAt(rings, H * 0.72, new THREE.Vector3());
  leaves.push(blob(heart.x, H * 0.72, heart.z, 1.3, 1.8, 1.3, rotated(pal.aspenLeaf, 1), seed * 29 + 91));
  if (near) {
    // Dark diamonds: short, tall lenses — the aspen's lenticels are upright, a birch's lie flat.
    const marks = 10 + Math.floor(rnd() * 7);
    for (let m = 0; m < marks; m++) {
      const y = butt + 0.4 + rnd() * (H * 0.55 - butt);
      parts.push(barkDash(rings, y, 0.1 + rnd() * 0.1, rnd() * Math.PI * 2, 0.35 + rnd() * 0.3, pal.aspenButt));
    }
    for (const [y, a] of junctions) {
      if (y < H * 0.8) parts.push(barkDash(rings, y - 0.25, 0.18, a - 0.5, 1.0, pal.aspenButt));
    }
  }
  const cy = (crownBase + H) / 2;
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), heart.x, cy, heart.z, crownW + 0.8, (H - crownBase) / 2 + 0.8, crownW + 0.8);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * An oak: a thick, dark, furrowed trunk that forks low into a few heavy crooked limbs
 * reaching out rather than up, under a broad, dark, lumpy crown wider than it is tall.
 */
function oakGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 69069 + 5);
  const H = 11 + rnd() * 4;
  const fork = H * (0.3 + rnd() * 0.06);
  const rings = trunkRings(rnd, fork + 0.5, 0.48, 0.3, 0.35, near ? 5 : 3);
  const sides = near ? 9 : 6;
  const parts: THREE.BufferGeometry[] = [
    // Furrowed: bark ridges and dark fissures alternate round the stem.
    // The fissures are the bark texture's; faces coloured in stripes read as a chessboard.
    tube(rings, sides, () => pal.oakBark),
  ];
  const leaves: THREE.BufferGeometry[] = [];
  const top = rings[rings.length - 1]!;
  const from = new THREE.Vector3(top.x, fork, top.z);
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const rx = 4.6 + rnd() * 1.3;
  const ry = (H - fork) / 2 + 0.4;
  const cy = fork + ry - 0.3;
  leaves.push(blob(top.x, cy + 0.4, top.z, rx * 0.68, ry * 0.75, rx * 0.68, pal.oakLeaf, seed * 31 + 70));
  const limbs = 4 + Math.floor(rnd() * 3);
  const turn = rnd() * Math.PI * 2;
  for (let j = 0; j < limbs; j++) {
    const a = turn + (j / limbs) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
    const elev = 0.35 + rnd() * 0.45;
    const L = rx * (0.62 + rnd() * 0.28);
    const dx = Math.cos(a) * Math.cos(elev);
    const dz = Math.sin(a) * Math.cos(elev);
    const dy = Math.sin(elev);
    // A crook half-way: the limb changes its mind.
    const side = (rnd() - 0.5) * 1.6;
    bend.set(from.x + dx * L * 0.5 - dz * side, from.y + dy * L * 0.5 + 0.4 + rnd() * 0.6, from.z + dz * L * 0.5 + dx * side);
    to.set(from.x + dx * L, from.y + dy * L + 0.5, from.z + dz * L);
    parts.push(limb(from, bend, to, 0.26, 0.09, near ? 5 : 4, pal.oakBark));
    const r = 1.8 + rnd() * 0.7;
    leaves.push(blob(to.x, to.y + 0.6, to.z, r, r * 0.75, r, rotated(pal.oakLeaf, j), seed * 31 + j));
    const r2 = 1.3 + rnd() * 0.5;
    leaves.push(blob(bend.x, bend.y + 1.0, bend.z, r2, r2 * 0.8, r2, rotated(pal.oakLeaf, j + 1), seed * 31 + j + 40));
  }
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), top.x, cy, top.z, rx + 0.8, ry + 0.8, rx + 0.8);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * An alder by the water: often two or three stems from one foot, dark grey, under a
 * narrow crown tapering to a blunt point, the darkest green of the broadleaves.
 */
function alderGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 92821 + 17);
  const H = 10 + rnd() * 4;
  const stems = 1 + (rnd() < 0.55 ? 1 : 0) + (rnd() < 0.3 ? 1 : 0);
  const parts: THREE.BufferGeometry[] = [];
  const turn = rnd() * Math.PI * 2;
  for (let s = 0; s < stems; s++) {
    const a = turn + (s / stems) * Math.PI * 2;
    const spread = stems === 1 ? 0 : 0.25;
    const lean = stems === 1 ? 0 : 0.9 + rnd() * 0.6;
    const own = trunkRings(rnd, H * (0.88 - s * 0.08), 0.2 - s * 0.03, 0.75, 0.2, near ? 8 : 5);
    const moved = own.map((ring) => {
      const t = Math.max(0, ring.y) / H;
      return { ...ring, x: ring.x + Math.cos(a) * (spread + lean * t), z: ring.z + Math.sin(a) * (spread + lean * t) };
    });
    parts.push(tube(moved, near ? 6 : 4, () => pal.alderBark));
  }
  const leaves: THREE.BufferGeometry[] = [];
  const crownBase = H * (0.32 + rnd() * 0.06);
  const rx = 2.0 + rnd() * 0.6 + (stems - 1) * 0.5;
  const levels = 6 + Math.floor(rnd() * 2);
  for (let j = 0; j < levels; j++) {
    const k = j / levels;
    const y = crownBase + (H - 1.2 - crownBase) * k;
    // A cone: wide low, narrowing up to a blunt top. Two masses a level, on opposite
    // sides and overlapping the axis: one mass a level stacked into a topiary.
    const ring = rx * (1 - 0.7 * k);
    const a = turn + j * 2.2 + rnd() * 0.6;
    for (const side of [0, Math.PI]) {
      const r = (1.35 - 0.5 * k) * (0.85 + rnd() * 0.3);
      const d = ring * (0.35 + rnd() * 0.25);
      leaves.push(blob(Math.cos(a + side) * d, y + (rnd() - 0.5) * 0.8, Math.sin(a + side) * d, r, r * 1.2, r, rotated(pal.alderLeaf, j), seed * 37 + j * 2 + (side ? 1 : 0)));
    }
  }
  leaves.push(blob(0, H - 0.9, 0, 0.8, 1.1, 0.8, pal.alderLeaf, seed * 37 + 90));
  const cy = (crownBase + H) / 2;
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), 0, cy, 0, rx + 0.8, (H - crownBase) / 2 + 0.8, rx + 0.8);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * A white willow, the rakita of ditches and ponds: a short, thick, leaning trunk that
 * breaks into a fountain of upswept limbs, and a broad, rounded, silvery crown.
 */
function willowGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 48271 + 41);
  const H = 8.5 + rnd() * 3;
  const trunkH = H * (0.26 + rnd() * 0.08);
  const rings = trunkRings(rnd, trunkH, 0.42, 0.25, 1.1, near ? 4 : 3);
  const parts: THREE.BufferGeometry[] = [tube(rings, near ? 8 : 5, () => pal.willowBark)];
  const leaves: THREE.BufferGeometry[] = [];
  const top = rings[rings.length - 1]!;
  const from = new THREE.Vector3(top.x, trunkH, top.z);
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const rx = 3.6 + rnd() * 1.0;
  const limbs = 4 + Math.floor(rnd() * 3);
  const turn = rnd() * Math.PI * 2;
  for (let j = 0; j < limbs; j++) {
    const a = turn + (j / limbs) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const out = rx * (0.5 + rnd() * 0.3);
    const up = (H - trunkH) * (0.6 + rnd() * 0.25);
    // Up first, then out: the fountain.
    bend.set(from.x + Math.cos(a) * out * 0.25, from.y + up * 0.6, from.z + Math.sin(a) * out * 0.25);
    to.set(from.x + Math.cos(a) * out, from.y + up, from.z + Math.sin(a) * out);
    parts.push(limb(from, bend, to, 0.2, 0.07, near ? 5 : 4, pal.willowBark));
    const r = 1.6 + rnd() * 0.6;
    leaves.push(blob(to.x, to.y, to.z, r, r * 0.9, r, rotated(pal.willowLeaf, j), seed * 41 + j));
  }
  const cy = H - 2.4;
  leaves.push(blob(from.x, cy, from.z, rx * 0.7, 2.2, rx * 0.7, pal.willowLeaf, seed * 41 + 60));
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), from.x, cy, from.z, rx + 0.8, 3.2, rx + 0.8);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: crown };
}

/**
 * A rowan at a wood's edge: small, slender, sometimes two stems, an open oval crown
 * of light leaves, and the orange-red berry clusters that are the whole point of it.
 */
function rowanGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 16807 + 53);
  const H = 5.5 + rnd() * 2.5;
  const stems = rnd() < 0.4 ? 2 : 1;
  const parts: THREE.BufferGeometry[] = [];
  const turn = rnd() * Math.PI * 2;
  let rings: Ring[] = [];
  for (let s = 0; s < stems; s++) {
    const a = turn + s * Math.PI;
    const lean = stems === 1 ? 0 : 0.6;
    const own = trunkRings(rnd, H * (0.9 - s * 0.1), 0.12, 0.7, 0.25, near ? 6 : 4).map((ring) => {
      const t = Math.max(0, ring.y) / H;
      return { ...ring, x: ring.x + Math.cos(a) * lean * t, z: ring.z + Math.sin(a) * lean * t };
    });
    if (s === 0) rings = own;
    parts.push(tube(own, near ? 5 : 4, () => pal.rowanBark));
  }
  const leaves: THREE.BufferGeometry[] = [];
  const from = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const to = new THREE.Vector3();
  const crownBase = H * (0.4 + rnd() * 0.06);
  const crownW = 1.4 + rnd() * 0.4;
  const masses = 6 + Math.floor(rnd() * 3);
  const berries: [number, number, number, number][] = [];
  for (let j = 0; j < masses; j++) {
    const k = j / masses;
    const y = crownBase + (H * 0.85 - crownBase) * k;
    const a = turn + j * 2.4 + rnd() * 0.5;
    const reach = crownW * (1.05 - 0.4 * k) * (0.8 + rnd() * 0.3);
    axisAt(rings, y, from);
    bend.set(from.x + Math.cos(a) * reach * 0.5, y + reach * 0.5, from.z + Math.sin(a) * reach * 0.5);
    to.set(from.x + Math.cos(a) * reach, y + reach * 0.7, from.z + Math.sin(a) * reach);
    parts.push(limb(from, bend, to, 0.04, 0.015, 3, pal.twig));
    const r = (0.8 - 0.25 * k) * (0.85 + rnd() * 0.3);
    leaves.push(blob(to.x, to.y, to.z, r, r * 0.85, r, rotated(pal.rowanLeaf, j), seed * 43 + j));
    // Clusters hang under the outer side of a mass, where the sun finds them.
    // Flat bunches, many and small: a few big balls read as apples. The same at both
    // levels: a bunch appearing at the swap distance is a pop like any other.
    const clusters = 2;
    for (let c = 0; c < clusters; c++) {
      const ca = a + (rnd() - 0.5) * 1.6;
      const cr = 0.12 + rnd() * 0.04;
      berries.push([to.x + Math.cos(ca) * r * 0.9, to.y - r * (0.1 + rnd() * 0.4), to.z + Math.sin(ca) * r * 0.9, cr]);
    }
  }
  const heart = axisAt(rings, (crownBase + H) / 2, new THREE.Vector3());
  leaves.push(blob(heart.x, heart.y, heart.z, crownW * 0.7, crownW * 0.9, crownW * 0.7, pal.rowanLeaf, seed * 43 + 90));
  // A bunch is a few berries, not one disc: three small balls hanging together.
  for (const [x, y, z, r] of berries) {
    for (let b = 0; b < 3; b++) {
      const ba = b * 2.1 + x;
      parts.push(lump(x + Math.cos(ba) * r * 0.9, y - b * r * 0.5, z + Math.sin(ba) * r * 0.9, r, r, r, [pal.rowanBerry], seed + b));
    }
  }
  const crown = finishCrown(mergeGeometries(leaves.map(asFlat)), heart.x, heart.y, heart.z, crownW + 0.7, (H - crownBase) / 2 + 0.7, crownW + 0.7);
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
    leaves.push(blob(x, h, z, r, r * 1.15, r, rotated(pal.bush, i), seed * 19 + i));
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

/**
 * A fern: a crown of fronds from one root, each a card painted with a frond
 * (render/leafpaint.ts), rising and then arching out and down in two segments. Bracken
 * and lady fern stand knee to waist high; the instance scale spreads that.
 */
function fernGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 6007 + 3);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const fronds = near ? 9 : 6;
  const cell = leafCellUv('frond', 0);
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rnd() * 0.5;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const L = 0.8 + rnd() * 0.45;
    const rise = 0.55 + rnd() * 0.35;
    const width = 0.34 + rnd() * 0.1;
    c.setHex(pal.fern[f % pal.fern.length]!);
    // Spine: root, the arch's top two thirds out, the drooping tip.
    const spine = [
      [0, 0.02, 0],
      [dx * L * 0.45, L * rise, dz * L * 0.45],
      [dx * L, L * rise * 0.55, dz * L],
    ];
    // Across: horizontal, tipped a little so a frond is seen from above and from the side.
    const tilt = 0.35 + rnd() * 0.3;
    const px = -dz * Math.cos(tilt);
    const py = Math.sin(tilt);
    const pz = dx * Math.cos(tilt);
    for (let seg = 0; seg < 2; seg++) {
      const p0 = spine[seg]!;
      const p1 = spine[seg + 1]!;
      const v0 = cell.v0 + (cell.v1 - cell.v0) * (seg / 2);
      const v1 = cell.v0 + (cell.v1 - cell.v0) * ((seg + 1) / 2);
      const w0 = width * (seg === 0 ? 0.55 : 1);
      const w1 = width * (seg === 0 ? 1 : 0.6);
      const corner = (p: number[], w: number, side: number, u: number, v: number): void => {
        pos.push(p[0]! + px * w * side, p[1]! + py * w * side, p[2]! + pz * w * side);
        nor.push(0, 1, 0);
        uv.push(u, v);
        col.push(c.r, c.g, c.b);
      };
      corner(p0, w0, -1, cell.u0, v0);
      corner(p0, w0, 1, cell.u1, v0);
      corner(p1, w1, 1, cell.u1, v1);
      corner(p0, w0, -1, cell.u0, v0);
      corner(p1, w1, 1, cell.u1, v1);
      corner(p1, w1, -1, cell.u0, v1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return { wood: null, leaves: finishCrown(g, 0, 0.35, 0, 1.1, 0.6, 1.1) };
}

/**
 * A stump: a short broad trunk with a flared foot, its top a pale cut face or, when old,
 * a ragged grey break, a cushion of moss on one side. Sits a little into the ground.
 */
function stumpGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 7717 + 5);
  const r = 0.28 + rnd() * 0.12;
  const h = 0.35 + rnd() * 0.35;
  const rings: Ring[] = [
    { x: 0, y: -0.15, z: 0, r: r * 1.45 },
    { x: 0, y: 0.08, z: 0, r: r * 1.15 },
    { x: 0, y: h, z: 0, r },
  ];
  const sides = near ? 9 : 6;
  const parts = [tube(rings, sides, () => pal.deadwood)];
  // The cut: a flat disc, tilted a touch, pale if fresh and grey if old.
  const fresh = rnd() < 0.5;
  const top = new THREE.CircleGeometry(r * 0.98, sides).rotateX(-Math.PI / 2).rotateZ((rnd() - 0.5) * 0.25).translate(0, h, 0);
  parts.push(flatColour(top, () => (fresh ? pal.deadwoodCut : pal.deadwood)));
  const moss = lump(r * 0.7, 0.12, 0, r * 0.7, 0.18, r * 0.8, [pal.moss], seed * 13);
  moss.rotateY(rnd() * Math.PI * 2);
  return { wood: mergeGeometries(parts.map(asFlat)), leaves: asFlat(moss) };
}

/**
 * A fallen trunk: a long tube lying along x on the ground, thinning toward the top end,
 * a few broken branch stubs, its root end a cut or a torn plate. Grey with moss on top.
 */
function logGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 9973 + 17);
  const L = 5 + rnd() * 5;
  const r0 = 0.2 + rnd() * 0.1;
  const steps = near ? 5 : 3;
  const rings: Ring[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    rings.push({ x: 0, y: -L / 2 + t * L, z: 0, r: r0 * (1 - 0.55 * t) });
  }
  // Built upright (the tube is vertical), then laid down: rotated onto x, raised to
  // rest on the ground, a little sunk.
  const wood = tube(rings, near ? 7 : 5, () => pal.deadwood);
  const parts = [wood];
  const stubs = 2 + Math.floor(rnd() * 3);
  for (let k = 0; k < stubs; k++) {
    const y = -L / 2 + (0.3 + rnd() * 0.6) * L;
    const a = rnd() * Math.PI * 2;
    const from = new THREE.Vector3(0, y, 0);
    const to = new THREE.Vector3(Math.cos(a) * 0.7, y + 0.5, Math.sin(a) * 0.7);
    const bend = from.clone().lerp(to, 0.5);
    parts.push(limb(from, bend, to, 0.06, 0.03, 3, pal.deadwood));
  }
  const g = mergeGeometries(parts.map(asFlat));
  g.rotateZ(Math.PI / 2).translate(0, r0 * 0.75, 0);
  const moss = lump(0, r0 * 1.5, 0, L * 0.3, 0.1, r0 * 0.8, [pal.moss], seed * 29);
  return { wood: g, leaves: asFlat(moss) };
}

/**
 * A juniper: the bor's dark column, taller than wide, of needle masses stacked on a
 * short stem, narrowing to a blunt point.
 */
function juniperGeometry(seed: number, pal: Palette, near: boolean): TreeShape {
  const rnd = rng(seed * 4099 + 11);
  const H = 2.2 + rnd() * 1.2;
  const wood = [tube([{ x: 0, y: -0.2, z: 0, r: 0.07 }, { x: 0, y: H * 0.5, z: 0, r: 0.04 }], near ? 5 : 4, () => pal.twig)];
  const leaves: THREE.BufferGeometry[] = [];
  const masses = near ? 5 : 3;
  for (let k = 0; k < masses; k++) {
    const t = (k + 0.5) / masses;
    const r = 0.55 * (1 - 0.55 * t) + 0.12;
    leaves.push(blob((rnd() - 0.5) * 0.15, H * (0.12 + 0.8 * t), (rnd() - 0.5) * 0.15, r, H / masses * 0.8, r, rotated(pal.juniper, k), seed * 17 + k));
  }
  return {
    wood: mergeGeometries(wood.map(asFlat)),
    leaves: finishCrown(mergeGeometries(leaves.map(asFlat)), 0, H * 0.5, 0, 0.7, H * 0.55, 0.7),
  };
}

const material = applyComicShading(
  // Leaves are cards (see `blob`): textured, seen from both sides, cut out by the
  // atlas's alpha. Wood samples the atlas's solid cell and is closed, so its back faces
  // are never seen.
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, map: leafAtlas(), side: THREE.DoubleSide }),
  { contourStrength: 0, stippleStrength: 0, shadowWarmth: 0.3 },
);
/**
 * Leaf cards cast their painted outline, not their square, from either face. Wood casts
 * from its back faces only, as three's default shadow side does for a closed solid:
 * drawn from both, its lit faces shadowed themselves in fine stripes.
 */
const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafAtlas(), alphaTest: 0.5, side: THREE.DoubleSide });
depthMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aWood;\nattribute float aKind;\nvarying float vWood;\nvarying float vKind;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWood = aWood;\nvKind = aKind;');
  // Undergrowth (fern, juniper) casts no shadow: under the trees it would be shadow in
  // shadow, and it was a shadow-pass draw for every bucket of it.
  shader.fragmentShader = `varying float vWood;\nvarying float vKind;\n${shader.fragmentShader.replace(
    'void main() {',
    `void main() {\n\tif ( vKind > ${(UNDERGROWTH_KIND_FROM - 0.5).toFixed(1)} ) discard;\n\tif ( vWood > 0.5 && gl_FrontFacing ) discard;`,
  )}`;
};
depthMaterial.customProgramCacheKey = () => 'tree-depth-v3';
applyBarkMapping(depthMaterial);
// Leaves take no sun shadow: self-shadowed crowns crawl with triangle-sized acne. Wood
// does. One program for both, told apart per vertex by `aWood`.
{
  const compileComic = material.onBeforeCompile;
  const shadowTest = '( directLight.visible && receiveShadow )';
  material.onBeforeCompile = (shader, renderer) => {
    compileComic.call(material, shader, renderer);
    // The test that guards the DIRECTIONAL shadow lookup: the last one before it.
    const lookup = shader.fragmentShader.indexOf('directionalShadowMap[ i ]');
    const at = lookup < 0 ? -1 : shader.fragmentShader.lastIndexOf(shadowTest, lookup);
    if (at < 0) throw new Error('Tree shader: directional shadow test not found');
    shader.fragmentShader =
      shader.fragmentShader.slice(0, at) +
      '( directLight.visible && receiveShadow && vWood > 0.5 )' +
      shader.fragmentShader.slice(at + shadowTest.length);
    injectSeason(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aWood;
attribute float aKind;
varying float vWood;
varying float vUnderFade;`)
      // Leaves take the season's colour, each tree at its own pace: its random comes
      // from the tint the impostor also carries, so model and impostor turn together.
      .replace('#include <color_vertex>', `#include <color_vertex>
#if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
{
  float tint = instanceColor.r;
  if ( aWood < 0.5 ) vColor.rgb = seasonLeaf( vColor.rgb, int( aKind + 0.5 ), ${SEASON_TREE_RANDOM_GLSL} );
}
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWood = aWood;
// Undergrowth dissolves over UNDERGROWTH_FADE, tree by tree at its foot, by coverage:
// past it the forest stops drawing it at all (world/forest.ts).
vUnderFade = 1.0;
#ifdef USE_INSTANCING
if ( aKind > ${(UNDERGROWTH_KIND_FROM - 0.5).toFixed(1)} ) {
  vec3 underFoot = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  vUnderFade = 1.0 - smoothstep( ${UNDERGROWTH_FADE_FROM_M.toFixed(1)}, ${UNDERGROWTH_FADE_TO_M.toFixed(1)}, length( cameraPosition.xz - underFoot.xz ) );
}
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vWood;
varying float vUnderFade;`)
      // A leaf card's edge from the atlas's coverage, sharpened to about a pixel and
      // widened as it minifies (mips average leaf and gap and would thin the crown with
      // distance), as the grass does. Under MSAA the coverage resolves to a soft edge.
      .replace('#include <map_fragment>', `#include <map_fragment>
// Only the leaf cards are two-sided. Wood draws its front faces as before: the
// spruce's tiers are open shells, and their backs fought their fronts in stripes.
if ( vWood > 0.5 && !gl_FrontFacing ) discard;
{
  vec2 leafTexel = vMapUv * vec2( textureSize( map, 0 ) );
  float leafMip = max( 0.0, 0.5 * log2( max( dot( dFdx( leafTexel ), dFdx( leafTexel ) ), dot( dFdy( leafTexel ), dFdy( leafTexel ) ) ) ) );
  float leafA = diffuseColor.a * ( 1.0 + leafMip * 0.22 );
  diffuseColor.a = clamp( ( leafA - 0.5 ) / max( fwidth( leafA ), 0.0001 ) + 0.5, 0.0, 1.0 ) * vUnderFade;
  if ( diffuseColor.a < 0.02 ) discard;
}`)
      // Both faces of a leaf card are lit by its crown normal (see \`finishCrown\`): three
      // flips the normal of a back face, which turned half the cards of a crown dark.
      .replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', 'normal *= vWood > 0.5 ? faceDirection : 1.0;'),
      );
  };
  const comicKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${comicKey.call(material)}:tree-cards-v3`;
}
// Bark (render/leafpaint.ts): wood whose texture coordinates carry a bark offset.
applyBarkMapping(material);

/** Wood and leaves merged, tagged per vertex: see `TreePart`. */
function mergeTreeParts(wood: THREE.BufferGeometry | null, leaves: THREE.BufferGeometry | null, kind: TreeKind): THREE.BufferGeometry {
  const tagged = ([[wood, 1], [leaves, 0]] as const)
    .filter(([g]) => g !== null)
    .map(([g, tag]) => {
      // Every part needs texture coordinates now, the spruce's untextured cones too.
      g = asFlat(g!);
      g.setAttribute('aWood', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(tag), 1));
      return g;
    });
  const merged = tagged.length === 1 ? tagged[0]! : mergeGeometries(tagged);
  if (!merged) throw new Error('Tree parts could not be merged');
  // The kind, for the season's leaf colours (render/season.ts).
  merged.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(merged.getAttribute('position').count).fill(kind), 1));
  return merged;
}

/** Which leaf painting each kind's crown wears (render/leafpaint.ts). */
const LEAF_SPRITES: Record<TreeKind, LeafSprite> = {
  [TreeKind.Birch]: 'small',
  [TreeKind.Spruce]: 'needle',
  [TreeKind.Bush]: 'broad',
  [TreeKind.Lime]: 'broad',
  [TreeKind.Pine]: 'needle',
  [TreeKind.Aspen]: 'small',
  [TreeKind.Oak]: 'broad',
  [TreeKind.Maple]: 'broad',
  [TreeKind.Alder]: 'small',
  [TreeKind.Willow]: 'small',
  [TreeKind.Rowan]: 'small',
  [TreeKind.Fern]: 'frond',
  [TreeKind.Juniper]: 'needle',
  [TreeKind.Stump]: 'broad',
  [TreeKind.Log]: 'small',
};

/** Kinds from this one on are undergrowth: fern and juniper. */
export const UNDERGROWTH_KIND_FROM = TreeKind.Fern;
/** Undergrowth dissolves between these camera distances and is not drawn past them. */
export const UNDERGROWTH_FADE_FROM_M = 55;
export const UNDERGROWTH_FADE_TO_M = 75;

const VARIANTS: Record<TreeKind, number> = {
  [TreeKind.Birch]: 5,
  [TreeKind.Spruce]: 5,
  [TreeKind.Bush]: 3,
  [TreeKind.Lime]: 3,
  [TreeKind.Pine]: 4,
  [TreeKind.Aspen]: 3,
  [TreeKind.Oak]: 4,
  [TreeKind.Maple]: 3,
  [TreeKind.Alder]: 3,
  [TreeKind.Willow]: 3,
  [TreeKind.Rowan]: 3,
  [TreeKind.Fern]: 4,
  [TreeKind.Juniper]: 3,
  [TreeKind.Stump]: 3,
  [TreeKind.Log]: 3,
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
      [TreeKind.Lime]: (seed, p, near) => roundCrownGeometry(LIME, seed, p, near),
      [TreeKind.Pine]: pineGeometry,
      [TreeKind.Aspen]: aspenGeometry,
      [TreeKind.Oak]: oakGeometry,
      [TreeKind.Maple]: (seed, p, near) => roundCrownGeometry(MAPLE, seed, p, near),
      [TreeKind.Alder]: alderGeometry,
      [TreeKind.Willow]: willowGeometry,
      [TreeKind.Rowan]: rowanGeometry,
      [TreeKind.Fern]: fernGeometry,
      [TreeKind.Juniper]: juniperGeometry,
      [TreeKind.Stump]: stumpGeometry,
      [TreeKind.Log]: logGeometry,
    };
    const lod = ({ wood, leaves }: TreeShape, kind: TreeKind): TreeLod => {
      const geometry = mergeTreeParts(wood, leaves, kind);
      geometry.computeBoundingSphere();
      return [{ geometry, material, depthMaterial }];
    };
    variants = TREE_KINDS.map((kind) => {
      leafSprite = LEAF_SPRITES[kind];
      return Array.from({ length: VARIANTS[kind] }, (_, seed) => ({
        near: lod(build[kind](seed + 1, pal, true), kind),
        far: lod(build[kind](seed + 1, pal, false), kind),
      }));
    });
  }
  return Promise.resolve(variants);
}
