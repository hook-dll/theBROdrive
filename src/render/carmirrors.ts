/**
 * Live mirrors for the kit car the player sits in, seen from the cabin view.
 *
 * ONE REAR PASS FOR ALL THREE FACES. A single rear camera draws the world behind the
 * car once into one render target, and each face samples that image along the
 * direction its own glass reflects. The old path drew the whole scene three times, once
 * per mirror; this draws it once.
 *
 * THE SHARED VIEW IS THE UNION OF THE THREE GLASSES, NOT A WIDE REAR PANORAMA. The
 * camera's window is measured from the faces themselves: every reflected ray of every
 * glass corner is expressed in the inner glass's frame, and the camera covers their
 * yaw/pitch bounds plus a small margin. A 100-degree panorama spends most of its texels
 * on directions no mirror shows; the union is roughly 50-70 degrees across, so the same
 * pixels are several times denser where the glasses look.
 *
 * THE TARGET SIZE COMES FROM THE SCREEN, NOT FROM A CONSTANT. Each face's projected
 * bounding box on the display (device pixels) is compared with its own angular window;
 * the sharpest face sets a pixels-per-radian figure, and the shared target is that
 * figure times the union's window (times the tier's `mirrorScale`, with a cap). A 4K
 * display or a larger cabin view grows the target; a phone's half-scale tier shrinks
 * it. It is recomputed only when the car, the display or the tier changes, never per
 * frame.
 *
 * The approximation is parallax. A true mirror has its own viewpoint (the eye reflected
 * through its own glass), and the three glasses sit 0.8-1.4 m apart. The shared image
 * comes from one point behind the car, so a near object can sit a few degrees off
 * relative to the background in a face whose glass is not at that point. Far land, sky
 * and the horizon are effectively exact. The inner mirror is the most approximate: its
 * reflected rays pass through the cabin, while the shared camera stands behind the car,
 * so it shows the road behind rather than the rear seat and pillars. Side mirrors,
 * which are what a driver checks, keep the world behind and the following traffic.
 *
 * Sampling. For each face vertex the reflected direction is `d - 2 (d.n) n`, where `d`
 * is eye-to-glass and `n` the glass normal. That direction is projected into the shared
 * camera, and its image coordinates become the face's UVs. The face material is the
 * same unlit `MeshBasicMaterial` with `SCENE_RADIANCE`, so the face still writes linear
 * radiance into the scene target and the main post pass maps it to the display with one
 * exposure and one tone curve. No new program: the face material keeps its map and its
 * program key.
 *
 * Cost. One pass a frame, one target (sized as above; none on Very Low), no shadow pass,
 * no scene matrix walk and no post pass (`Renderer.renderMirror`).
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

/** Size before the first cabin frame measures the faces; replaced at once in `show`. */
const SHARED_FALLBACK_WIDTH = 1024;
const SHARED_FALLBACK_HEIGHT = 512;
const SHARED_MIN_WIDTH = 512;
const SHARED_MAX_WIDTH = 4096;
const SHARED_MIN_HEIGHT = 256;
const SHARED_MAX_HEIGHT = 2048;
/** The union window is never narrower than this, however small the glasses are on screen. */
const SHARED_MIN_H_FOV_DEG = 20;
const SHARED_MAX_H_FOV_DEG = 120;
const SHARED_MIN_V_FOV_DEG = 15;
const SHARED_MAX_V_FOV_DEG = 80;
/** Margin round the union, degrees and as a share of the span. */
const SHARED_MARGIN_DEG = 2;
const SHARED_MARGIN_SHARE = 0.06;
/** How far behind the glasses the shared camera stands, metres. */
const SHARED_BEHIND_M = 3;
/** Sharpness headroom over the face's own screen pixels, and the clamps on the density. */
const SHARED_DENSITY_HEADROOM = 1.12;
const SHARED_MIN_PX_PER_RAD = 256;
const SHARED_MAX_PX_PER_RAD = 6000;

interface View {
  readonly material: THREE.MeshBasicMaterial;
}

/** One shared image and one face material per mirror for the whole game. */
const sharedTarget = new THREE.WebGLRenderTarget(SHARED_FALLBACK_WIDTH, SHARED_FALLBACK_HEIGHT, { type: THREE.HalfFloatType });
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
const _rear = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _average = new THREE.Vector3();
const _look = new THREE.Vector3();
const _world = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _reflected = new THREE.Vector3();
const _projected = new THREE.Vector3();
const _view = new THREE.Vector3();

/** Drives the live mirrors: which car shows them, and one shared rear pass per frame. */
export class CarMirrors {
  /** Dev A/B (`__bro.mirrors.enabled`): false leaves every mirror static and runs no pass. */
  enabled = true;
  /** Shared mirror passes since boot (`__bro.mirrors.stats`). */
  readonly stats = { renders: 0 };
  /** Target size as a share of the measured union; 0 keeps the static glass. */
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

  /** The measured union's camera window, and the face-measured target size. */
  private sharedWidth = SHARED_FALLBACK_WIDTH;
  private sharedHeight = SHARED_FALLBACK_HEIGHT;
  private sharedAspect = SHARED_FALLBACK_WIDTH / SHARED_FALLBACK_HEIGHT;
  private sharedFovDeg = 60;
  private sharedCenterYaw = 0;
  private sharedCenterPitch = 0;
  /** Car, display, camera and tier the measurement above was made for. */
  private sharedKey = '';

  constructor(
    private readonly renderer: Renderer,
    quality: GraphicsQuality,
    rate: MirrorFrameRate,
    private readonly cars: MirrorCarSource,
  ) {
    this.rate = rate;
    this.sharedCamera = new THREE.PerspectiveCamera(this.sharedFovDeg, this.sharedAspect, 0.1, 1);
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
    this.sharedKey = '';
    if (scale <= 0) {
      sharedTarget.setSize(1, 1);
      return;
    }
    this.applySharedSize();
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
   * Measures the three glasses and places the one rear camera. The union window and the
   * target size are rebuilt only when the car, display, camera or tier changed; the
   * camera itself is re-aimed every pass from the live face matrices.
   */
  private aimShared(kit: KitRig): boolean {
    this.configureShared(kit);
    const faces = kit.mirrorFaces;
    const inner = faces.find((face) => face.userData.kitMirror === 'inner') ?? faces[0]!;
    _average.set(0, 0, 0);
    for (const face of faces) _average.add(_world.setFromMatrixPosition(face.matrixWorld));
    _average.multiplyScalar(1 / faces.length);
    // The inner glass faces the driver, so its outward normal is the car's rear. It is
    // car-relative, unlike the main camera's forward, which turns with the head.
    _rear.set(0, 0, -1).transformDirection(inner.matrixWorld).normalize();
    _right.set(1, 0, 0).transformDirection(inner.matrixWorld).normalize();
    _up.set(0, 1, 0).transformDirection(inner.matrixWorld).normalize();
    if (_rear.lengthSq() < 1e-6) return false;
    const cy = Math.cos(this.sharedCenterYaw);
    const sy = Math.sin(this.sharedCenterYaw);
    const cp = Math.cos(this.sharedCenterPitch);
    const sp = Math.sin(this.sharedCenterPitch);
    _view.copy(_rear).multiplyScalar(cy * cp)
      .addScaledVector(_right, sy * cp)
      .addScaledVector(_up, sp)
      .normalize();
    this.sharedCamera.position.copy(_average).addScaledVector(_rear, SHARED_BEHIND_M);
    this.sharedCamera.up.copy(_up);
    _look.copy(this.sharedCamera.position).add(_view);
    this.sharedCamera.lookAt(_look);
    this.sharedCamera.near = 0.1;
    this.sharedCamera.far = this.renderer.camera.far;
    this.sharedCamera.fov = this.sharedFovDeg;
    this.sharedCamera.aspect = this.sharedAspect;
    this.sharedCamera.updateProjectionMatrix();
    this.sharedCamera.updateMatrixWorld();
    return true;
  }

  /**
   * Rebuilds the shared window and target from the faces' reflected rays and their
   * projected screen size. Called from `aimShared`, so it runs after a cabin frame has
   * current matrices; a change resizes the target once, never per frame.
   */
  private configureShared(kit: KitRig): void {
    const viewport = this.renderer.viewport();
    const displayWidth = Math.max(1, viewport.deviceWidth);
    const displayHeight = Math.max(1, viewport.deviceHeight);
    const key = `${this.scale}|${displayWidth}x${displayHeight}|${kit.mirrorFaces.length}|${Math.round(this.renderer.camera.fov * 10)}`;
    if (key === this.sharedKey) return;
    const faces = kit.mirrorFaces;
    const inner = faces.find((face) => face.userData.kitMirror === 'inner') ?? faces[0];
    if (!inner) return;
    _rear.set(0, 0, -1).transformDirection(inner.matrixWorld).normalize();
    _right.set(1, 0, 0).transformDirection(inner.matrixWorld).normalize();
    _up.set(0, 1, 0).transformDirection(inner.matrixWorld).normalize();
    _eye.setFromMatrixPosition(this.renderer.camera.matrixWorld);
    const main = this.renderer.camera;
    let minYaw = Infinity;
    let maxYaw = -Infinity;
    let minPitch = Infinity;
    let maxPitch = -Infinity;
    let density = 0;

    for (const face of faces) {
      _normal.set(0, 0, -1).transformDirection(face.matrixWorld).normalize();
      const position = face.geometry.getAttribute('position');
      if (!position) continue;
      let fMinYaw = Infinity;
      let fMaxYaw = -Infinity;
      let fMinPitch = Infinity;
      let fMaxPitch = -Infinity;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < position.count; i++) {
        _world.fromBufferAttribute(position, i).applyMatrix4(face.matrixWorld);
        // The face's own pixels on the display: the density the mirror has to feed.
        _ndc.copy(_world).project(main);
        if (Number.isFinite(_ndc.x) && Number.isFinite(_ndc.y)) {
          const px = (_ndc.x * 0.5 + 0.5) * displayWidth;
          const py = (_ndc.y * 0.5 + 0.5) * displayHeight;
          if (px > -displayWidth && px < displayWidth * 2 && py > -displayHeight && py < displayHeight * 2) {
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
        _direction.subVectors(_world, _eye);
        _reflected.copy(_direction).addScaledVector(_normal, -2 * _direction.dot(_normal));
        const x = _reflected.dot(_right);
        const y = _reflected.dot(_up);
        const z = _reflected.dot(_rear);
        // A ray that leaves the glass forward is not a rear-view direction; it cannot
        // shape the union (a malformed face would otherwise open it to the whole sphere).
        if (z <= 0.05) continue;
        const yaw = Math.atan2(x, z);
        const pitch = Math.atan2(y, Math.hypot(x, z));
        if (yaw < fMinYaw) fMinYaw = yaw;
        if (yaw > fMaxYaw) fMaxYaw = yaw;
        if (pitch < fMinPitch) fMinPitch = pitch;
        if (pitch > fMaxPitch) fMaxPitch = pitch;
        if (yaw < minYaw) minYaw = yaw;
        if (yaw > maxYaw) maxYaw = yaw;
        if (pitch < minPitch) minPitch = pitch;
        if (pitch > maxPitch) maxPitch = pitch;
      }
      if (!Number.isFinite(fMinYaw) || !Number.isFinite(minX)) continue;
      const faceWidth = Math.max(1, maxX - minX);
      const faceHeight = Math.max(1, maxY - minY);
      const yawSpan = Math.max(1e-4, fMaxYaw - fMinYaw);
      const pitchSpan = Math.max(1e-4, fMaxPitch - fMinPitch);
      density = Math.max(density, faceWidth / yawSpan, faceHeight / pitchSpan);
    }

    let hFov: number;
    let vFov: number;
    let pxPerRad: number;
    if (Number.isFinite(minYaw) && Number.isFinite(minPitch) && density > 0) {
      const yawMargin = Math.max(THREE.MathUtils.degToRad(SHARED_MARGIN_DEG), (maxYaw - minYaw) * SHARED_MARGIN_SHARE);
      const pitchMargin = Math.max(THREE.MathUtils.degToRad(SHARED_MARGIN_DEG), (maxPitch - minPitch) * SHARED_MARGIN_SHARE);
      hFov = THREE.MathUtils.clamp(
        maxYaw - minYaw + 2 * yawMargin,
        THREE.MathUtils.degToRad(SHARED_MIN_H_FOV_DEG),
        THREE.MathUtils.degToRad(SHARED_MAX_H_FOV_DEG),
      );
      vFov = THREE.MathUtils.clamp(
        maxPitch - minPitch + 2 * pitchMargin,
        THREE.MathUtils.degToRad(SHARED_MIN_V_FOV_DEG),
        THREE.MathUtils.degToRad(SHARED_MAX_V_FOV_DEG),
      );
      this.sharedCenterYaw = (minYaw + maxYaw) / 2;
      this.sharedCenterPitch = (minPitch + maxPitch) / 2;
      pxPerRad = THREE.MathUtils.clamp(density, SHARED_MIN_PX_PER_RAD, SHARED_MAX_PX_PER_RAD)
        * Math.max(0.25, this.scale)
        * SHARED_DENSITY_HEADROOM;
    } else {
      // No usable face (a model still loading, a malformed glass): a conservative rear
      // window, sized from the display rather than a constant.
      hFov = THREE.MathUtils.degToRad(100);
      vFov = THREE.MathUtils.degToRad(60);
      this.sharedCenterYaw = 0;
      this.sharedCenterPitch = 0;
      pxPerRad = Math.max(256, displayHeight / vFov) * Math.max(0.25, this.scale);
    }
    const aspect = Math.tan(hFov / 2) / Math.tan(vFov / 2);
    let width = Math.round(pxPerRad * hFov);
    let height = Math.round(pxPerRad * vFov);
    width = THREE.MathUtils.clamp(width, SHARED_MIN_WIDTH, SHARED_MAX_WIDTH);
    height = THREE.MathUtils.clamp(height, SHARED_MIN_HEIGHT, SHARED_MAX_HEIGHT);
    // Keep the camera's own aspect: the vertical fov follows from the width and height,
    // so the union's horizontal span is covered exactly by construction.
    this.sharedWidth = width;
    this.sharedHeight = height;
    this.sharedAspect = width / height;
    this.sharedFovDeg = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hFov / 2) / this.sharedAspect));
    if (this.sharedFovDeg < THREE.MathUtils.radToDeg(vFov)) {
      // The height was clamped or rounded under the union's vertical span: widen the
      // vertical fov instead of cropping the top or bottom of a glass.
      this.sharedFovDeg = THREE.MathUtils.radToDeg(vFov);
    }
    this.sharedKey = key;
    this.applySharedSize();
  }

  /** Installs the measured target size and the scene's texel type; no-op if unchanged. */
  private applySharedSize(): void {
    if (this.scale <= 0) {
      sharedTarget.setSize(1, 1);
      return;
    }
    const type = this.renderer.sceneTextureType;
    if (this.renderer.reversedDepth && !sharedTarget.depthTexture) {
      sharedTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    }
    if (sharedTarget.texture.type !== type) {
      sharedTarget.dispose();
      sharedTarget.texture.type = type;
      sharedTarget.texture.colorSpace = type === THREE.UnsignedByteType ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    }
    sharedTarget.setSize(this.sharedWidth, this.sharedHeight);
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
        _world.fromBufferAttribute(position, i).applyMatrix4(face.matrixWorld);
        _direction.subVectors(_world, _eye);
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
    this.sharedKey = '';
    this.owed = kit ? 1 : 0;
    this.lastMs = -1;
  }
}
