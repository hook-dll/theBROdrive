/**
 * A built kit car (kit.ts `buildKitCar`) as plain data, and back: render/kitbuild.ts builds
 * the car in a worker (render/kitbuildworker.ts) and sends it to the main thread in this
 * form, its vertex arrays moved rather than copied. Building a car is 45-85 ms in bun on
 * the M2 Pro (2026-10-28), and on the main thread every new traffic model was a frame of that.
 *
 * What comes back is the very scene the build made: every node with its name, kind,
 * transform (position, quaternion and rotation as they stood, matrix and world matrix),
 * flags and userData; every geometry with its attributes, index, groups, draw range,
 * userData and bounds; a geometry or attribute two meshes shared, shared again. A mesh's
 * material is one of the kit's (materials.ts `kitBodyMaterial`, `kitGlassMaterial`, or
 * the mirror face's, render/carmirrors.ts `mirrorFaceMaterial` for its `kitMirror`): the
 * main thread puts in its own instance of the same. Anything else in the scene throws on
 * the worker's side rather than arrive changed. userData goes by structured clone, so it
 * holds plain data only (numbers, strings, arrays, plain objects, Maps); none of the
 * builders puts more there.
 */

import * as THREE from 'three';
import { mirrorFaceMaterial } from '../render/carmirrors';
import { kitBodyMaterial, kitGlassMaterial } from './materials';
import type { KitMirror } from './names';

type WireArray = Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array;

/** The attribute classes a build makes, by name: a typed one (`Float32BufferAttribute`, ...) stays that class. */
const ATTRIBUTE_CLASSES = {
  BufferAttribute: THREE.BufferAttribute,
  Float32BufferAttribute: THREE.Float32BufferAttribute,
  Uint8BufferAttribute: THREE.Uint8BufferAttribute,
  Uint16BufferAttribute: THREE.Uint16BufferAttribute,
  Uint32BufferAttribute: THREE.Uint32BufferAttribute,
  Int8BufferAttribute: THREE.Int8BufferAttribute,
  Int16BufferAttribute: THREE.Int16BufferAttribute,
  Int32BufferAttribute: THREE.Int32BufferAttribute,
} as const;
type AttributeClass = keyof typeof ATTRIBUTE_CLASSES;

interface WireAttribute {
  readonly kind: AttributeClass;
  readonly array: WireArray;
  readonly itemSize: number;
  readonly normalized: boolean;
  readonly name: string;
  readonly usage: THREE.Usage;
  readonly gpuType: THREE.AttributeGPUType;
  readonly version: number;
}

interface WireGeometry {
  readonly name: string;
  /** Attribute name → index into `KitWire.attributes`, in the geometry's own order. */
  readonly attributes: readonly (readonly [string, number])[];
  /** Index into `KitWire.attributes`, or -1. */
  readonly index: number;
  readonly groups: readonly { start: number; count: number; materialIndex?: number }[];
  readonly drawRange: { start: number; count: number };
  readonly userData: Record<string, unknown>;
  /** min xyz, max xyz; or null. */
  readonly boundingBox: readonly number[] | null;
  /** centre xyz, radius; or null. */
  readonly boundingSphere: readonly number[] | null;
}

type WireMaterial = 'body' | 'glass' | 'mirror';

interface WireNode {
  readonly kind: 'group' | 'object' | 'mesh';
  readonly name: string;
  /** Index of the parent in `KitWire.nodes` (always earlier), -1 for the root. */
  readonly parent: number;
  readonly order: THREE.EulerOrder;
  readonly visible: boolean;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly frustumCulled: boolean;
  readonly matrixAutoUpdate: boolean;
  readonly matrixWorldAutoUpdate: boolean;
  readonly matrixWorldNeedsUpdate: boolean;
  readonly renderOrder: number;
  readonly layers: number;
  readonly userData: Record<string, unknown>;
  /** Meshes: index into `KitWire.geometries`, and the material. */
  readonly geometry?: number;
  readonly material?: WireMaterial;
}

/** Per node in `KitWire.transforms`: position 3, quaternion 4, rotation 3, scale 3, matrix 16, matrixWorld 16. */
const TRANSFORM = 45;

export interface KitWire {
  readonly nodes: readonly WireNode[];
  readonly transforms: Float64Array;
  readonly geometries: readonly WireGeometry[];
  readonly attributes: readonly WireAttribute[];
}

/** The car as data, and the buffers to transfer with it (each once). */
export function writeKitWire(root: THREE.Object3D): { wire: KitWire; transfer: ArrayBuffer[] } {
  const nodes: WireNode[] = [];
  const objects: THREE.Object3D[] = [];
  const geometries: WireGeometry[] = [];
  const geometryIds = new Map<THREE.BufferGeometry, number>();
  const attributes: WireAttribute[] = [];
  const attributeIds = new Map<THREE.BufferAttribute, number>();
  const buffers = new Set<ArrayBuffer>();

  const attributeOf = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number => {
    if (!(attribute instanceof THREE.BufferAttribute)) throw new Error(`Kit wire: attribute "${attribute.name}" is interleaved`);
    let id = attributeIds.get(attribute);
    if (id !== undefined) return id;
    const array = attribute.array as WireArray;
    if (!(array.buffer instanceof ArrayBuffer)) throw new Error(`Kit wire: attribute "${attribute.name}" is not in an ArrayBuffer`);
    buffers.add(array.buffer);
    id = attributes.length;
    const kind = (Object.keys(ATTRIBUTE_CLASSES) as AttributeClass[]).find((name) => attribute.constructor === ATTRIBUTE_CLASSES[name]);
    if (!kind) throw new Error(`Kit wire: attribute "${attribute.name}" is a ${attribute.constructor.name}`);
    attributes.push({
      kind,
      array,
      itemSize: attribute.itemSize,
      normalized: attribute.normalized,
      name: attribute.name,
      usage: attribute.usage,
      gpuType: attribute.gpuType,
      version: attribute.version,
    });
    attributeIds.set(attribute, id);
    return id;
  };

  const geometryOf = (geometry: THREE.BufferGeometry): number => {
    let id = geometryIds.get(geometry);
    if (id !== undefined) return id;
    if (Object.keys(geometry.morphAttributes).length > 0) throw new Error(`Kit wire: geometry "${geometry.name}" has morph attributes`);
    const box = geometry.boundingBox;
    const sphere = geometry.boundingSphere;
    id = geometries.length;
    geometries.push({
      name: geometry.name,
      attributes: Object.entries(geometry.attributes).map(([name, attribute]) => [name, attributeOf(attribute)] as const),
      index: geometry.index ? attributeOf(geometry.index) : -1,
      groups: geometry.groups.map((g) => ({ ...g })),
      drawRange: { ...geometry.drawRange },
      userData: geometry.userData,
      boundingBox: box ? [...box.min.toArray(), ...box.max.toArray()] : null,
      boundingSphere: sphere ? [...sphere.center.toArray(), sphere.radius] : null,
    });
    geometryIds.set(geometry, id);
    return id;
  };

  const materialOf = (mesh: THREE.Mesh): WireMaterial => {
    const material = mesh.material;
    if (material === kitBodyMaterial()) return 'body';
    if (material === kitGlassMaterial()) return 'glass';
    const mirror = mesh.userData.kitMirror as KitMirror | undefined;
    if (mirror !== undefined && material === mirrorFaceMaterial(mirror)) return 'mirror';
    throw new Error(`Kit wire: mesh "${mesh.name}" has a material that is not the kit's`);
  };

  root.traverse((node) => objects.push(node));
  const index = new Map(objects.map((node, i) => [node, i]));
  const transforms = new Float64Array(objects.length * TRANSFORM);
  objects.forEach((node, i) => {
    const mesh = node as THREE.Mesh;
    const kind = mesh.isMesh ? 'mesh' : (node as THREE.Group).isGroup ? 'group' : 'object';
    if (node.constructor !== (kind === 'mesh' ? THREE.Mesh : kind === 'group' ? THREE.Group : THREE.Object3D)) {
      throw new Error(`Kit wire: node "${node.name}" is a ${node.type}`);
    }
    const o = i * TRANSFORM;
    node.position.toArray(transforms, o);
    node.quaternion.toArray(transforms, o + 3);
    transforms[o + 7] = node.rotation.x;
    transforms[o + 8] = node.rotation.y;
    transforms[o + 9] = node.rotation.z;
    node.scale.toArray(transforms, o + 10);
    node.matrix.toArray(transforms, o + 13);
    node.matrixWorld.toArray(transforms, o + 29);
    nodes.push({
      kind,
      name: node.name,
      parent: i === 0 ? -1 : index.get(node.parent!)!,
      order: node.rotation.order,
      visible: node.visible,
      castShadow: node.castShadow,
      receiveShadow: node.receiveShadow,
      frustumCulled: node.frustumCulled,
      matrixAutoUpdate: node.matrixAutoUpdate,
      matrixWorldAutoUpdate: node.matrixWorldAutoUpdate,
      matrixWorldNeedsUpdate: node.matrixWorldNeedsUpdate,
      renderOrder: node.renderOrder,
      layers: node.layers.mask,
      userData: node.userData,
      ...(kind === 'mesh' ? { geometry: geometryOf(mesh.geometry), material: materialOf(mesh) } : {}),
    });
  });
  buffers.add(transforms.buffer);
  return { wire: { nodes, transforms, geometries, attributes }, transfer: [...buffers] };
}

const ignore = (): void => {};

/** The scene `writeKitWire` was given, rebuilt over the wire's arrays (not copied). */
export function readKitWire(wire: KitWire): THREE.Group {
  const attributes = wire.attributes.map((a) => {
    // A typed class copies the array it is given: made empty, then given the wire's.
    const attribute = a.kind === 'BufferAttribute'
      ? new THREE.BufferAttribute(a.array, a.itemSize, a.normalized)
      : new ATTRIBUTE_CLASSES[a.kind]([], a.itemSize, a.normalized);
    attribute.array = a.array;
    // `count` is a plain field in three, typed read-only: the count of the array just put in.
    const counted: { count: number } = attribute;
    counted.count = a.array.length / a.itemSize;
    attribute.name = a.name;
    attribute.usage = a.usage;
    attribute.gpuType = a.gpuType;
    attribute.version = a.version;
    return attribute;
  });
  const geometries = wire.geometries.map((g) => {
    const geometry = new THREE.BufferGeometry();
    geometry.name = g.name;
    for (const [name, id] of g.attributes) geometry.setAttribute(name, attributes[id]!);
    if (g.index >= 0) geometry.setIndex(attributes[g.index]!);
    for (const group of g.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    geometry.setDrawRange(g.drawRange.start, g.drawRange.count);
    geometry.userData = g.userData;
    if (g.boundingBox) geometry.boundingBox = new THREE.Box3().setFromArray(g.boundingBox);
    if (g.boundingSphere) {
      const [x, y, z, r] = g.boundingSphere as [number, number, number, number];
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y, z), r);
    }
    return geometry;
  });
  const t = wire.transforms;
  const objects: THREE.Object3D[] = [];
  wire.nodes.forEach((n, i) => {
    const node = n.kind === 'mesh'
      ? new THREE.Mesh(geometries[n.geometry!]!, n.material === 'body' ? kitBodyMaterial() : n.material === 'glass' ? kitGlassMaterial() : mirrorFaceMaterial(n.userData.kitMirror as KitMirror))
      : n.kind === 'group' ? new THREE.Group() : new THREE.Object3D();
    const o = i * TRANSFORM;
    node.name = n.name;
    node.position.fromArray(t, o);
    // Quaternion and rotation both as they stood: neither derived from the other.
    const quaternionChanged = node.quaternion._onChangeCallback;
    const rotationChanged = node.rotation._onChangeCallback;
    node.quaternion._onChangeCallback = ignore;
    node.rotation._onChangeCallback = ignore;
    node.quaternion.fromArray(t, o + 3);
    node.rotation.set(t[o + 7]!, t[o + 8]!, t[o + 9]!, n.order);
    node.quaternion._onChangeCallback = quaternionChanged;
    node.rotation._onChangeCallback = rotationChanged;
    node.scale.fromArray(t, o + 10);
    node.matrix.fromArray(t, o + 13);
    node.matrixWorld.fromArray(t, o + 29);
    node.visible = n.visible;
    node.castShadow = n.castShadow;
    node.receiveShadow = n.receiveShadow;
    node.frustumCulled = n.frustumCulled;
    node.matrixAutoUpdate = n.matrixAutoUpdate;
    node.matrixWorldAutoUpdate = n.matrixWorldAutoUpdate;
    node.renderOrder = n.renderOrder;
    node.layers.mask = n.layers;
    node.userData = n.userData;
    if (n.parent >= 0) objects[n.parent]!.add(node);
    // `add` leaves the flag as it was; set after, as the build left it.
    node.matrixWorldNeedsUpdate = n.matrixWorldNeedsUpdate;
    objects.push(node);
  });
  const root = objects[0];
  if (!(root instanceof THREE.Group)) throw new Error('Kit wire: the root is not a group');
  return root;
}
