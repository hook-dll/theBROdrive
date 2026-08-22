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
 * Resting vertical field of view, degrees, for every camera mode — on foot and in
 * the car alike. 65 matches The Long Drive, and it matters more than it sounds: FOV
 * sets the apparent scale of the whole world, so a couple of degrees changes how big
 * the car feels and how fast the road appears to move.
 *
 * `Cameras` owns the speed-scaled widening on top of this; this is the value every
 * mode settles back to, and it lives here so the initial camera and the camera rig
 * cannot drift apart the way a duplicated literal did.
 */
export const CAMERA_BASE_FOV = 65;

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
// ---------------------------------------------------------------------------
// Heat haze: a two-pass post effect (see Renderer.render).
// ---------------------------------------------------------------------------

/**
 * Heat-haze warp amplitude in pixels. The fragment shader normalises it by the
 * real buffer height, so the shimmer is the same size at every resolution: at a
 * 1080p buffer the peak offset is exactly this many pixels.
 */
const HAZE_AMPLITUDE_PX = 3;

/** Fullscreen triangle: three clip-space vertices, one corner padded to cover
 *  the whole frame. `uv` carries the screen UV (0 = bottom, 1 = top). */
const HAZE_VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const HAZE_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uStrength;
  uniform float uAmplitude;

  varying vec2 vUv;

  // Peaks across the horizon band and fades to nothing at the very bottom (the
  // bonnet) and the top of the sky, so only the shimmer-prone middle wobbles.
  float horizonWindow(float y) {
    return smoothstep(0.0, 0.35, y) * (1.0 - smoothstep(0.65, 1.0, y));
  }

  // Cheap animated 2D warp from summed sines — no texture lookups. Each axis
  // sums three terms and divides by their maximum magnitude, so the result
  // stays within roughly [-1, 1].
  vec2 hazeWarp(vec2 uv, float t) {
    float x = sin(uv.y * 23.0 + t * 1.3)
            + sin(uv.y * 11.0 - t * 0.7) * 0.6
            + sin(uv.x * 17.0 + t * 0.9) * 0.4;
    float y = cos(uv.x * 19.0 + t * 1.1)
            + cos(uv.y * 13.0 + t * 0.8) * 0.6
            + cos(uv.x * 7.0  - t * 0.6) * 0.4;
    return vec2(x, y) * 0.5;
  }

  void main() {
    vec2 warp = hazeWarp(vUv, uTime);
    // At uStrength = 0 the offset vanishes and the sample is the untouched
    // texel — a pure passthrough.
    vec2 offset = warp * uStrength * horizonWindow(vUv.y) * (uAmplitude / uResolution.y);
    vec2 uv = clamp(vUv + offset, 0.0, 1.0);
    gl_FragColor = texture2D(tDiffuse, uv);
  }
`;


export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly fog: THREE.FogExp2;
  // --- Heat-haze post pass ---
  /** Scene-pass target; the fullscreen pass samples this texture. */
  private readonly hazeTarget: THREE.WebGLRenderTarget;
  /** Tiny scene holding the fullscreen triangle. */
  private readonly hazeScene = new THREE.Scene();
  /** Dummy camera for the fullscreen pass; the vertex shader ignores its matrices. */
  private readonly hazeCamera: THREE.OrthographicCamera;
  private readonly hazeMaterial: THREE.ShaderMaterial;
  private readonly hazeGeometry: THREE.BufferGeometry;
  /** Reused scratch vector for the drawing-buffer size. */
  private readonly _drawSize = new THREE.Vector2();


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
      CAMERA_BASE_FOV,
      window.innerWidth / window.innerHeight,
      CAMERA_NEAR,
      CAMERA_FAR,
    );

    // Density is retuned per frame from the sky gradient's haze value.
    this.fog = new THREE.FogExp2(0xd8c39a, 0.00035);
    this.scene.fog = this.fog;

    // The scene first renders into this target (sRGB, so it holds the exact
    // display-ready pixels the canvas would have received), then a fullscreen
    // pass warps and copies it back. `samples` preserves the canvas MSAA that
    // moving off the default framebuffer would otherwise throw away.
    this.hazeTarget = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });
    this.hazeTarget.texture.colorSpace = THREE.SRGBColorSpace;

    this.hazeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.hazeMaterial = new THREE.ShaderMaterial({
      vertexShader: HAZE_VERTEX,
      fragmentShader: HAZE_FRAGMENT,
      // No tone mapping, no colour conversion: pass 1 already produced final
      // sRGB pixels, so this pass only warps UVs and copies texels through.
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.hazeTarget.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uAmplitude: { value: HAZE_AMPLITUDE_PX },
      },
    });
    this.hazeGeometry = new THREE.BufferGeometry();
    this.hazeGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
    );
    this.hazeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const hazeMesh = new THREE.Mesh(this.hazeGeometry, this.hazeMaterial);
    hazeMesh.frustumCulled = false; // clip-space triangle spans far outside the frustum
    this.hazeScene.add(hazeMesh);


    this.resize();
    window.addEventListener('resize', this.resize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.hazeTarget.dispose();
    this.hazeMaterial.dispose();
    this.hazeGeometry.dispose();
    this.renderer.dispose();
  }


  private resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.resizeHazeTarget();

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  render(): void {
    this.hazeMaterial.uniforms.uTime.value = performance.now() * 0.001;
    // Pass 1: draw the scene into the target — the same final sRGB pixels the
    // canvas would have received, since tone mapping and colour conversion stay
    // untouched on the renderer.
    this.renderer.setRenderTarget(this.hazeTarget);
    this.renderer.render(this.scene, this.camera);
    // Pass 2: copy the target back to the canvas through the haze shader.
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.hazeScene, this.hazeCamera);
  }

  /**
   * Heat-haze strength, clamped to 0..1. At zero the fullscreen pass is a pure
   * passthrough, so the image matches a direct render exactly.
   */
  setHazeStrength(strength: number): void {
    this.hazeMaterial.uniforms.uStrength.value = Math.min(1, Math.max(0, strength));
  }

  /**
   * Size the scene-pass target to the actual drawing buffer (CSS size × pixel
   * ratio). Called from both the resize handler and the adaptive-resolution
   * controller — the only two places the buffer size can change.
   */
  private resizeHazeTarget(): void {
    this.renderer.getDrawingBufferSize(this._drawSize);
    this.hazeTarget.setSize(this._drawSize.x, this._drawSize.y);
    this.hazeMaterial.uniforms.uResolution.value.set(this._drawSize.x, this._drawSize.y);
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
    this.resizeHazeTarget();

  }
}
