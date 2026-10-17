/**
 * The parts every toilet family is assembled from (geometry.ts, families.ts): roofs over a
 * rectangle or a drum, the drum wrap, sealed annex booths, louvres and columns, and the
 * `Reach` an authored footprint is summed from.
 *
 * Everything is the POI kit's boxes and cylinders, or a cached custom geometry in a kit
 * material, so a shell merges like every kit variant (world/poi-variants.ts
 * `mergePoiStatics`) and links no program the kit has not. Every roof piece is a
 * `poiRoof`, so the gallery's roof toggle opens the interior.
 */

import * as THREE from 'three';
import { box, cylinder, gableGeometry, geometryCache, material } from '../poi/kit';
import type { ToiletAnnex, ToiletPalette, ToiletRoof, ToiletWallPattern } from './types';

/** Plinth under a volume, metres; it reaches `PLINTH_MARGIN` past the walls. */
export const PLINTH = 0.15;
export const PLINTH_MARGIN = 0.2;
export const WALL = 0.14;
const GABLE_PITCH = 0.55;
const ROOF_SLAB = 0.12;
const FLAT_SLAB = 0.16;
const DISC_SLAB = 0.16;
const PYRAMID_BASE = 0.1;
/** A floating roof's clear gap over what it rests on. */
const FLOAT_GAP = 0.35;
const POST_RADIUS = 0.035;
/** Sides of every round thing: a multiple of four puts a vertex on each axis, so a radius is an exact extent. */
export const ROUND_SIDES = 24;
/** Facets of a drum wrap's arc, front corner to front corner. */
const DRUM_ARC_STEPS = 20;
const LOUVRE_STEP = 0.2;
const LOUVRE_WIDTH = 0.04;
const LOUVRE_DEPTH = 0.16;
/** Between a louvre and its wall, at its nearest corner, whatever its angle. */
const LOUVRE_STANDOFF = 0.03;
/** Largest turn of a louvre off square, radians. */
const LOUVRE_TURN = 0.7;
/** How far past its wall face a louvre can reach. */
export const LOUVRE_REACH = LOUVRE_STANDOFF + Math.hypot(LOUVRE_WIDTH, LOUVRE_DEPTH);
export const COLUMN_RADIUS = 0.05;
/** An annex's closed door: frame width, height and how far the frame stands proud. */
const ANNEX_DOOR_WIDTH = 0.9;
const ANNEX_DOOR_HEIGHT = 2.0;
const ANNEX_FRAME = 0.08;
const ANNEX_FRAME_DEPTH = 0.04;
const DRUM_DOOR_WIDTH = 0.8;
const DRUM_DOOR_HEIGHT = 1.9;

/** What a roof covers: a rectangle about its centre, or a drum's circle. */
export type RoofOutline =
  | { readonly kind: 'rect'; readonly x: number; readonly z: number; readonly width: number; readonly depth: number }
  | { readonly kind: 'circle'; readonly x: number; readonly z: number; readonly radius: number };

export interface RoofLook {
  readonly roof: number;
  readonly accent: number;
  /** A gable's end walls, front and back. */
  readonly ends: readonly [number, number];
  /** A floating roof's posts. */
  readonly post: number;
  /** Chimney stacks on a gable (the `house` dressing). */
  readonly chimneys: boolean;
}

export function roofLook(palette: ToiletPalette, ends: readonly [number, number], chimneys = false): RoofLook {
  return { roof: palette.roof, accent: palette.accent, ends, post: palette.trim, chimneys };
}

function asRoof<T extends THREE.Object3D>(object: T): T {
  object.userData.poiRoof = true;
  return object;
}

/**
 * A roof on the volume tops at `y`, reaching `overhang` past `outline`. A floating roof
 * stands on `posts` (`[x, z]`, at least three) over whatever is solid under them.
 */
export function roofOver(
  parent: THREE.Object3D,
  kind: ToiletRoof,
  outline: RoofOutline,
  y: number,
  overhang: number,
  look: RoofLook,
  posts: readonly (readonly [number, number])[] = [],
): void {
  if (outline.kind === 'circle') {
    if (kind !== 'disc' && kind !== 'floating') throw new Error(`A ${kind} roof does not fit a drum`);
    let lift = 0;
    if (kind === 'floating') {
      if (posts.length < 3) throw new Error('A floating roof needs three posts');
      lift = FLOAT_GAP;
      for (const [x, z] of posts) cylinder(parent, POST_RADIUS, POST_RADIUS, lift, 8, [x, y + lift / 2, z], look.post);
    }
    const radius = outline.radius + overhang;
    asRoof(cylinder(parent, radius, radius, DISC_SLAB, ROUND_SIDES, [outline.x, y + lift + DISC_SLAB / 2, outline.z], look.roof));
    return;
  }
  if (kind === 'disc' || kind === 'floating') throw new Error(`A ${kind} roof needs a drum`);
  const { x: cx, z: cz, width: w, depth: d } = outline;
  const o = overhang;
  if (kind === 'flat') {
    box(parent, [w + 2 * o, FLAT_SLAB, d + 2 * o], [cx, y + FLAT_SLAB / 2, cz], look.roof, [0, 0, 0], true);
    return;
  }
  if (kind === 'pyramid') {
    box(parent, [w + 2 * o, PYRAMID_BASE, d + 2 * o], [cx, y + PYRAMID_BASE / 2, cz], look.roof, [0, 0, 0], true);
    const rise = 0.5 * (Math.min(w, d) / 2 + o);
    const frustum = new THREE.Mesh(pyramidGeometry(0.1), material(look.roof));
    frustum.scale.set(w + 2 * o, rise, d + 2 * o);
    frustum.position.set(cx, y + PYRAMID_BASE + rise / 2, cz);
    frustum.castShadow = true;
    frustum.receiveShadow = true;
    parent.add(asRoof(frustum));
    asRoof(cylinder(parent, 0.05, 0.05, 0.35, 6, [cx, y + PYRAMID_BASE + rise + 0.175, cz], look.accent));
    return;
  }
  // Gable, ridge along Z: two slabs whose undersides run along the gable ends' tops.
  const slope = Math.tan(GABLE_PITCH);
  const rise = (w / 2) * slope;
  const run = w / 2 + o;
  const length = run / Math.cos(GABLE_PITCH);
  const midX = run / 2;
  const midY = y + rise - midX * slope;
  const nx = Math.sin(GABLE_PITCH) * (ROOF_SLAB / 2);
  const ny = Math.cos(GABLE_PITCH) * (ROOF_SLAB / 2);
  box(parent, [length, ROOF_SLAB, d + 2 * o], [cx + midX + nx, midY + ny, cz], look.roof, [0, 0, -GABLE_PITCH], true);
  box(parent, [length, ROOF_SLAB, d + 2 * o], [cx - midX - nx, midY + ny, cz], look.roof, [0, 0, GABLE_PITCH], true);
  for (const [z, color] of [[cz - d / 2 + WALL / 2, look.ends[0]], [cz + d / 2 - WALL / 2, look.ends[1]]] as const) {
    const end = new THREE.Mesh(gableGeometry(w, rise, WALL), material(color));
    end.position.set(cx, y, z);
    end.castShadow = true;
    end.receiveShadow = true;
    parent.add(asRoof(end));
  }
  if (look.chimneys) {
    const x = 0.45;
    const surface = y + rise - x * slope + ROOF_SLAB / Math.cos(GABLE_PITCH);
    for (const z of [-d / 4, 0, d / 4]) {
      box(parent, [0.24, 0.7, 0.24], [cx + x, surface + 0.35 - 0.12, cz + z], look.accent, [0, 0, 0], true);
    }
  }
}

/** A roof's horizontal half extents about its outline's centre, unturned. */
export function roofHalf(kind: ToiletRoof, outline: RoofOutline, overhang: number): readonly [number, number] {
  if (outline.kind === 'circle') return [outline.radius + overhang, outline.radius + overhang];
  // A gable slab's upper edge reaches past its eave by its thickness's run.
  const gable = kind === 'gable' ? ROOF_SLAB * Math.sin(GABLE_PITCH) : 0;
  return [outline.width / 2 + overhang + gable, outline.depth / 2 + overhang];
}

/** A four-sided frustum with flat facets, its corners on the axes' diagonals: unit base. */
function pyramidGeometry(topShare: number): THREE.BufferGeometry {
  const key = `toilet-pyramid:${topShare}`;
  let geometry = geometryCache.get(key);
  if (!geometry) {
    const radius = Math.SQRT1_2;
    geometry = new THREE.CylinderGeometry(radius * topShare, radius, 1, 4, 1, false, Math.PI / 4).toNonIndexed();
    geometry.computeVertexNormals();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

/** The smallest drum that clears a `width` x `depth` cabin's back corners. */
export function minDrumRadius(width: number, depth: number): number {
  return Math.hypot(width, depth) / 2 + 0.05;
}

/** Z of the centre of the drum whose circle runs through the cabin's front corners (X is 0). */
export function drumCentreZ(width: number, depth: number, radius: number): number {
  return Math.sqrt(radius * radius - (width * width) / 4) - depth / 2;
}

/**
 * The solid between a drum and the cabin's side and back walls, from the plinth top up
 * `height`: an arc from the front-right corner round the back to the front-left one, then
 * back along the walls a centimetre inside them, so it never shares a face with the cabin.
 */
export function drumWrapGeometry(width: number, depth: number, height: number, radius: number): THREE.BufferGeometry {
  const key = `toilet-drum:${width}:${depth}:${height}:${radius}`;
  let geometry = geometryCache.get(key);
  if (geometry) return geometry;
  const cz = drumCentreZ(width, depth, radius);
  const start = Math.PI - Math.asin(width / 2 / radius);
  // Shape space is (x, -z): extruded along its own +Z, then turned so that runs up.
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= DRUM_ARC_STEPS; i++) {
    const phi = start - (2 * start * i) / DRUM_ARC_STEPS;
    points.push(new THREE.Vector2(radius * Math.sin(phi), -(cz + radius * Math.cos(phi))));
  }
  const inset = 0.01;
  const [hw, hd] = [width / 2 - inset, depth / 2 - inset];
  points.push(new THREE.Vector2(-hw, hd), new THREE.Vector2(-hw, -hd), new THREE.Vector2(hw, -hd), new THREE.Vector2(hw, hd));
  geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points), { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometryCache.set(key, geometry);
  return geometry;
}

/** Deterministic 0..1 from an integer. */
function hash(n: number): number {
  const h = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Cedar boards standing off one outer wall face at varied angles, clear of `skip` spans
 * along it. `face` is the face's plane, `outward` its normal's sign; boards stand from
 * `base` up `height`.
 */
export function louvres(
  parent: THREE.Object3D,
  axis: 'x' | 'z',
  face: number,
  outward: 1 | -1,
  length: number,
  base: number,
  height: number,
  skip: readonly (readonly [number, number])[],
  color: number,
  seed: number,
): void {
  const half = Math.hypot(LOUVRE_WIDTH, LOUVRE_DEPTH) / 2;
  const centre = face + outward * (LOUVRE_STANDOFF + half);
  const y = base + height / 2;
  let index = 0;
  for (let u = -length / 2 + LOUVRE_STEP / 2; u <= length / 2 - LOUVRE_STEP / 2 + 1e-6; u += LOUVRE_STEP) {
    index++;
    if (skip.some(([a, b]) => u > a && u < b)) continue;
    const turn = LOUVRE_TURN * (2 * hash(seed * 131 + index) - 1);
    if (axis === 'x') box(parent, [LOUVRE_WIDTH, height, LOUVRE_DEPTH], [u, y, centre], color, [0, turn, 0]);
    else box(parent, [LOUVRE_DEPTH, height, LOUVRE_WIDTH], [centre, y, u], color, [0, turn, 0]);
  }
}

/** A slim post from the ground up to `top`. */
export function column(parent: THREE.Object3D, x: number, z: number, top: number, color: number): THREE.Mesh {
  const post = cylinder(parent, COLUMN_RADIUS, COLUMN_RADIUS, top, 8, [x, top / 2, z], color);
  post.userData.toiletPart = 'column';
  return post;
}

export interface AnnexLook {
  readonly palette: ToiletPalette;
  /** A box annex's wall finish. */
  readonly pattern: ToiletWallPattern;
  /** Its own plinth, or none where it stands on a shared one. */
  readonly plinth: boolean;
  /** Its own roof, or none where a shared roof or a cover is over it. */
  readonly roof: ToiletRoof | null;
  readonly overhang: number;
  readonly louvres: boolean;
}

/**
 * A sealed booth: plinth, solid volume, a closed door on its -Z face, and optionally
 * louvres and a roof. Its group carries `userData.toiletPart = 'annex'` and its volume
 * `userData.toiletVolume`, for the checks.
 */
export function annex(parent: THREE.Object3D, spec: ToiletAnnex, look: AnnexLook, seed: number): THREE.Group {
  const group = new THREE.Group();
  group.position.set(spec.x, 0, spec.z);
  group.rotation.y = spec.yaw;
  group.userData.toiletPart = 'annex';
  parent.add(group);
  const { palette } = look;
  const h = spec.height;
  const top = PLINTH + h;

  if (spec.shape === 'drum') {
    const r = spec.radius;
    if (look.plinth) cylinder(group, r + PLINTH_MARGIN, r + PLINTH_MARGIN, PLINTH, ROUND_SIDES, [0, PLINTH / 2, 0], palette.plinth);
    cylinder(group, r, r, h, ROUND_SIDES, [0, PLINTH + h / 2, 0], spec.color).userData.toiletVolume = true;
    // A flat leaf sunk deep enough that its edges stay inside the drum's facets.
    const halfDoor = DRUM_DOOR_WIDTH / 2;
    const leaf = r + 0.04 - Math.sqrt(r * r - halfDoor * halfDoor) * Math.cos(Math.PI / ROUND_SIDES);
    box(group, [DRUM_DOOR_WIDTH, DRUM_DOOR_HEIGHT, leaf], [0, PLINTH + 0.02 + DRUM_DOOR_HEIGHT / 2, -r - 0.02 + leaf / 2], palette.door);
    if (look.roof) {
      const posts = [[0, 0.55 * r], [0.48 * r, -0.28 * r], [-0.48 * r, -0.28 * r]] as const;
      roofOver(group, look.roof, { kind: 'circle', x: 0, z: 0, radius: r }, top, look.overhang, roofLook(palette, [spec.color, spec.color]), posts);
    }
    return group;
  }

  const { width: w, depth: d } = spec;
  if (look.plinth) box(group, [w + 2 * PLINTH_MARGIN, PLINTH, d + 2 * PLINTH_MARGIN], [0, PLINTH / 2, 0], palette.plinth, [0, 0, 0], false, 'blocks');
  box(group, [w, h, d], [0, PLINTH + h / 2, 0], spec.color, [0, 0, 0], false, look.pattern).userData.toiletVolume = true;
  // The door: jambs and head proud of the face, the leaf between them less so.
  const half = ANNEX_DOOR_WIDTH / 2;
  const bottom = PLINTH + 0.02;
  const frameZ = -d / 2 - ANNEX_FRAME_DEPTH / 2;
  for (const side of [-1, 1]) {
    box(group, [ANNEX_FRAME, ANNEX_DOOR_HEIGHT, ANNEX_FRAME_DEPTH], [side * (half - ANNEX_FRAME / 2), bottom + ANNEX_DOOR_HEIGHT / 2, frameZ], palette.trim);
  }
  box(group, [2 * half - 2 * ANNEX_FRAME, ANNEX_FRAME, ANNEX_FRAME_DEPTH], [0, bottom + ANNEX_DOOR_HEIGHT - ANNEX_FRAME / 2, frameZ], palette.trim);
  box(group, [2 * half - 2 * ANNEX_FRAME, ANNEX_DOOR_HEIGHT - ANNEX_FRAME, 0.02], [0, bottom + (ANNEX_DOOR_HEIGHT - ANNEX_FRAME) / 2, -d / 2 - 0.01], palette.door);
  if (look.louvres) {
    const skipDoor = [[-half - 0.1, half + 0.1]] as const;
    louvres(group, 'x', -d / 2, -1, w, PLINTH, h, skipDoor, palette.accent, seed * 4);
    louvres(group, 'x', d / 2, 1, w, PLINTH, h, [], palette.accent, seed * 4 + 1);
    louvres(group, 'z', -w / 2, -1, d, PLINTH, h, [], palette.accent, seed * 4 + 2);
    louvres(group, 'z', w / 2, 1, d, PLINTH, h, [], palette.accent, seed * 4 + 3);
  }
  if (look.roof) {
    roofOver(group, look.roof, { kind: 'rect', x: 0, z: 0, width: w, depth: d }, top, look.overhang, roofLook(palette, [spec.color, spec.color]));
  }
  return group;
}

/** The largest |x| and |z| anything reaches: placement reads a footprint symmetric about the origin. */
export class Reach {
  x = 0;
  z = 0;

  point(x: number, z: number): void {
    this.x = Math.max(this.x, Math.abs(x));
    this.z = Math.max(this.z, Math.abs(z));
  }

  /** A rectangle of half sizes `hx`, `hz` about (`cx`, `cz`), turned `yaw` about Y as three.js turns it. */
  rect(cx: number, cz: number, hx: number, hz: number, yaw = 0): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const [lx, lz] of [[hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz]] as const) {
      this.point(cx + lx * c + lz * s, cz - lx * s + lz * c);
    }
  }

  circle(cx: number, cz: number, radius: number): void {
    this.point(Math.abs(cx) + radius, Math.abs(cz) + radius);
  }

  /** Twice the reach, rounded up to the centimetre so it never undercuts the measured extent. */
  footprint(): readonly [number, number] {
    return [Math.ceil(200 * this.x - 1e-6) / 100, Math.ceil(200 * this.z - 1e-6) / 100];
  }
}

/** Where an annex built by `annex` reaches. */
export function annexReach(reach: Reach, spec: ToiletAnnex, look: AnnexLook): void {
  const margin = look.plinth ? PLINTH_MARGIN : 0;
  if (spec.shape === 'drum') {
    let r = Math.max(spec.radius + margin, Math.hypot(DRUM_DOOR_WIDTH / 2, spec.radius + 0.02));
    if (look.roof) r = Math.max(r, roofHalf(look.roof, { kind: 'circle', x: 0, z: 0, radius: spec.radius }, look.overhang)[0]);
    reach.circle(spec.x, spec.z, r);
    return;
  }
  let hx = spec.width / 2 + margin;
  let hz = Math.max(spec.depth / 2 + margin, spec.depth / 2 + ANNEX_FRAME_DEPTH);
  if (look.louvres) {
    hx = Math.max(hx, spec.width / 2 + LOUVRE_REACH);
    hz = Math.max(hz, spec.depth / 2 + LOUVRE_REACH);
  }
  if (look.roof) {
    const [rx, rz] = roofHalf(look.roof, { kind: 'rect', x: 0, z: 0, width: spec.width, depth: spec.depth }, look.overhang);
    hx = Math.max(hx, rx);
    hz = Math.max(hz, rz);
  }
  reach.rect(spec.x, spec.z, hx, hz, spec.yaw);
}
