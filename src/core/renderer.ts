import * as THREE from 'three';
import type { GraphicsQuality } from '../game/settings';

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
 * Resolution cap per tier, as a devicePixelRatio multiplier.
 *
 * `acceptable` never supersamples: on an N100-class iGPU even a 1.5x buffer is
 * fill-rate the machine does not have. `standard` allows a mild 1.5x. `blessing`
 * renders at twice the device ratio and lets the driver downsample, which is real
 * supersampling — on a 4K panel that is a 4x pixel count over native, so it is
 * strictly for a machine with headroom to burn.
 */
const MAX_PIXEL_RATIO: Record<GraphicsQuality, number> = {
  acceptable: 1,
  standard: 1.5,
  blessing: 2,
};
/**
 * Multisampling on the scene target.
 *
 * This is the single most expensive thing in the frame on a weak iGPU: measured on
 * an Intel N100 / UHD Graphics at 1152x720, dropping the 4x resolve took the frame
 * from 22.9 ms to 17.2 ms — 25% of the whole frame for edge smoothing. 2x saved
 * almost nothing (21.8 ms), so the low tier turns it off outright rather than
 * paying most of the cost for half the benefit.
 *
 * `blessing` keeps 4x on top of supersampling. The two are not redundant: MSAA
 * smooths geometry edges, and downsampling a larger buffer is what fixes the ink
 * outlines and the stipple, which are per-PIXEL shader effects that multisampling
 * cannot see.
 */
const SCENE_SAMPLES: Record<GraphicsQuality, number> = {
  acceptable: 0,
  standard: 4,
  blessing: 4,
};
/**
 * Hard sanity bound on the adaptive scale, as a fraction of the cap. Not a quality
 * decision — the real floor is MIN_ABSOLUTE_PIXEL_RATIO below. This only stops a
 * runaway controller asking for a postage stamp.
 *
 * It used to be 0.6 and doubled as the quality floor, on the reasoning that the UI
 * had to stay readable. That reasoning was wrong: the HUD and menus are DOM and CSS
 * (see ui/hud.css), so the canvas resolution has no bearing on text legibility at
 * all — and the clamp was actively preventing the low tier from reaching a
 * resolution a weak iGPU can hold.
 */
const MIN_PIXEL_SCALE = 0.25;
/**
 * Adaptive floor in ABSOLUTE device pixels, per tier. This is the real quality
 * floor, and it has to be absolute rather than a fraction of the cap.
 *
 * The fraction alone produced the "sharp on my 4K at home, blurry on the 1080p at
 * work" report: a 4K panel reports DPR 2, so the cap is 1.5 and 60% of it is still
 * 0.9 device pixels — a downscale nobody notices. A 1080p panel reports DPR 1, so
 * the cap is 1.0 and the same 60% is 0.6 device pixels, on the screen that had none
 * to spare. Same setting, two very different images.
 *
 * The tiers want opposite things, which is the point of having them. Measured on an
 * Intel N100 / UHD Graphics in a 1920x935 window, parked, counting frames over
 * 50 ms out of 110:
 *
 *   pixel ratio   buffer      median   90th pct   slow frames
 *   1.00          1920x935    37.6 ms  147.2 ms   43
 *   0.60          1152x561    13.7 ms   67.7 ms   19
 *   0.30           576x280    13.5 ms   18.0 ms    0
 *
 * The median barely moves — that is vsync — while the 90th percentile collapses.
 * This is what the judder was: not slow frames, but one frame in five missing its
 * deadline. 0.35 is chosen to sit just above the point where every frame lands.
 *
 * `blessing` floors at 1.5, i.e. still above native on a DPR-1 screen. The point of
 * that tier is supersampling, so letting the controller quietly walk it down to
 * native would leave the setting doing nothing while claiming otherwise.
 */
const MIN_ABSOLUTE_PIXEL_RATIO: Record<GraphicsQuality, number> = {
  acceptable: 0.35,
  standard: 0.9,
  blessing: 1.5,
};
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
 * Heat-haze warp amplitude in pixels at a 1080p buffer; the shader normalises by
 * the real buffer height so the shimmer is the same size at every resolution.
 *
 * Small on purpose. Real shimmer displaces an edge by a pixel or two — it reads as
 * a boiling, unstable edge, not as bending. Anything larger turns the desert into
 * water.
 */
const HAZE_AMPLITUDE_PX = 1.7;
/**
 * Animation speed multiplier. Amplitude and vertical distribution are independent,
 * so this makes the air churn faster without making the image bend further or
 * spreading shimmer into the sky.
 *
 * 2.4 was too quick: real heat shimmer over asphalt is a slow boil you notice by
 * staring at it, not a current that flows. At 2.4 the whole band visibly streamed,
 * and the eye reads speed here as WIND rather than as heat — the wrong cue for
 * still desert air.
 */
const HAZE_SPEED = 1.1;

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

// ---------------------------------------------------------------------------
// Ink outlines: the second half of the drawn-landscape look, in the same pass.
// ---------------------------------------------------------------------------

/**
 * How dark an outline gets, 0 = off. The line is drawn by scaling the pixel's own
 * colour down rather than compositing black, so a line across sand stays sand.
 */
const INK_STRENGTH = 0.6;
/**
 * Relative luminance gradient that counts as an edge. Low enough to catch a dune
 * against the sky and the ground's own shading bands, high enough that the road's
 * aggregate texture and the stipple are not outlined dot by dot.
 */
const INK_THRESHOLD = 0.14;

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
  uniform float uInkStrength;
  uniform float uInkThreshold;

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

  /**
   * Rising refraction cells — no texture lookup.
   *
   * Cell SIZE is what separates shimmer from a wobbling lens. These are expressed
   * as fractions of frame height and are deliberately small: at 1080p the coarsest
   * is ~50 px and the finest ~18 px. The previous version ran a ~220 px primary
   * wave, which is why it read as rolling water rather than hot air.
   *
   * Phase is (uv.y - t * rise) * (TAU / cell), so a cell of constant phase travels
   * upward at exactly that rise, in frame-heights per second of shader time. Smaller
   * eddies churn faster, as they do in the real convective layer, and the three
   * scales beating against each other keep it from looking like a conveyor belt.
   * X-dependent phase shears the columns so they are plumes, not stripes.
   */
  vec2 hazeWarp(vec2 uv, float t) {
    const float TAU = 6.2831853;
    const float CELL_A = 0.048;
    const float CELL_B = 0.029;
    const float CELL_C = 0.017;
    const float RISE_A = 0.075;
    const float RISE_B = 0.115;
    const float RISE_C = 0.17;

    float pa = (uv.y - t * RISE_A) * (TAU / CELL_A);
    float pb = (uv.y - t * RISE_B) * (TAU / CELL_B);
    float pc = (uv.y - t * RISE_C) * (TAU / CELL_C);

    float shearA = uv.x * (TAU / 0.22);
    float shearB = uv.x * (TAU / 0.13);
    float shearC = uv.x * (TAU / 0.08);

    float y = sin(pa + shearA) * 0.6
            + sin(pb - shearB) * 0.28
            + sin(pc + shearC) * 0.12;
    float x = sin(pa - shearB) * 0.5
            + sin(pc + shearA) * 0.5;
    return vec2(x, y);
  }

  /**
   * Ink outline strength at a pixel, from the colour gradient around it.
   *
   * A Sobel on the already-shaded image, not on a depth buffer, and deliberately:
   * the ground's own shading is banded (render/comic.ts), so its band boundaries ARE
   * the strata edges a pen would draw, and a colour edge detector inks both those and
   * every silhouette in one pass. It also survives MSAA, which sampling a depth
   * texture alongside a multisampled colour target does not.
   *
   * Full RGB distance rather than luminance: a tan dune against a blue sky is a
   * enormous HUE step and barely a brightness one, so a luminance-only detector left
   * the one edge that matters most — the skyline — undrawn.
   *
   * Taps are a pixel and a half out, so the line lands on the edge itself rather than
   * on the antialiasing gradient beside it.
   */
  float inkEdge(vec2 uv, vec2 texel) {
    vec2 d = texel * 1.5;
    vec3 c  = texture2D(tDiffuse, uv).rgb;
    vec3 cx = texture2D(tDiffuse, uv + vec2(d.x, 0.0)).rgb;
    vec3 cX = texture2D(tDiffuse, uv - vec2(d.x, 0.0)).rgb;
    vec3 cy = texture2D(tDiffuse, uv + vec2(0.0, d.y)).rgb;
    vec3 cY = texture2D(tDiffuse, uv - vec2(0.0, d.y)).rgb;
    // Central differences rather than a full 3x3 kernel: four taps instead of
    // eight, and on a banded image the diagonals add nothing but cost.
    float grad = max(length(cx - cX), length(cy - cY));
    // Relative, not absolute: a step of 0.05 matters in the shaded side of a dune
    // and is invisible across bright sand, so it is measured against local
    // brightness.
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float rel = grad / max(0.18, lum);
    return smoothstep(uInkThreshold, uInkThreshold * 2.6, rel);
  }

  void main() {
    // Cells are smaller and churn faster close to the ground, and the long
    // sight-lines near the horizon stack more of them along one ray. Scaling with
    // depth stops the whole frame shimmering in lockstep like one sheet of glass.
    float groundness = clamp((uHorizon - vUv.y) / uGroundFalloff, 0.0, 1.0);
    float scale = mix(1.0, 1.3, groundness);
    vec2 warp = hazeWarp(vUv * scale, uTime * mix(1.0, 1.25, groundness));
    // Rising air bends a sight-line up and down far more than sideways; the
    // horizontal term only exists so columns do not look like a venetian blind.
    warp.x *= 0.25;
    // At uStrength = 0 the offset vanishes and the sample is the untouched
    // texel — a pure passthrough.
    vec2 offset = warp * uStrength * hotLayer(vUv.y) * (uAmplitude / uResolution.y);
    vec2 uv = clamp(vUv + offset, 0.0, 1.0);
    vec4 color = texture2D(tDiffuse, uv);

    // Ink is ground treatment. Rendering it only below the horizon leaves the sky
    // (including every star point) outside the outline pass by construction.
    if (uInkStrength > 0.0 && vUv.y <= uHorizon) {
      float ink = inkEdge(uv, 1.0 / uResolution) * uInkStrength;
      // The line is the surface's own colour driven down, not a black overlay:
      // black lines on sand read as dirt, dark-sand lines read as ink.
      color.rgb = mix(color.rgb, color.rgb * 0.34, ink);
    }

    gl_FragColor = color;
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


  /**
   * The tier's cap, resolved against this display once. `adaptResolution` scales
   * THIS, not the raw cap: basing it on the cap meant that on any display below
   * the cap (a DPR 1.25 monitor, say) the controller's own "reduced" ratios were
   * still larger than the native ratio the constructor had chosen, so the first
   * step down quietly asked the weakest machines to draw MORE pixels.
   */
  private basePixelRatio: number;
  private quality: GraphicsQuality;

  constructor(canvas: HTMLCanvasElement, quality: GraphicsQuality = 'standard') {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // NOT antialiased. Every scene pixel is drawn into `hazeTarget` (which does
      // its own multisampling per tier); the default framebuffer only ever
      // receives the fullscreen triangle, which has no interior edges to smooth.
      // A multisampled backbuffer here is an allocation and a resolve per frame
      // for an image that cannot differ by one pixel.
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.basePixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO[quality]);
    this.renderer.setPixelRatio(this.basePixelRatio);
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
    // pass warps and copies it back. `samples` is where this frame's edge
    // smoothing happens, since the canvas itself is no longer multisampled — and
    // it is the tier's most expensive single knob (see SCENE_SAMPLES).
    this.hazeTarget = new THREE.WebGLRenderTarget(1, 1, { samples: SCENE_SAMPLES[quality] });
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
        uInkStrength: { value: INK_STRENGTH },
        uInkThreshold: { value: INK_THRESHOLD },
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

    // The effective floor is whichever of the two is higher: a fraction of this
    // display's cap, or the absolute device-pixel floor. On a low-DPR screen the
    // absolute one wins, which is what stops 1080p being softened twice as far as
    // 4K for the same setting.
    const floor = Math.min(
      1,
      Math.max(MIN_PIXEL_SCALE, MIN_ABSOLUTE_PIXEL_RATIO[this.quality] / this.basePixelRatio),
    );
    const over = this.smoothedFrameMs > SLOW_FRAME_MS && this.pixelScale > floor;
    const under = this.smoothedFrameMs < FAST_FRAME_MS && this.pixelScale < 1;
    if (!over && !under) return;

    this.pixelScale = Math.min(
      1,
      Math.max(floor, this.pixelScale * (over ? SCALE_STEP_DOWN : SCALE_STEP_UP)),
    );
    this.lastScaleChange = now;
    // setPixelRatio re-sizes the drawing buffer around the current CSS size, so
    // the canvas layout never moves when the resolution changes.
    this.renderer.setPixelRatio(this.basePixelRatio * this.pixelScale);
    this.resizeHazeTarget();
  }

  /**
   * Switches rendering tier in place, from the pause menu, with no reload.
   *
   * Multisampling is baked into the render target's allocation, so the count is
   * written and the target disposed: Three reallocates it on the next bind. The
   * adaptive scale is reset to 1 because the new tier's cap is a different number
   * of pixels, and a scale carried over from the old one would start the
   * controller somewhere it never chose.
   */
  setQuality(quality: GraphicsQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.hazeTarget.samples = SCENE_SAMPLES[quality];
    this.hazeTarget.dispose();
    this.basePixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO[quality]);
    this.pixelScale = 1;
    this.lastScaleChange = -Infinity;
    this.smoothedFrameMs = 1000 / 60;
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.resizeHazeTarget();
  }
}
