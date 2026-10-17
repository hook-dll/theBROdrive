/**
 * The live mirror over a toilet's sink, after the kit car's (render/carmirrors.ts): the
 * scene from the viewing eye reflected through the glass, through an off-axis projection
 * whose window is the glass (render/mirrorview.ts). One camera and one small target for
 * every toilet: only the cabin the viewer stands at shows a live face; every other one
 * shows its static glass.
 *
 * Bounded. The camera's far plane is `MIRROR_FAR`, a cabin and its doorway, so it draws
 * only what a mirror in a two-metre room can show; its own face is hidden while it draws,
 * so it never reflects itself (no recursion). The caller's renderer keeps its shadow map
 * as it is: the mirror runs no shadow pass.
 *
 * Programs. Drawing into a render target keys every scene material on "a render target"
 * (linear, no tone mapping), as the game's scene pass already does; the face is one
 * basic material shared by every cabin.
 */

import * as THREE from 'three';
import { aimMirrorCamera } from '../../render/mirrorview';

/** Target pixels, about the glass's aspect (0.36 x 0.5 m). */
const MIRROR_PIXELS: readonly [number, number] = [128, 176];
/** How far the mirror sees, metres. */
export const MIRROR_FAR = 10;

let view: { readonly target: THREE.WebGLRenderTarget; readonly material: THREE.MeshBasicMaterial } | null = null;

function mirrorView(): NonNullable<typeof view> {
  if (!view) {
    const target = new THREE.WebGLRenderTarget(MIRROR_PIXELS[0], MIRROR_PIXELS[1], { type: THREE.HalfFloatType });
    const material = new THREE.MeshBasicMaterial({ name: 'toilet_mirror_glass', map: target.texture, fog: false });
    view = { target, material };
  }
  return view;
}

/** The face material every toilet mirror shares. */
export function toiletMirrorMaterial(): THREE.MeshBasicMaterial {
  return mirrorView().material;
}

const _eye = new THREE.Vector3();

/** Drives the one live toilet mirror. */
export class ToiletMirror {
  /** Mirror renders since it was made. */
  readonly stats = { renders: 0 };
  private readonly camera = new THREE.PerspectiveCamera();
  private shown: THREE.Mesh | null = null;

  /** The face that goes live, or null for none; the previous one goes back to static glass. */
  show(face: THREE.Mesh | null): void {
    if (face === this.shown) return;
    if (this.shown) this.shown.visible = false;
    this.shown = face;
  }

  get face(): THREE.Mesh | null {
    return this.shown;
  }

  /** The mirror's camera as it was last aimed (for checks). */
  get lens(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /**
   * Renders the shown face's picture from `eye`'s position, after the frame's matrices
   * are current. False, with the face hidden, when the eye is behind the glass.
   */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, eye: THREE.Camera): boolean {
    const face = this.shown;
    if (!face) return false;
    const { target } = mirrorView();
    face.updateWorldMatrix(true, false);
    eye.updateWorldMatrix(true, false);
    _eye.setFromMatrixPosition(eye.matrixWorld);
    if (!aimMirrorCamera(this.camera, face, _eye, MIRROR_FAR)) {
      face.visible = false;
      return false;
    }
    this.camera.updateMatrixWorld();
    face.visible = false;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(previous);
    // Shown only once drawn, so it never shows another cabin's picture.
    face.visible = true;
    this.stats.renders++;
    return true;
  }
}
