import * as THREE from 'three';

/**
 * REVERSED-Z DEPTH, AND WHAT THREE r187 LEAVES TO THE GAME.
 *
 * The scene pass draws with a reversed depth buffer wherever the context has
 * EXT_clip_control (core/renderer.ts asks for `reversedDepthBuffer`; three falls back to
 * the ordinary buffer without it, and none of this is installed then). Near is 1 and far
 * is 0, and the scene target's depth is 32-bit float, so a step of depth is about
 * distance x 2^-23 at any range: a tenth of a millimetre at 2 km and under a millimetre
 * at 18 km, where the old 24-bit buffer stepped by metres (2-19 m at 2-5 km, 30-96 m at
 * 10-18 km on the far tiers). Coplanar-ish surfaces far away (a mesa's foot in the
 * vista's ground) stopped fighting.
 *
 * Three handles the projection, the clear value, the shadow cameras, its own depth
 * chunks and, since r187, the three things the game used to patch here: the direction-
 * less depth functions (`AlwaysDepth` stays `AlwaysDepth`), the sort (it turns the
 * distance term round instead of reversing the sorted list, so `renderOrder` holds:
 * mrdoob/three.js#33945) and both polygon-offset terms (#34606). Patched on top of r187
 * they flipped twice: the clouds' depth reset drew NEVER and the sky dome sorted last,
 * and the frame was the clouds' pale sheet over a world that failed its depth test.
 * Two things are still the game's:
 *
 *  - CAMERAS. Three moves a camera onto the reversed projection when the camera is
 *    first DRAWN, after the frame was culled and sorted with its old matrix, and with an
 *    `updateProjectionMatrix` that would overwrite a mirror's off-axis projection. Every
 *    camera handed to `render` is moved before (`adoptReversedDepth`); a camera that sets
 *    its own matrix (render/mirrorview.ts) is adopted before it is aimed.
 *  - SHADER CHUNKS the game writes or three missed: the PCF far-plane test and the
 *    sun's slope offset (render/lightshader.ts), the haze pass's depth read
 *    (render/hazeshader.ts), the clouds' own depth row and far-plane reset
 *    (render/clouds.ts), the stars and planets at the far plane. Each reads
 *    `USE_REVERSED_DEPTH_BUFFER`, which three defines in every program while the buffer
 *    is reversed: page-lifetime, so no program variant ever appears mid-drive.
 */

/**
 * Puts `camera` on the reversed (or ordinary) depth convention now, rather than at its
 * first draw. Three keeps the flag in a private field behind its getter
 * (`Camera.reversedDepth`), the one its own renderer and shadow map set.
 */
export function adoptReversedDepth(camera: THREE.Camera, reversed: boolean): void {
  if (camera.reversedDepth === reversed) return;
  // Three keeps the flag in a private field behind its getter.
  const flagged = camera as unknown as { _reversedDepth: boolean };
  flagged._reversedDepth = reversed;
  if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) {
    camera.updateProjectionMatrix();
  }
}

/**
 * Installs the game's side of reversed depth on `renderer`; see the file comment. Call
 * once, right after construction, and only when `renderer.capabilities.reversedDepthBuffer`.
 */
export function installReversedDepth(renderer: THREE.WebGLRenderer): void {
  // Three before r187 sorted, swapped depth functions and offset polygons the old way,
  // which this file no longer corrects: a checkout run on a stale `node_modules` (pulled,
  // not reinstalled) drew a pale sheet with only the glass in it. Said here, not drawn.
  if (Number(THREE.REVISION) < 187) {
    throw new Error(`three r${THREE.REVISION} is installed; the game needs r187 (run npm install)`);
  }
  const render = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    adoptReversedDepth(camera, true);
    render(scene, camera);
  };
}
