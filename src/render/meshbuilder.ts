/**
 * The primitive kit every part and carried item is drawn with (render/partmesh.ts, the
 * boy's things in render/thingmesh.ts): cached geometry, material specs resolved per
 * instance onto the shared flat and condition materials, and instructions replayed
 * into a fresh group per instance.
 */
import * as THREE from 'three';
import { makeConditionMaterial, makeFlatMaterial } from './materials';

// ---------------------------------------------------------------------------
// Geometry cache
// ---------------------------------------------------------------------------

const geometryCache = new Map<string, THREE.BufferGeometry>();

/** The geometry cached under `key`, built once: one key is one shape, whatever its size. */
export function cachedGeo(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geometry = geometryCache.get(key);
  if (geometry === undefined) {
    geometry = build();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

/** Releases every cached BufferGeometry. */
export function clearGeometryCache(): void {
  for (const geometry of geometryCache.values()) geometry.dispose();
  geometryCache.clear();
}

// ---------------------------------------------------------------------------
// Material specs (resolved lazily per instance)
// ---------------------------------------------------------------------------

export type MaterialSpec =
  | { kind: 'cond'; color: number; metalness: number; roughness: number }
  | { kind: 'flat'; color: number; roughness: number }
  | { kind: 'glass'; color: number; roughness: number };

export const cond = (color: number, metalness = 0.85, roughness = 0.4): MaterialSpec => ({
  kind: 'cond', color, metalness, roughness,
});
export const flat = (color: number, roughness = 0.6): MaterialSpec => ({ kind: 'flat', color, roughness });
export const glass = (color: number, roughness = 0.06): MaterialSpec => ({ kind: 'glass', color, roughness });

function resolveMaterial(spec: MaterialSpec): THREE.Material {
  switch (spec.kind) {
    case 'cond':
      return makeConditionMaterial(spec.color, spec.metalness, spec.roughness);
    case 'flat':
      return makeFlatMaterial(spec.color, spec.roughness);
    case 'glass': {
      // High transmission, low opacity: the tint must read as clean glass, never
      // a dark slab. DoubleSide means both faces of a thin box contribute, so the
      // per-face opacity is kept low to leave the road clearly visible.
      const material = makeFlatMaterial(spec.color, spec.roughness);
      material.transparent = true;
      material.opacity = 0.12;
      material.side = THREE.DoubleSide;
      material.depthWrite = false;
      return material;
    }
  }
}

// ---------------------------------------------------------------------------
// Instructions: geometry + material + transform, replayed per instance
// ---------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];

export interface Instruction {
  readonly name: string;
  readonly geometry: THREE.BufferGeometry;
  readonly material: MaterialSpec;
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

export const ZERO: Vec3 = [0, 0, 0];
export const ONE: Vec3 = [1, 1, 1];
// Cylinders are built along +Y; these Euler angles re-point that axis.
export const AXIS_X: Vec3 = [0, 0, -Math.PI / 2]; // +Y -> +X
export const AXIS_Z: Vec3 = [Math.PI / 2, 0, 0]; // +Y -> +Z

export class MeshBuilder {
  readonly instructions: Instruction[] = [];

  push(
    key: string,
    build: () => THREE.BufferGeometry,
    material: MaterialSpec,
    position: Vec3,
    rotation: Vec3 = ZERO,
    scale: Vec3 = ONE,
  ): void {
    this.instructions.push({ name: key, geometry: cachedGeo(key, build), material, position, rotation, scale });
  }

  box(key: string, w: number, h: number, d: number, material: MaterialSpec, position: Vec3, rotation: Vec3 = ZERO, scale: Vec3 = ONE): void {
    this.push(key, () => new THREE.BoxGeometry(w, h, d), material, position, rotation, scale);
  }

  cylinder(
    key: string,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    radialSegments: number,
    material: MaterialSpec,
    position: Vec3,
    rotation: Vec3 = ZERO,
    scale: Vec3 = ONE,
    openEnded = false,
  ): void {
    this.push(
      key,
      () => new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1, openEnded),
      material,
      position,
      rotation,
      scale,
    );
  }

  torus(key: string, radius: number, tube: number, radialSegments: number, tubularSegments: number, material: MaterialSpec, position: Vec3, rotation: Vec3 = ZERO, scale: Vec3 = ONE, arc = Math.PI * 2): void {
    this.push(key, () => new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments, arc), material, position, rotation, scale);
  }

  sphere(key: string, radius: number, widthSegments: number, heightSegments: number, material: MaterialSpec, position: Vec3, scale: Vec3 = ONE): void {
    this.push(key, () => new THREE.SphereGeometry(radius, widthSegments, heightSegments), material, position, ZERO, scale);
  }
}

export function buildGroup(instructions: readonly Instruction[]): THREE.Group {
  const group = new THREE.Group();
  for (const ins of instructions) {
    const mesh = new THREE.Mesh(ins.geometry, resolveMaterial(ins.material));
    mesh.name = ins.name;
    mesh.position.set(ins.position[0], ins.position[1], ins.position[2]);
    mesh.rotation.set(ins.rotation[0], ins.rotation[1], ins.rotation[2]);
    mesh.scale.set(ins.scale[0], ins.scale[1], ins.scale[2]);
    if (ins.material.kind === 'glass') {
      // Glass must never be shadowed into a black slab.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
    group.add(mesh);
  }
  return group;
}

/** Bounding box of a set of instructions, honouring their transforms. */
export function boundsOf(instructions: readonly Instruction[]): THREE.Box3 {
  const total = new THREE.Box3();
  const tmp = new THREE.Box3();
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const matrix = new THREE.Matrix4();

  for (const ins of instructions) {
    if (ins.geometry.boundingBox === null) ins.geometry.computeBoundingBox();
    tmp.copy(ins.geometry.boundingBox as THREE.Box3);
    pos.set(ins.position[0], ins.position[1], ins.position[2]);
    euler.set(ins.rotation[0], ins.rotation[1], ins.rotation[2]);
    quat.setFromEuler(euler);
    scl.set(ins.scale[0], ins.scale[1], ins.scale[2]);
    matrix.compose(pos, quat, scl);
    tmp.applyMatrix4(matrix);
    total.union(tmp);
  }
  return total;
}

/** Bounding-box half-extents of a set of instructions, honouring their transforms. */
export function halfExtentsOf(instructions: readonly Instruction[]): { x: number; y: number; z: number } {
  const size = boundsOf(instructions).getSize(new THREE.Vector3());
  return { x: size.x / 2, y: size.y / 2, z: size.z / 2 };
}
