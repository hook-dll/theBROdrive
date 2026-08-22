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
const HAZE_AMPLITUDE_PX = 3.4;
/**
 * Animation speed multiplier. Amplitude and vertical distribution are independent,
 * so this makes the air churn faster without making the image bend further or
 * spreading shimmer into the sky.
 */
const HAZE_SPEED = 2.4;

/**
 * How the shimmer is distributed, in screen heights measured from the horizon.
 *
 * Real heat haze lives in the shallow layer of hot air sitting on the ground, and
 * what you see at a given screen row is how far a sight-line travels *inside* that
 * layer. Just below the horizon a ray skims along it for hundreds of metres, so
 * that is where the shimmer is strongest; looking further down means looking at
 * ground closer to you through a shorter slice of hot air, so it weakens; and above
 * the horizon a ray climbs out of the layer almost immediately, so the sky is
 * nearly still. A fixed screen-space band — which is what this used to be — spreads
 * the effect evenly and reads as a wobbling lens instead of hot ground.
 */
const HAZE_SKY_FALLOFF = 0.055;
const HAZE_GROUND_FALLOFF = 0.3;
/**
 * The near foreground is seen through a thin slice of air (and is mostly the car's
 * own bonnet), so the bottom of the frame fades out rather than shimmering.
 */
const HAZE_FOREGROUND_FADE = 0.22;

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
  uniform float uHorizon;
  uniform float uSkyFalloff;
  uniform float uGroundFalloff;
  uniform float uForegroundFade;

  varying vec2 vUv;

  /**
   * Weight of the hot-air layer at a screen row: peaks at the horizon, decays
   * quickly upward into the sky and gently downward across the near ground. The
   * horizon comes in as a uniform, so the band follows the camera's pitch instead
   * of sitting in the middle of the frame whichever way the driver is looking.
   */
  float hotLayer(float y) {
    float d = y - uHorizon;
    float falloff = d > 0.0 ? uSkyFalloff : uGroundFalloff;
    return exp(-abs(d) / falloff) * smoothstep(0.0, uForegroundFade, y);
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
    // Cells of hot air are smaller and churn faster close to the ground, and the
    // long sight-lines near the horizon stack more of them on top of each other.
    // Scaling the warp's frequency and speed with that depth is what stops the
    // whole frame shimmering in lockstep like one sheet of glass.
    float groundness = clamp((uHorizon - vUv.y) / uGroundFalloff, 0.0, 1.0);
    float scale = mix(1.0, 1.7, groundness);
    vec2 warp = hazeWarp(vUv * scale, uTime * mix(1.0, 1.35, groundness));
    // Rising air bends a sight-line up and down far more than it does sideways, so
    // the vertical term carries the effect and the horizontal one only stops it
    // looking like a venetian blind.
    warp.x *= 0.45;
    // At uStrength = 0 the offset vanishes and the sample is the untouched
    // texel — a pure passthrough.
    vec2 offset = warp * uStrength * hotLayer(vUv.y) * (uAmplitude / uResolution.y);
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
  /** Reused scratch for the camera's forward vector (horizon tracking). */
  private readonly _forward = new THREE.Vector3();


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
        uHorizon: { value: 0.5 },
        uSkyFalloff: { value: HAZE_SKY_FALLOFF },
        uGroundFalloff: { value: HAZE_GROUND_FALLOFF },
        uForegroundFade: { value: HAZE_FOREGROUND_FADE },
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
    this.hazeMaterial.uniforms.uTime.value = performance.now() * 0.001 * HAZE_SPEED;
    this.hazeMaterial.uniforms.uHorizon.value = this.horizonScreenY();
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
   * Screen-space `uv.y` of the true horizon (0 = bottom of frame, 1 = top).
   *
   * A horizontal sight-line lands at NDC y = -tan(pitch) / tan(fovY / 2): look up
   * and the horizon slides down the frame, look down and it climbs. Reading it off
   * the camera's own forward vector rather than tracking pitch separately keeps it
   * correct through the camera rig's roll and spring, and clamping a little way
   * outside the frame keeps the falloff sensible when the horizon is off-screen.
   */
  private horizonScreenY(): number {
    this.camera.getWorldDirection(this._forward);
    const horizontal = Math.hypot(this._forward.x, this._forward.z);
    const pitch = Math.atan2(this._forward.y, horizontal);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const ndc = -Math.tan(pitch) / Math.tan(halfFov);
    return Math.min(1.6, Math.max(-0.6, 0.5 + 0.5 * ndc));
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
