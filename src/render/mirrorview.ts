/**
 * The geometry of a live mirror, shared by every mirror that draws one: the kit car's
 * (render/carmirrors.ts) and a toilet cabin's (world/toilets/mirror.ts).
 *
 * A mirror is a face quad whose UVs mark its corners. Its camera stands at the viewing
 * eye reflected through the glass, looks out of the back of it, and draws through an
 * off-axis (generalised perspective) projection whose window is the face's rectangle and
 * whose near plane lies on the glass: the true mirror image for any eye, and nothing
 * behind the glass (the mirror's own housing, the wall) is ever drawn.
 */

import * as THREE from 'three';

/** The eye must stand this far in front of the glass; nearer, the projection degenerates. */
const MIN_EYE_DISTANCE = 0.02;

/**
 * A live face: a quad `half` wide and high on the plane z = `z` of `frame` (a mirror
 * head's frame, its glass facing -Z), wound to face -Z. U runs along +X and V along +Y:
 * the mirror's camera looks out of the glass from behind it, so the right of its image
 * is the left of the one looking in, and the image needs no flip.
 */
export function mirrorFaceGeometry(frame: THREE.Matrix4, half: readonly [number, number], z: number): THREE.BufferGeometry {
  const [hx, hy] = half;
  const corners = [[-hx, -hy], [-hx, hy], [hx, hy], [-hx, -hy], [hx, hy], [hx, -hy]] as const;
  const position = new Float32Array(corners.length * 3);
  const normal = new Float32Array(corners.length * 3);
  const uv = new Float32Array(corners.length * 2);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3(0, 0, -1).transformDirection(frame);
  corners.forEach(([x, y], i) => {
    p.set(x, y, z).applyMatrix4(frame);
    position.set([p.x, p.y, p.z], i * 3);
    normal.set([n.x, n.y, n.z], i * 3);
    uv.set([(x + hx) / (2 * hx), (y + hy) / (2 * hy)], i * 2);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** A face's corners in its own frame: the image's bottom left, bottom right and top left. */
type Corners = readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3];
const cornerCache = new WeakMap<THREE.BufferGeometry, Corners>();

/** Read by UV, so a loader pass that reorders or un-indexes the quad cannot move them. */
function cornersOf(geometry: THREE.BufferGeometry): Corners {
  let corners = cornerCache.get(geometry);
  if (!corners) {
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const at = (u: number, v: number): THREE.Vector3 => {
      for (let i = 0; i < uv.count; i++) {
        if (uv.getX(i) === u && uv.getY(i) === v) return new THREE.Vector3().fromBufferAttribute(position, i);
      }
      throw new Error(`Mirror face has no corner at uv (${u}, ${v})`);
    };
    corners = [at(0, 0), at(1, 0), at(0, 1)];
    cornerCache.set(geometry, corners);
  }
  return corners;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _reflected = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/**
 * Places `camera` for the mirror `face` seen from `eye` (world space): at the eye
 * reflected through the glass, looking out of it, its frustum's window the glass
 * rectangle and its near plane on the glass, its far plane at `far`. The face's world
 * matrix must be current. False when the eye is not in front of the glass. The
 * projection follows the camera's depth convention, which a mirror on the reversed
 * buffer must have adopted before (render/depthconvention.ts `adoptReversedDepth`).
 */
export function aimMirrorCamera(camera: THREE.PerspectiveCamera, face: THREE.Mesh, eye: THREE.Vector3, far: number): boolean {
  const [a, b, c] = cornersOf(face.geometry);
  _a.copy(a).applyMatrix4(face.matrixWorld);
  _b.copy(b).applyMatrix4(face.matrixWorld);
  _c.copy(c).applyMatrix4(face.matrixWorld);
  _right.subVectors(_b, _a).normalize();
  _up.subVectors(_c, _a);
  // Out of the back of the glass, towards the reflected eye. Squared up: a car body is
  // fitted to its passport size unevenly, which shears the quad a hair.
  _normal.crossVectors(_right, _up).normalize();
  _up.crossVectors(_normal, _right);
  const distance = _normal.dot(_a) - _normal.dot(eye);
  if (distance < MIN_EYE_DISTANCE) return false;
  _reflected.copy(eye).addScaledVector(_normal, 2 * distance);

  camera.position.copy(_reflected);
  camera.quaternion.setFromRotationMatrix(_basis.makeBasis(_right, _up, _normal));
  camera.near = distance;
  camera.far = far;
  _a.sub(_reflected);
  _b.sub(_reflected);
  _c.sub(_reflected);
  camera.projectionMatrix.makePerspective(
    _right.dot(_a), _right.dot(_b), _up.dot(_c), _up.dot(_a), distance, far,
    camera.coordinateSystem, camera.reversedDepth,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return true;
}
