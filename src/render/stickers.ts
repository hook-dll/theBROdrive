import * as THREE from 'three';

/**
 * Sticker placement helpers.
 *
 * Stickers are not meshes: placed ones and the one being tried on are both printed
 * into the car's paint and glass shaders (materials.ts CAR_STICKERS), under scratches
 * and dust, trimmed to the parts that can carry them. What is left here is the
 * orientation a new sticker starts in.
 */

const STICKER_FORWARD = new THREE.Vector3(0, 0, 1);
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _want = new THREE.Vector3();
const _cross = new THREE.Vector3();

/**
 * The roll that stands a print upright on a panel with car-local `normal`: its top
 * toward the sky on a door or a wing, toward the nose on the bonnet or the roof. The
 * player's turn is added to this, so a sticker slapped on a door is not lying on its
 * side and stays upright as it is slid from panel to panel.
 */
export function uprightStickerRoll(nx: number, ny: number, nz: number): number {
  _n.set(nx, ny, nz).normalize();
  _q.setFromUnitVectors(STICKER_FORWARD, _n);
  _up.set(0, 1, 0).applyQuaternion(_q);
  // Flat panels read from the driver's seat and the chase camera: top toward the nose.
  // The chassis frame's nose is -Z (checked on the bonnet: +Z read upside down).
  _want.set(0, 1, 0);
  if (Math.abs(_n.y) > 0.7) _want.set(0, 0, -1);
  _want.addScaledVector(_n, -_want.dot(_n)).normalize();
  _cross.copy(_up).cross(_want);
  return Math.atan2(_cross.dot(_n), _up.dot(_want));
}
