/**
 * Live mirrors for the kit car the player sits in, seen from the cabin view.
 *
 * A mirror shows the scene from the viewing eye reflected through the mirror's plane,
 * through an off-axis (generalised perspective) projection whose window is the mirror's
 * own rectangle and whose near plane lies on its glass: the true mirror image for any
 * seat. A cabin eye is fixed in the car and only turns, so this is no dearer than a
 * camera fixed to the mirror. The image lands on the mirror's live face (carkit/context.ts
 * `addMirrorFace`), which lies over the static glass and is hidden on every other car.
 *
 * Programs. The targets are ordinary render targets like the scene pass's `hazeTarget`,
 * and Three keys a program on "a render target" (working colour space, no tone mapping;
 * multisampling is not in the key), so every scene material draws into a mirror with the
 * program it already has. The face material is one more program, linked at boot through
 * `mirrorProgramAnchor`.
 *
 * Cost. One mirror per frame, in turn, so each refreshes at a third of the frame rate;
 * no shadow pass, no scene matrix walk and no post pass (`Renderer.renderMirror`); small
 * fixed targets, halved on the low rung and none on Very Low (`GraphicsTier.mirrorScale`).
 */

import * as THREE from 'three';
import type { KitMirror } from '../carkit/names';
import type { KitRig } from '../carkit/rig';
import type { Renderer } from '../core/renderer';
import { GRAPHICS_TIERS, type GraphicsQuality } from '../game/settings';

const MIRRORS: readonly KitMirror[] = ['inner', 'left', 'right'];

/** Target pixels at full scale, about each glass's aspect (19 x 4.4 cm, 10 x 7 cm). */
const PIXELS: Readonly<Record<KitMirror, readonly [number, number]>> = {
  inner: [320, 96],
  left: [160, 128],
  right: [160, 128],
};

/** The eye must stand this far in front of the glass; nearer, the projection degenerates. */
const MIN_EYE_DISTANCE = 0.02;

interface View {
  readonly target: THREE.WebGLRenderTarget;
  readonly material: THREE.MeshBasicMaterial;
}

/** One target and face material per mirror for the whole game: only one car shows them. */
const views: Partial<Record<KitMirror, View>> = {};

function view(mirror: KitMirror): View {
  let found = views[mirror];
  if (!found) {
    const [width, height] = PIXELS[mirror];
    const target = new THREE.WebGLRenderTarget(width, height);
    // As `hazeTarget`: sRGB storage keeps the dark end of the image from banding.
    target.texture.colorSpace = THREE.SRGBColorSpace;
    // `glass` in the name keeps the face out of carmodel.ts's paint-slot rule.
    const material = new THREE.MeshBasicMaterial({ name: `mirror_glass_${mirror}`, map: target.texture, toneMapped: false, fog: false });
    found = views[mirror] = { target, material };
  }
  return found;
}

/** The face material of `mirror`, shared by every kit car (carkit/context.ts `addMirrorFace`). */
export function mirrorFaceMaterial(mirror: KitMirror): THREE.MeshBasicMaterial {
  return view(mirror).material;
}

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

/**
 * Hidden faces in every mirror material, for the scene at boot: `waitForFrameShaders`
 * links the face program behind the loading cover. Kit cars load later, and the first
 * cabin view would otherwise link it on the spot. Like the real faces they cast and
 * receive nothing.
 */
export function mirrorProgramAnchor(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'mirror-anchor';
  group.visible = false;
  const geometry = mirrorFaceGeometry(new THREE.Matrix4(), [0.01, 0.01], 0);
  for (const mirror of MIRRORS) {
    const mesh = new THREE.Mesh(geometry, mirrorFaceMaterial(mirror));
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  return group;
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
const _eye = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/** Drives the live mirrors: which car shows them, and one mirror's render per frame. */
export class CarMirrors {
  /** Dev A/B (`__bro.mirrors.enabled`): false leaves every mirror static and runs no pass. */
  enabled = true;
  /** Mirror renders since boot (`__bro.mirrors.stats`). */
  readonly stats = { renders: 0 };
  /** Target size as a share of `PIXELS`; 0 keeps the static glass. */
  private scale = -1;
  /** The car whose faces are live, if any. */
  private shown: KitRig | null = null;
  private next = 0;
  private readonly camera = new THREE.PerspectiveCamera();

  constructor(private readonly renderer: Renderer, quality: GraphicsQuality) {
    this.setQuality(quality);
    renderer.setMirrorPass(this);
  }

  /** Whether a mirror pass runs this frame. */
  get active(): boolean {
    return this.shown !== null;
  }

  setQuality(quality: GraphicsQuality): void {
    const scale = GRAPHICS_TIERS[quality].mirrorScale;
    if (scale === this.scale) return;
    this.scale = scale;
    // A resized target is reallocated empty: its face waits for the next render.
    this.show(null);
    if (scale <= 0) return;
    for (const mirror of MIRRORS) {
      const [width, height] = PIXELS[mirror];
      view(mirror).target.setSize(Math.round(width * scale), Math.round(height * scale));
    }
  }

  /**
   * Once a frame, before the frame is drawn: `kit` is the rig of the car the player sits
   * in (any seat), `cabinView` whether the camera is the cabin view.
   */
  update(kit: KitRig | null, cabinView: boolean): void {
    this.show(this.enabled && this.scale > 0 && cabinView ? kit : null);
  }

  /** Renders the next mirror in turn; called by `Renderer.render` after the frame. */
  draw(): void {
    const kit = this.shown;
    if (!kit || kit.mirrorFaces.length === 0) return;
    const face = kit.mirrorFaces[this.next++ % kit.mirrorFaces.length]!;
    if (!this.aim(face)) {
      face.visible = false;
      return;
    }
    // Its own face lies on the near plane, and drawing it would sample the target being drawn.
    face.visible = false;
    this.renderer.renderMirror(view(face.userData.kitMirror as KitMirror).target, this.camera);
    // Shown only once drawn, so a face never shows an empty or another car's target.
    face.visible = true;
    this.stats.renders++;
  }

  private show(kit: KitRig | null): void {
    if (kit === this.shown) return;
    if (this.shown) for (const face of this.shown.mirrorFaces) face.visible = false;
    this.shown = kit;
    this.next = 0;
  }

  /**
   * Places the mirror camera for `face`: at the eye reflected through the glass, looking
   * out of it, its frustum's window the glass rectangle and its near plane on the glass
   * (so nothing behind the glass, the mirror's own housing and the screen, is drawn).
   * Matrices are this frame's: the frame was drawn just before. False when the eye is
   * not in front of the glass.
   */
  private aim(face: THREE.Mesh): boolean {
    const [a, b, c] = cornersOf(face.geometry);
    _a.copy(a).applyMatrix4(face.matrixWorld);
    _b.copy(b).applyMatrix4(face.matrixWorld);
    _c.copy(c).applyMatrix4(face.matrixWorld);
    _right.subVectors(_b, _a).normalize();
    _up.subVectors(_c, _a);
    // Out of the back of the glass, towards the reflected eye. Squared up: the body is
    // fitted to its passport size unevenly, which shears the quad a hair.
    _normal.crossVectors(_right, _up).normalize();
    _up.crossVectors(_normal, _right);
    _eye.setFromMatrixPosition(this.renderer.camera.matrixWorld);
    const distance = _normal.dot(_a) - _normal.dot(_eye);
    if (distance < MIN_EYE_DISTANCE) return false;
    _eye.addScaledVector(_normal, 2 * distance);

    const camera = this.camera;
    camera.position.copy(_eye);
    camera.quaternion.setFromRotationMatrix(_basis.makeBasis(_right, _up, _normal));
    camera.near = distance;
    camera.far = this.renderer.camera.far;
    _a.sub(_eye);
    _b.sub(_eye);
    _c.sub(_eye);
    camera.projectionMatrix.makePerspective(_right.dot(_a), _right.dot(_b), _up.dot(_c), _up.dot(_a), distance, camera.far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    return true;
  }
}
