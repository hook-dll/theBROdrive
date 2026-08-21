import * as THREE from 'three';

/**
 * Renderer, scene and camera ownership.
 *
 * The far plane and fog are set up for the far-orbit camera: zooming out to a few
 * hundred metres means the horizon must still resolve, so the far plane is 4 km and
 * fog is exponential rather than linear. Linear fog over that range either erases
 * the middle distance or leaves the horizon looking like a flat card.
 */

/** Far plane in metres. Must exceed the maximum camera distance by a wide margin. */
export const CAMERA_FAR = 4000;
export const CAMERA_NEAR = 0.08;

/**
 * Resolution cap, as a devicePixelRatio multiplier. A 4K laptop reports DPR 2,
 * but on an N100-class iGPU a 2x buffer is pure fill-rate waste; 1.5 keeps the
 * image crisp while `adaptResolution` does the real cost control below.
 */
const MAX_PIXEL_RATIO = 1.5;
/** Adaptive floor: never below 60% of the cap, so the UI stays readable. */
const MIN_PIXEL_SCALE = 0.6;
/** Resolution steps (applied at most once per CHANGE_COOLDOWN seconds). */
const SCALE_STEP_DOWN = 0.8;
const SCALE_STEP_UP = 1.05;
/**
 * Smoothed frame times that count as "over budget" / "comfortable" (ms). The
 * 6 ms deadband between them is the hysteresis that stops the controller from
 * hunting around the 60 fps target (~16.7 ms).
 */
const SLOW_FRAME_MS = 19;
const FAST_FRAME_MS = 13;
/** Minimum seconds between resolution changes. */
const CHANGE_COOLDOWN = 1.0;
/** Frame-time smoothing weight (EMA): ~160 ms time constant at 60 fps. */
const FRAME_SMOOTHING = 0.1;

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly fog: THREE.FogExp2;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.shadowMap.enabled = true;
    // PCFSoft's wider kernel costs extra texture taps for a blur that reads as
    // noise at this shadow resolution; plain PCF is visually near-identical and
    // materially cheaper on a low-end iGPU.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new THREE.PerspectiveCamera(
      68,
      window.innerWidth / window.innerHeight,
      CAMERA_NEAR,
      CAMERA_FAR,
    );

    // Density is retuned per frame from the sky gradient's haze value.
    this.fog = new THREE.FogExp2(0xd8c39a, 0.00035);
    this.scene.fog = this.fog;

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }

  private resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // --- Adaptive resolution ---

  /** Current multiplier on the capped base ratio (1 = cap, floor = MIN_PIXEL_SCALE). */
  private pixelScale = 1;
  /** EMA of frame time in ms. */
  private smoothedFrameMs = 1000 / 60;
  /** `performance.now()` at the last resolution change; -Infinity = never. */
  private lastScaleChange = -Infinity;

  /**
   * Called once per frame from the render loop. Smooths the frame time, then —
   * only when the smoothed time has been over/under budget and the cooldown has
   * elapsed — nudges the pixel ratio one step toward the floor or the cap. The
   * cooldown plus the deadband between thresholds means the controller settles
   * in a few steps and never visibly oscillates.
   */
  adaptResolution(frameDt: number): void {
    this.smoothedFrameMs += (frameDt * 1000 - this.smoothedFrameMs) * FRAME_SMOOTHING;
    const now = performance.now();
    if (now - this.lastScaleChange < CHANGE_COOLDOWN * 1000) return;

    const over = this.smoothedFrameMs > SLOW_FRAME_MS && this.pixelScale > MIN_PIXEL_SCALE;
    const under = this.smoothedFrameMs < FAST_FRAME_MS && this.pixelScale < 1;
    if (!over && !under) return;

    this.pixelScale = Math.min(
      1,
      Math.max(MIN_PIXEL_SCALE, this.pixelScale * (over ? SCALE_STEP_DOWN : SCALE_STEP_UP)),
    );
    this.lastScaleChange = now;
    // setPixelRatio re-sizes the drawing buffer around the current CSS size, so
    // the canvas layout never moves when the resolution changes.
    this.renderer.setPixelRatio(MAX_PIXEL_RATIO * this.pixelScale);
  }
}
