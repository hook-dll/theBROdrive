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
 * and Three keys a program on "a render target" (working colour space, no tone mapping),
 * so every scene material draws into a mirror with the program it already has; so do the
 * stand-in cars, whose far-car program the far field links at boot. The face material is
 * one more program, linked at boot through
 * `mirrorProgramAnchor`.
 *
 * Brightness. A mirror holds linear radiance like the scene target, and its face is
 * unlit, so the face writes that radiance into the scene target unchanged and the post
 * pass maps it to the display with the rest of the frame: one exposure, one tone curve.
 *
 * Cost. Each mirror redraws `Settings.mirrorFrameRate` times a second, in turn, so the
 * renders spread over the frames instead of landing together (null: all, every frame);
 * no shadow pass, no scene matrix walk and no post pass (`Renderer.renderMirror`); small
 * fixed targets, halved on the low rung and none on Very Low (`GraphicsTier.mirrorScale`).
 *
 * Every car but the player's own is drawn in a mirror as its model's far mesh, an instance
 * in the scene's far-car batches (render/farcars.ts), which draw it with the far and mid
 * traffic in one draw per batch: a near kit car in full was some 60 draws of a mirror's
 * ~200 (measured on the M2 Pro, High traffic), in a picture a few centimetres across. A
 * car with a door, lid or pane off its stop keeps its own body, which the far mesh does
 * not show. The draw distance is the scene's: a mirror's nearer far plane cut its draws by
 * under five percent (the world's batches each span hundreds of metres) and would clip
 * the sky dome.
 */

import * as THREE from 'three';
import type { KitMirror } from '../carkit/names';
import type { KitRig } from '../carkit/rig';
import type { Renderer } from '../core/renderer';
import { GRAPHICS_TIERS, type GraphicsQuality, type MirrorFrameRate } from '../game/settings';
import type { Vehicle } from '../vehicle/vehicle';
import { FarCarField } from './farcars';
import { FAR_WORLD_LAYER, type FarRoad } from './farroad';
import { adoptReversedDepth } from './depthconvention';
import { aimMirrorCamera, mirrorFaceGeometry } from './mirrorview';

/** Visits every car a mirror may show: traffic and the player's own. */
export type MirrorCarSource = (visit: (id: string, vehicle: Vehicle) => void) => void;

const MIRRORS: readonly KitMirror[] = ['inner', 'left', 'right'];

/** Target pixels at full scale, about each glass's aspect (19 x 4.4 cm, 10 x 7 cm). */
const PIXELS: Readonly<Record<KitMirror, readonly [number, number]>> = {
  inner: [320, 96],
  left: [160, 128],
  right: [160, 128],
};

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
    // Linear radiance like the scene target, of its type (`CarMirrors.setQuality`).
    const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
    // `glass` in the name keeps the face out of carmodel.ts's paint-slot rule.
    // SCENE_RADIANCE: the map is radiance, not a screen colour (render/lightshader.ts).
    const material = new THREE.MeshBasicMaterial({ name: `mirror_glass_${mirror}`, map: target.texture, toneMapped: false, fog: false });
    material.defines = { SCENE_RADIANCE: '' };
    found = views[mirror] = { target, material };
  }
  return found;
}

/** The face material of `mirror`, shared by every kit car (carkit/context.ts `addMirrorFace`). */
export function mirrorFaceMaterial(mirror: KitMirror): THREE.MeshBasicMaterial {
  return view(mirror).material;
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

const _eye = new THREE.Vector3();

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
  /** Renders a second per mirror, null for all of them every frame; see `setRate`. */
  private rate: MirrorFrameRate = null;
  /** Mirror renders owed by the clock and not yet drawn, and when that was counted. */
  private owed = 0;
  private lastMs = -1;
  private readonly camera = new THREE.PerspectiveCamera();
  /** The cars drawn in the mirrors as their far mesh, in the far batches; shown only while a mirror draws. */
  private readonly standIns: FarCarField;
  /** Roots hidden for the mirror renders under way, put back after them. */
  private readonly hidden: THREE.Object3D[] = [];
  /** The far road the mirror shows instead of the near road chunks. */
  private farRoad: FarRoad | null = null;
  /** Scene objects tagged `mirrorSkip` (the road chunks), and their own visible flags. */
  private readonly skipped: THREE.Object3D[] = [];
  private readonly skippedWas: boolean[] = [];
  private skippedHidden = 0;

  constructor(
    private readonly renderer: Renderer,
    quality: GraphicsQuality,
    rate: MirrorFrameRate,
    private readonly cars: MirrorCarSource,
  ) {
    this.rate = rate;
    // Its off-axis projection is built by `aim`, so the camera takes the scene's depth
    // convention now, not at its first draw (render/depthconvention.ts).
    adoptReversedDepth(this.camera, renderer.reversedDepth);
    this.standIns = new FarCarField(renderer.scene);
    this.standIns.setVisible(false);
    // Road chunks are tagged `mirrorSkip` (roadmesh.ts) and hidden for the mirror pass;
    // scene events keep the list current as chunks stream in and out.
    renderer.scene.traverse(this.collectSkipped);
    renderer.scene.addEventListener('childadded', ({ child }) => child.traverse(this.collectSkipped));
    renderer.scene.addEventListener('childremoved', ({ child }) => this.forgetSkipped(child));
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
    // The scene target's texel type (core/renderer.ts `sceneTargetType`): half float, so
    // the sun and a following car's lamps keep their excess and roll off as in the main
    // view; eight-bit sRGB on a context that cannot render half floats.
    const type = this.renderer.sceneTextureType;
    for (const mirror of MIRRORS) {
      const [width, height] = PIXELS[mirror];
      const target = view(mirror).target;
      // Float depth on the reversed buffer, like the scene target: the far desert and its
      // mesas are in the mirrors too.
      if (this.renderer.reversedDepth && !target.depthTexture) {
        target.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
      }
      if (target.texture.type !== type) {
        target.dispose();
        target.texture.type = type;
        target.texture.colorSpace = type === THREE.UnsignedByteType ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      }
      target.setSize(Math.round(width * scale), Math.round(height * scale));
    }
  }

  /** `Settings.mirrorFrameRate`: each mirror's redraws a second, or null for every frame. */
  setRate(rate: MirrorFrameRate): void {
    this.rate = rate;
  }

  /** `Settings.cabinMirrors`: off hides the faces and runs no mirror pass. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** The far road the mirror draws while the near road chunks are hidden. */
  setFarRoad(farRoad: FarRoad | null): void {
    this.farRoad = farRoad;
  }

  /**
   * Once a frame, before the frame is drawn: `kit` is the rig of the car the player sits
   * in (any seat), `cabinView` whether the camera is the cabin view.
   */
  update(kit: KitRig | null, cabinView: boolean): void {
    this.show(this.enabled && this.scale > 0 && cabinView ? kit : null);
    // The far road is the mirror's only road; the main camera never sees its layer.
    this.farRoad?.setVisible(this.shown !== null);
  }

  /**
   * Renders the mirrors the clock has come round to; called by `Renderer.render` after
   * the frame. At most each mirror once a frame, so a long frame does not queue a burst;
   * up to one round more is carried to the next frame, so a rate at the frame rate is
   * not lost to frames a hair longer than the last.
   */
  draw(): void {
    const kit = this.shown;
    if (!kit || kit.mirrorFaces.length === 0) return;
    const count = kit.mirrorFaces.length;
    const now = performance.now();
    const seconds = this.lastMs < 0 ? 0 : (now - this.lastMs) / 1000;
    this.lastMs = now;
    this.owed = this.rate === null ? count : Math.min(this.owed + seconds * this.rate * count, 2 * count);
    let swapped = false;
    // The near road chunks are replaced by `FarRoad` for this pass only.
    this.hideSkipped();
    try {
      for (let drawn = 0; drawn < count && this.owed >= 1; drawn++, this.owed--) {
        const face = kit.mirrorFaces[this.next++ % count]!;
        if (!this.aim(face)) {
          face.visible = false;
          continue;
        }
        if (!swapped) {
          this.standInCars();
          swapped = true;
        }
        // Its own face lies on the near plane, and drawing it would sample the target being drawn.
        face.visible = false;
        this.renderer.renderMirror(view(face.userData.kitMirror as KitMirror).target, this.camera);
        // Shown only once drawn, so a face never shows an empty or another car's target.
        face.visible = true;
        this.stats.renders++;
      }
    } finally {
      this.restoreSkipped();
      if (swapped) this.restoreCars();
    }
  }

  /** Hides every car the mirrors draw as its far mesh and fills the stand-in field. */
  private standInCars(): void {
    this.standIns.begin();
    this.cars(this.standIn);
    this.standIns.end();
    this.standIns.setVisible(true);
  }

  /**
   * One car into the stand-in field. Not the car the mirrors belong to: its cabin and its
   * own boot are what the inner mirror shows. A car already hidden is drawn far, and the
   * far field is in the mirrors as it is.
   */
  private readonly standIn = (_id: string, vehicle: Vehicle): void => {
    const root = vehicle.root;
    if (vehicle.kit === this.shown || !root.visible || !vehicle.addStandIn(this.standIns)) return;
    root.visible = false;
    this.hidden.push(root);
  };

  private restoreCars(): void {
    for (const root of this.hidden) root.visible = true;
    this.hidden.length = 0;
    this.standIns.setVisible(false);
  }

  private readonly collectSkipped = (object: THREE.Object3D): void => {
    if (object.userData.mirrorSkip === true && !this.skipped.includes(object)) this.skipped.push(object);
  };

  /** Drops every skipped object in `root`, which has just been taken out of the scene. */
  private forgetSkipped(root: THREE.Object3D): void {
    for (let i = this.skipped.length - 1; i >= 0; i--) {
      let node: THREE.Object3D | null = this.skipped[i]!;
      while (node !== null && node !== root) node = node.parent;
      if (node === root) this.skipped.splice(i, 1);
    }
  }

  private hideSkipped(): void {
    for (let i = 0; i < this.skipped.length; i++) {
      const object = this.skipped[i]!;
      this.skippedWas[i] = object.visible;
      object.visible = false;
      this.skippedHidden = i + 1;
    }
  }

  private restoreSkipped(): void {
    for (let i = 0; i < this.skippedHidden; i++) this.skipped[i]!.visible = this.skippedWas[i]!;
    this.skippedHidden = 0;
  }

  private show(kit: KitRig | null): void {
    if (kit === this.shown) return;
    if (this.shown) for (const face of this.shown.mirrorFaces) face.visible = false;
    this.shown = kit;
    this.next = 0;
    // A car newly shown draws every mirror at once, so no face waits a slow rate's
    // interval for its first picture.
    this.owed = kit ? kit.mirrorFaces.length : 0;
    this.lastMs = -1;
  }

  /**
   * Places the mirror camera for `face` from this frame's eye (render/mirrorview.ts
   * `aimMirrorCamera`). Matrices are this frame's: the frame was drawn just before. False
   * when the eye is not in front of the glass.
   */
  private aim(face: THREE.Mesh): boolean {
    _eye.setFromMatrixPosition(this.renderer.camera.matrixWorld);
    const aimed = aimMirrorCamera(this.camera, face, _eye, this.renderer.camera.far);
    // The far road (and whatever far world follows it) is on its own layer.
    this.camera.layers.enable(FAR_WORLD_LAYER);
    return aimed;
  }
}
