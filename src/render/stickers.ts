import * as THREE from 'three';
import type { StickerState } from '../game/state';
import { stickerDef, type StickerKind } from '../items/stickercatalog';
import { stickerAtlas } from './stickerart';

/**
 * The sticker you are trying on.
 *
 * Placed stickers are not meshes: they are printed into the car's paint shader
 * (materials.ts CAR_STICKERS), under its scratches and dust, so they age with the
 * panel. Only the placement PREVIEW is a quad — a translucent flat print of the chosen
 * design at its real size, riding the car's render group a few millimetres off the
 * surface, red when it does not fit.
 */

/**
 * Lift along the normal. Large enough to beat depth precision on a shell metres
 * from the camera, small enough that it never reads as floating.
 */
const LIFT = 0.004;
const STICKER_FORWARD = new THREE.Vector3(0, 0, 1);
const stickerNormal = new THREE.Vector3();

let _unitPlane: THREE.PlaneGeometry | null = null;

function setStickerMeshState(mesh: THREE.Mesh, sticker: StickerState): void {
  stickerNormal.set(sticker.nx, sticker.ny, sticker.nz);
  if (stickerNormal.lengthSq() < 1e-8) stickerNormal.set(0, 1, 0);
  stickerNormal.normalize();
  mesh.position.set(sticker.x, sticker.y, sticker.z).addScaledVector(stickerNormal, LIFT);
  mesh.quaternion.setFromUnitVectors(STICKER_FORWARD, stickerNormal);
  mesh.rotateZ(sticker.roll);
  const def = stickerDef(sticker.kind);
  mesh.scale.set(def.widthM, def.heightM, 1);
}

/** One reusable translucent print parented to the car while placement is active. */
export function createStickerPreviewMesh(): THREE.Mesh {
  _unitPlane ??= new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.8,
    premultipliedAlpha: true,
    roughness: 0.45,
    metalness: 0,
    // The quad sits a few millimetres off a panel that is metres from the camera;
    // without a depth bias it z-fights along the silhouette.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(_unitPlane, material);
  mesh.renderOrder = 3;
  mesh.name = 'sticker-preview';
  mesh.visible = false;
  mesh.userData.kind = null;
  return mesh;
}

export function updateStickerPreview(
  mesh: THREE.Mesh,
  sticker: StickerState | null,
  valid: boolean,
): void {
  mesh.visible = sticker !== null;
  if (!sticker) return;
  const material = mesh.material as THREE.MeshStandardMaterial;
  if (mesh.userData.kind !== sticker.kind) {
    // Its own view of the shared atlas: same image, this design's rectangle.
    const atlas = stickerAtlas();
    const rect = atlas.rects.get(sticker.kind as StickerKind)!;
    material.map?.dispose();
    const map = atlas.texture.clone();
    map.offset.set(rect[0], rect[1]);
    map.repeat.set(rect[2] - rect[0], rect[3] - rect[1]);
    map.needsUpdate = true;
    material.map = map;
    material.needsUpdate = true;
    mesh.userData.kind = sticker.kind;
  }
  setStickerMeshState(mesh, sticker);
  material.color.setHex(valid ? 0xffffff : 0xff4f46);
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _want = new THREE.Vector3();

/**
 * The roll that stands a print upright on a panel with car-local `normal`: its top
 * toward the sky on a door or a wing, toward the nose on the bonnet or the roof. The
 * placement starts here, so a sticker slapped on a door is not lying on its side.
 */
export function uprightStickerRoll(nx: number, ny: number, nz: number): number {
  stickerNormal.set(nx, ny, nz).normalize();
  _q.setFromUnitVectors(STICKER_FORWARD, stickerNormal);
  _up.set(0, 1, 0).applyQuaternion(_q);
  // Flat panels read from the driver's seat and the chase camera: top toward the nose.
  // The chassis frame's nose is -Z (checked on the bonnet: +Z read upside down).
  _want.set(0, 1, 0);
  if (Math.abs(stickerNormal.y) > 0.7) _want.set(0, 0, -1);
  _want.addScaledVector(stickerNormal, -_want.dot(stickerNormal)).normalize();
  const cross = _up.clone().cross(_want);
  return Math.atan2(cross.dot(stickerNormal), _up.dot(_want));
}
