/**
 * CONTACT SHADOWS: a soft dark disc on the sand under every prop, so a cactus or a
 * boulder stands ON the ground instead of hovering over it. The terrain does not
 * receive a shadow map far out and the shadow map's own contact is a few texels, so
 * without this the eye has nothing that says where an object meets the desert.
 *
 * One instanced draw per batch of props, sharing one geometry and one material: a
 * disc, bowed down towards its rim, whose vertex alpha falls from the centre to nothing at the rim, drawn
 * without depth writes and pulled towards the camera so it sits on the sand it lies
 * on. It is not a light, so it does not move with the sun; it is the ground-contact
 * darkening every photograph of a desert shows under anything standing on it.
 */

import * as THREE from 'three';

/** Disc radius: the prop's footprint times this, plus a fixed reach past its foot. */
export const CONTACT_SHADOW_SPREAD = 1.5;
export const CONTACT_SHADOW_REACH = 0.3;
/** Extra disc radius per metre of the prop's height: a tall thing shades more ground. */
export const CONTACT_SHADOW_PER_HEIGHT = 0.12;
/** Smallest disc, metres: a thin dead stick still marks the sand. */
export const CONTACT_SHADOW_MIN_RADIUS = 0.55;
/**
 * THE DISC IS A SHALLOW BOWL, UPSIDE DOWN, AND IT IS NOT LIFTED.
 *
 * A flat disc lifted over the ground so it would not sink into a slope — 6% of its
 * radius, 18 cm under a large boulder — hovered: at a grazing view its far edge stood
 * visibly above the sand behind the prop, reported from play as a dark ring drawn a
 * little over the ground. So the centre sits ON the ground (a couple of centimetres
 * and the polygon offset win the depth test against the terrain mesh) and the disc
 * falls away towards its rim by `RIM_DROP_PER_RADIUS`. On a slope or a hump the part
 * that meets the terrain goes UNDER it and is hidden, and it is the faded outer rings
 * that do: the shade can fade into the ground, it can never float over it.
 */
const CENTRE_LIFT_M = 0.02;
const RIM_DROP_PER_RADIUS = 0.14;
/** Darkness at the centre, 0..1. */
const CORE_ALPHA = 0.34;

const RINGS: readonly (readonly [number, number])[] = [
  [0, CORE_ALPHA],
  [0.45, CORE_ALPHA * 0.75],
  [0.75, CORE_ALPHA * 0.3],
  [1, 0],
];
const SEGMENTS = 14;

let geometry: THREE.BufferGeometry | null = null;

function contactShadowGeometry(): THREE.BufferGeometry {
  if (geometry) return geometry;
  const count = 1 + (RINGS.length - 1) * SEGMENTS;
  const positions = new Float32Array(count * 3);
  // White RGB: the material's colour is the shade, the vertex alpha its falloff.
  const colours = new Float32Array(count * 4).fill(1);
  // Centre, then each ring outward.
  colours[3] = RINGS[0]![1];
  for (let r = 1; r < RINGS.length; r++) {
    const [radius, alpha] = RINGS[r]!;
    for (let k = 0; k < SEGMENTS; k++) {
      const i = 1 + (r - 1) * SEGMENTS + k;
      const a = (k / SEGMENTS) * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * radius;
      positions[i * 3 + 1] = -RIM_DROP_PER_RADIUS * radius * radius;
      positions[i * 3 + 2] = Math.sin(a) * radius;
      colours[i * 4 + 3] = alpha;
    }
  }
  const index: number[] = [];
  for (let k = 0; k < SEGMENTS; k++) {
    const next = (k + 1) % SEGMENTS;
    index.push(0, 1 + next, 1 + k);
  }
  for (let r = 1; r < RINGS.length - 1; r++) {
    const inner = 1 + (r - 1) * SEGMENTS;
    const outer = inner + SEGMENTS;
    for (let k = 0; k < SEGMENTS; k++) {
      const next = (k + 1) % SEGMENTS;
      index.push(inner + k, inner + next, outer + k, inner + next, outer + next, outer + k);
    }
  }
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Shared by every batch; never disposed. A warm dark, not black: sand bounces light. */
const material = new THREE.MeshBasicMaterial({
  color: 0x2a1a0e,
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -4,
});

const dummy = new THREE.Object3D();

/** Ground-level disc under one prop, in whatever frame the batch lives in. */
export interface ContactShadowSpot {
  x: number;
  /** The GROUND height under the prop, not the prop's sunk origin. */
  groundY: number;
  z: number;
  /** Footprint radius of the prop, metres (before CONTACT_SHADOW_SPREAD). */
  radius: number;
  /** Height of the prop, metres. */
  height: number;
}

/** Writes one disc's matrix into `out`, scaled by `fade` (0 hides it). */
export function contactShadowMatrix(spot: ContactShadowSpot, fade: number, out: THREE.Matrix4): THREE.Matrix4 {
  const r = Math.max(
    CONTACT_SHADOW_MIN_RADIUS,
    spot.radius * CONTACT_SHADOW_SPREAD + CONTACT_SHADOW_REACH + spot.height * CONTACT_SHADOW_PER_HEIGHT,
  );
  dummy.position.set(spot.x, spot.groundY + CENTRE_LIFT_M, spot.z);
  dummy.rotation.set(0, 0, 0);
  // The bowl's depth scales with it, so the drop stays a share of the radius.
  dummy.scale.set(r * fade, r * Math.max(fade, 1e-3), r * fade);
  dummy.updateMatrix();
  return out.copy(dummy.matrix);
}

/** One instanced batch of discs, full size. Null for an empty batch. */
export function buildContactShadows(spots: readonly ContactShadowSpot[]): THREE.InstancedMesh | null {
  if (spots.length === 0) return null;
  const mesh = new THREE.InstancedMesh(contactShadowGeometry(), material, spots.length);
  const m = new THREE.Matrix4();
  for (let i = 0; i < spots.length; i++) mesh.setMatrixAt(i, contactShadowMatrix(spots[i]!, 1, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  // Drawn after the opaque ground it lies on, and never shadowing anything itself.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  return mesh;
}
