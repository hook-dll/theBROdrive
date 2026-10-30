/**
 * Live mirrors for the kit car the player sits in, seen from the cabin view.
 *
 * ONE REAR PASS FOR ALL THREE FACES. A single wide rear camera draws the world behind
 * the car once into one render target, and each face samples that image along the
 * direction its own glass reflects. The old path drew the whole scene three times, once
 * per mirror; this draws it once.
 *
 * The approximation is parallax. A true mirror has its own viewpoint (the eye reflected
 * through its own glass), and the three glasses sit 0.8-1.4 m apart. The shared image
 * comes from one point, so a near object can sit a few degrees off relative to the
 * background in a face whose glass is not at that point (about 1 m at 10 m, 1 degree at
 * 50 m). Far land, sky and the horizon are effectively exact. The inner mirror is the
 * most approximate: its reflected rays pass through the cabin, while the shared camera
 * stands behind the car, so it shows the road behind rather than the rear seat and
 * pillars. Side mirrors, which are what a driver checks, keep the world behind and the
 * following traffic.
 *
 * Sampling. For each face vertex the reflected direction is `d - 2 (d.n) n`, where `d`
 * is eye-to-glass and `n` the glass normal. That direction is projected into the shared
 * camera, and its image coordinates become the face's UVs. The face material is the
 * same unlit `MeshBasicMaterial` with `SCENE_RADIANCE`, so the face still writes linear
 * radiance into the scene target and the main post pass maps it to the display with one
 * exposure and one tone curve. No new program: the face material keeps its map and its
 * program key.
 *
 * Cost. One pass a frame, one target (scaled by the tier's `mirrorScale`; none on Very
 * Low), no shadow pass, no scene matrix walk and no post pass (`Renderer.renderMirror`).
 * `Settings.mirrorFrameRate` now paces the shared pass: at 10/s all three faces update
 * ten times a second, where the old path paced each face separately.
 *
 * Every car but the player's own is drawn in the shared pass as its model's far mesh, an
 * instance in the scene's far-car batches (render/farcars.ts). A car with a door, lid or
 * pane off its stop keeps its own body, which the far mesh does not show.
 */

import * as THREE from 'three';
import type { KitMirror } from '../carkit/names';
import type { KitRig } from '../carkit/rig';
import type { Renderer } from '../core/renderer';
import { GRAPHICS_TIERS, type GraphicsQuality, type MirrorFrameRate } from '../game/settings';
import type { Vehicle } from '../vehicle/vehicle';
import { FarCarField } from './farcars';
import { adoptReversedDepth } from './depthconvention';
import { mirrorFaceGeometry } from './mirrorview';

/** Visits every car a mirror may show: traffic and the player's own. */
export type MirrorCarSource = (visit: (id: string, vehicle: Vehicle) => void) => void;

const MIRRORS: readonly KitMirror[] = ['inner', 'left', 'right'];

/**
 * The shared image at full scale. Wide enough to hold the directions all three glasses
 * reflect (about 120 degrees across) and tall enough for road, cars and a strip of sky.
 */
const SHARED_WIDTH = 1024;
const SHARED_HEIGHT = 384;
/** Vertical field of view; with the 8:3 aspect this is about 128 degrees across. */
const SHARED_FOV = 75;
/** How far behind the glasses the shared camera stands, metres. */
const SHARED_BEHIND_M = 3;

interface View {
  readonly material: THREE.MeshBasicMaterial;
}

/** One shared image and one face material per mirror for the whole game. */
const sharedTarget = new THREE.WebGLRenderTarget(SHARED_WIDTH, SHARED_HEIGHT, { type: THREE.HalfFloatType });
const views: Partial<Record<KitMirror, View>> = {};

function view(mirror: KitMirror): View {
  let found = views[mirror];
  if (!found) {
    // `glass` in the name keeps the face out of carmodel.ts's paint-slot rule.
    // SCENE_RADIANCE: the map is radiance, not a screen colour (render/lightshader.ts).
    const material = new THREE.MeshBasicMaterial({
      name: `mirror_glass_${mirror}`,
      map: sharedTarget.texture,
      toneMapped: false,
      fog: false,
    });
    material.defines = { SCENE_RADIANCE: '' };
    found = views[mirror] = { material };
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
const _normal = new THREE.Vector3();
const _up = new THREE.Vector3();
const _average = new THREE.Vector3();
const _look = new THREE.Vector3();
const _point = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _reflected = new THREE.Vector3();
const _projected = new THREE.Vector3();

/** Drives the live mirrors: which car shows them, and one shared rear pass per frame. */
export class CarMirrors {
  /** Dev A/B (`__bro.mirrors.enabled`): false leaves every mirror static and runs no pass. */
  enabled = true;
  /** Shared mirror passes since boot (`__bro.mirrors.stats`). */
  readonly stats = { renders: 0 };
  /** Target size as a share of `SHARED_WIDTH`/`SHARED_HEIGHT`; 0 keeps the static glass. */
  private scale = -1;
  /** The car whose faces are live, if any. */
  private shown: KitRig | null = null;
  /** Renders a second for the shared pass, null for every frame; see `setRate`. */
  private rate: MirrorFrameRate = null;
  /** Shared passes owed by the clock and not yet drawn, and when that was counted. */
  private owed = 0;
  private lastMs = -1;
  private readonly sharedCamera: THREE.PerspectiveCamera;
  /** The cars drawn in the mirrors as their far mesh, in the far batches; shown only while the pass draws. */
  private readonly standIns: FarCarField;
  /** Roots hidden for the mirror pass under way, put back after it. */
  private readonly hidden: THREE.Object3D[] = [];

  constructor(
    private readonly renderer: Renderer,
    quality: GraphicsQuality,
    rate: MirrorFrameRate,
    private readonly cars: MirrorCarSource,
  ) {
    this.rate = rate;
    this.sharedCamera = new THREE.PerspectiveCamera(SHARED_FOV, SHARED_WIDTH / SHARED_HEIGHT, 0.1, 1);
    // Its matrix is written by `aimShared`, so the camera takes the scene's depth
    // convention now, not at its first draw (render/depthconvention.ts).
    adoptReversedDepth(this.sharedCamera, renderer.reversedDepth);
    this.standIns = new FarCarField(renderer.scene);
    this.standIns.setVisible(false);
    this.setQuality(quality);
    renderer.setMirrorPass(this);
  }

  /** Whether the shared mirror pass runs this frame. */
  get active(): boolean {
    return this.shown !== null;
  }

  setQuality(quality: GraphicsQuality): void {
    const scale = GRAPHICS_TIERS[quality].mirrorScale;
    if (scale === this.scale) return;
    this.scale = scale;
    // A resized target is reallocated empty: its faces wait for the next pass.
    this.show(null);
    if (scale <= 0) {
      sharedTarget.setSize(1, 1);
      return;
    }
    // The scene target's texel type (core/renderer.ts `sceneTargetType`): half float, so
    // the sun and a following car's lamps keep their excess and roll off as in the main
    // view; eight-bit sRGB on a context that cannot render half floats.
    const type = this.renderer.sceneTextureType;
    if (this.renderer.reversedDepth && !sharedTarget.depthTexture) {
      sharedTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    }
    if (sharedTarget.texture.type !== type) {
      sharedTarget.dispose();
      sharedTarget.texture.type = type;
      sharedTarget.texture.colorSpace = type === THREE.UnsignedByteType ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    }
    sharedTarget.setSize(
      Math.max(1, Math.round(SHARED_WIDTH * scale)),
      Math.max(1, Math.round(SHARED_HEIGHT * scale)),
    );
  }

  /** `Settings.mirrorFrameRate`: shared passes a second, or null for every frame. */
  setRate(rate: MirrorFrameRate): void {
    this.rate = rate;
  }

  /**
   * Once a frame, before the frame is drawn: `kit` is the rig of the car the player sits
   * in (any seat), `cabinView` whether the camera is the cabin view.
   */
  update(kit: KitRig | null, cabinView: boolean): void {
    this.show(this.enabled && this.scale > 0 && cabinView ? kit : null);
  }

  /**
   * Draws the shared rear image when the clock has come round to it; called by
   * `Renderer.render` after the frame. One pass serves every face, so a long frame does
   * not queue a burst of per-face renders.
   */
  draw(): void {
    const kit = this.shown;
    if (!kit || kit.mirrorFaces.length === 0) return;
    const now = performance.now();
    const seconds = this.lastMs < 0 ? 0 : (now - this.lastMs) / 1000;
    this.lastMs = now;
    this.owed = this.rate === null ? 1 : Math.min(this.owed + seconds * this.rate, 2);
    if (this.owed < 1) return;
    this.owed -= 1;
    const faces = kit.mirrorFaces;
    if (!this.aimShared(kit)) {
      for (const face of faces) face.visible = false;
      return;
    }
    this.updateFaceUvs(kit);
    this.standInCars();
    try {
      // The faces lie on the near plane of the shared pass and would sample the image
      // being drawn; hidden for the pass, shown again for the next frame.
      for (const face of faces) face.visible = false;
      this.renderer.renderMirror(sharedTarget, this.sharedCamera);
      this.stats.renders++;
    } finally {
      for (const face of faces) face.visible = true;
      this.restoreCars();
    }
  }

  /**
   * Places the one rear camera behind the car, looking away from it. The inner glass's
   * normal gives the car's rear direction, so a turn of the player's head cannot swing
   * the shared view. Its position only decides what is hidden behind what (parallax);
   * the face UVs sample it as a panorama.
   */
  private aimShared(kit: KitRig): boolean {
    const faces = kit.mirrorFaces;
    const inner = faces.find((face) => face.userData.kitMirror === 'inner') ?? faces[0]!;
    _average.set(0, 0, 0);
    for (const face of faces) _average.add(_point.setFromMatrixPosition(face.matrixWorld));
    _average.multiplyScalar(1 / faces.length);
    // The inner glass faces the driver, so its outward normal is the car's rear. It is
    // car-relative, unlike the main camera's forward, which turns with the head.
    _normal.set(0, 0, -1).transformDirection(inner.matrixWorld).normalize();
    if (_normal.lengthSq() < 1e-6) return false;
    _up.set(0, 1, 0).transformDirection(inner.matrixWorld).normalize();
    if (Math.abs(_up.dot(_normal)) > 0.999) _up.set(0, 1, 0);
    this.sharedCamera.position.copy(_average).addScaledVector(_normal, SHARED_BEHIND_M);
    this.sharedCamera.up.copy(_up);
    _look.copy(this.sharedCamera.position).add(_normal);
    this.sharedCamera.lookAt(_look);
    this.sharedCamera.near = 0.1;
    this.sharedCamera.far = this.renderer.camera.far;
    this.sharedCamera.fov = SHARED_FOV;
    this.sharedCamera.aspect = SHARED_WIDTH / SHARED_HEIGHT;
    this.sharedCamera.updateProjectionMatrix();
    this.sharedCamera.updateMatrixWorld();
    return true;
  }

  /**
   * Rewrites each face's UVs to the shared image: for a glass vertex, the direction the
   * eye's ray leaves the glass, projected into the shared camera. Projective, so the
   * quad's four corners carry the image without a shader of its own.
   */
  private updateFaceUvs(kit: KitRig): void {
    _eye.setFromMatrixPosition(this.renderer.camera.matrixWorld);
    for (const face of kit.mirrorFaces) {
      const uv = face.geometry.getAttribute('uv');
      const position = face.geometry.getAttribute('position');
      if (!uv || !position) continue;
      _normal.set(0, 0, -1).transformDirection(face.matrixWorld).normalize();
      for (let i = 0; i < position.count; i++) {
        _point.fromBufferAttribute(position, i).applyMatrix4(face.matrixWorld);
        _direction.subVectors(_point, _eye);
        _reflected.copy(_direction).addScaledVector(_normal, -2 * _direction.dot(_normal));
        let u = 0.5;
        let v = 0.5;
        if (_reflected.lengthSq() > 1e-8) {
          _projected.copy(this.sharedCamera.position).addScaledVector(_reflected, 1000).project(this.sharedCamera);
          if (Number.isFinite(_projected.x) && Number.isFinite(_projected.y)) {
            u = THREE.MathUtils.clamp(_projected.x * 0.5 + 0.5, 0, 1);
            v = THREE.MathUtils.clamp(_projected.y * 0.5 + 0.5, 0, 1);
          }
        }
        uv.setXY(i, u, v);
      }
      uv.needsUpdate = true;
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

  private show(kit: KitRig | null): void {
    if (kit === this.shown) return;
    if (this.shown) for (const face of this.shown.mirrorFaces) face.visible = false;
    this.shown = kit;
    // A newly shown car waits for the first shared image rather than showing an empty
    // or another car's target.
    if (kit) for (const face of kit.mirrorFaces) face.visible = false;
    this.owed = kit ? 1 : 0;
    this.lastMs = -1;
  }
}
