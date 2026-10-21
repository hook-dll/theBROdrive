import * as THREE from 'three';
import { buildKitCar } from '../carkit/kit';
import { CAR_SURFACE_ATTRIBUTE } from '../render/materials';

/**
 * A die-cast model of a kit car for the title room (ui/roomscene.ts): the built car
 * flattened into one non-indexed triangle soup in room space, its paint in one colour,
 * at a scale. Plain typed arrays, so the build can run in ui/diecastworker.ts and the
 * arrays move to the main thread without a copy.
 *
 * Building a kit car is 100-300 ms on an M2 Pro and several times that on a mini-PC;
 * the room shows 28 of them, so on the main thread the title screen froze for a
 * fifth of a second every quarter second for its first seven seconds.
 */
export interface DieCastArrays {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly color: Float32Array;
}

export interface DieCastRequest {
  readonly modelId: string;
  /** The paint, sRGB hex. */
  readonly color: number;
  readonly scale: number;
}

export type DieCastResponse =
  | { readonly position: ArrayBuffer; readonly normal: ArrayBuffer; readonly color: ArrayBuffer }
  | { readonly error: string };

/** The glass: dark and glossy, so the cabin behind it never shows. */
const GLASS = [0.05, 0.07, 0.09] as const;

export function dieCastArrays({ modelId, color, scale }: DieCastRequest): DieCastArrays {
  const root = buildKitCar(modelId.replace(/^kit_/, ''));
  root.updateMatrixWorld(true);
  const paint = new THREE.Color(color);

  const sources: { geometry: THREE.BufferGeometry; world: THREE.Matrix4; owned: boolean }[] = [];
  let total = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    let geometry = mesh.geometry;
    let owned = false;
    if (!geometry.getAttribute('normal')) {
      // Flat normals need the triangles apart.
      geometry = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      geometry.computeVertexNormals();
      owned = true;
    }
    sources.push({ geometry, world: mesh.matrixWorld, owned });
    total += geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
  });

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  let o = 0;
  for (const { geometry, world, owned } of sources) {
    normalMatrix.getNormalMatrix(world);
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const built = geometry.getAttribute('color');
    const surface = geometry.getAttribute(CAR_SURFACE_ATTRIBUTE);
    const index = geometry.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i++, o += 3) {
      const v = index ? index.getX(i) : i;
      p.fromBufferAttribute(pos, v).applyMatrix4(world).multiplyScalar(scale);
      n.fromBufferAttribute(nor, v).applyMatrix3(normalMatrix).normalize();
      position[o] = p.x;
      position[o + 1] = p.y;
      position[o + 2] = p.z;
      normal[o] = n.x;
      normal[o + 1] = n.y;
      normal[o + 2] = n.z;
      if (!built) {
        colors[o] = GLASS[0];
        colors[o + 1] = GLASS[1];
        colors[o + 2] = GLASS[2];
      } else if (surface && surface.getX(v) > 0.5) {
        colors[o] = paint.r;
        colors[o + 1] = paint.g;
        colors[o + 2] = paint.b;
      } else {
        colors[o] = built.getX(v);
        colors[o + 1] = built.getY(v);
        colors[o + 2] = built.getZ(v);
      }
    }
    if (owned) geometry.dispose();
  }
  return { position, normal, color: colors };
}
