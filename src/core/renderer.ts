import * as THREE from 'three';
import { compileSafely } from '../render/compilesafe';
import '../render/lightshader';
import { primeMaxAnisotropy } from '../render/texturequality';
import {
  advanceHazePhase,
  createHeatMirageUniforms,
  DEFAULT_EYE_HEIGHT_M,
  DEFAULT_HEAT_MIRAGE,
  HAZE_CLOCK_PERIOD_S,
  HAZE_FRAGMENT,
  HAZE_VERTEX,
  writeHeatMirageUniforms,
  type HeatHazeFrame,
  type HeatMirageParameters,
} from '../render/hazeshader';
import { AdaptiveResolutionController } from './adaptivequality';
import {
  DEFAULT_FIELD_OF_VIEW,
  DEFAULT_INK_STRENGTH,
  GRAPHICS_TIERS,
  RENDER_SCALES,
  shadowsFor,
  type GraphicsQuality,
  type RenderScale,
  type RenderScaleFraction,
} from '../game/settings';
import type { ShadeTint } from '../items/items';

/**
 * Renderer, scene and camera ownership.
 *
 * The far plane and fog are set up for the desert vista: the horizon runs to a few
 * kilometres and must still resolve, so the far plane is 4 km and fog is exponential
 * rather than linear. Linear fog over that range either erases the middle distance
 * or leaves the horizon looking like a flat card.
 */

/**
 * Far-plane floor in metres. The sky dome (DOME_RADIUS = 3000 in render/sky.ts)
 * needs at least this much reach, so `setViewDistance` never drops below it: the
 * drawn horizon may shrink, but the dome must keep resolving.
 */
export const CAMERA_FAR = 4000;
/**
 * Near-plane floor in metres. The hood camera sits a hand's width off the bonnet,
 * so this must clear the panel it is mounted on without slicing into it.
 * `setViewDistance` only ever raises this, never lowers it.
 */
export const CAMERA_NEAR = 0.08;
/** Exterior-camera near plane for a configured far plane. */
export function nearPlaneForFarPlane(far: number): number {
  return Math.max(CAMERA_NEAR, far / MAX_DEPTH_RATIO);
}

/**
 * Standoff margin, metres: the far plane is measured from the CAMERA, not from the
 * car, so it has to clear the draw distance by at least the chase arm's reach
 * (DIST_MAX in render/cameras.ts) or the camera clips the far edge of the desert it
 * can still see past the car. Rounded well clear of that 7 m arm.
 */
const CAMERA_STANDOFF_MARGIN = 32;

/** Far plane shared by the camera and the vista that closes its ground horizon. */
export function farPlaneForViewDistance(metres: number): number {
  return Math.max(CAMERA_FAR, metres + CAMERA_STANDOFF_MARGIN);
}

/**
 * Ceiling on the far/near ratio. A perspective camera spends its depth
 * precision on a 1/z budget and the near plane fixes how much of that budget
 * the near region (the car's own panels) receives, so when the far plane
 * stretches out for `vast` the near plane must rise with it or the panels lose
 * the depth resolution they had at the default 4 km far plane. 160000 is the
 * ratio, held well under the ~200000:1 point beyond which a 16-bit depth
 * buffer starts to z-fight on the panels, rather than sitting on that bound.
 */
const MAX_DEPTH_RATIO = 160000;

/**
 * A DISPLAY can never ask for more pixels than the rung allows, and that is the whole
 * of this file's resolution policy now.
 *
 * It used to be a display PERCENTAGE: `min(DPR x multiplier, DPR cap)`. On a screen whose
 * device-pixel-ratio is 1 — every 4K television, every monitor at 100% scaling — that
 * resolves to exactly 1.0 at every rung, so a mini-PC on a television and a workstation
 * on the same television were both asked to shade 8.29 megapixels. Measured across the
 * machines this game runs on, `standard` was the same load on an Intel N100 as on an RTX
 * 4090, and the only rung beneath it was a 5.8x cliff with nothing in between.
 *
 * An absolute ceiling per rung fixes that at the root: below the ceiling the display's
 * own sharpness still decides what to render, and above it a supersampling multiplier
 * lets the top rung spend headroom it is told it has. `GRAPHICS_TIERS` owns the numbers;
 * this is only the arithmetic that spends them.
 */
/** Ceiling on device-pixel-ratio, whatever a display claims: past 2 it is not sharpness. */
const MAX_PIXEL_RATIO = 2;

/**
 * The drawing-buffer scale for a rung on a display, as a pure function.
 *
 * Pure and exported because it is the whole of the resolution policy and it is the part
 * that was wrong: a policy reachable only through a live WebGL context is a policy nobody
 * checks, and the bug it carried — a display percentage that resolved to exactly 1.0 on
 * every ratio-1 screen, so a 4K television cost a mini-PC and a workstation the same
 * 8.29 megapixels — survived because the only way to see it was to own the television.
 * `tools/graphics-tiers.ts` drives this directly.
 */
export function renderScaleFor(
  quality: GraphicsQuality,
  cssPixels: number,
  devicePixelRatio: number,
  mobilePresentation: boolean,
): number {
  const tier = GRAPHICS_TIERS[quality];
  const ceiling = mobilePresentation ? tier.mobileMaxPixels : tier.maxPixels;
  // Three terms, each answering a different question: what the display wants (`dpr`),
  // what this rung is willing to supersample to (`supersample`), and what the rung's
  // absolute budget will pay for. The smallest wins, so a 4K television can never
  // exceed the budget and a small retina panel is never downscaled below its sharpness.
  return Math.min(
    devicePixelRatio * tier.supersample,
    MAX_PIXEL_RATIO,
    Math.sqrt(ceiling / Math.max(1, cssPixels)),
  );
}

/** Where dynamic resolution stops for a rung, as the same kind of scale. */
export function minimumScaleFor(
  quality: GraphicsQuality,
  cssPixels: number,
  devicePixelRatio: number,
  mobilePresentation: boolean,
): number {
  const tier = GRAPHICS_TIERS[quality];
  const floor = mobilePresentation ? tier.mobileMinPixels : tier.minPixels;
  const base = cssPixels * devicePixelRatio * devicePixelRatio;
  return Math.min(1, Math.sqrt(floor / Math.max(1, base)));
}

/**
 * The drawing-buffer scale a player's explicit render-scale choice asks for.
 *
 * A fraction of the DISPLAY, not of the rung. `renderScaleFor` above is a rung spending
 * its own budget; this is a player refusing that budget in either direction — down,
 * because three rungs on a 4K television are 1.44, 3.69 and 12.96 megapixels and a
 * machine is not three machines, and up, because supersampling was reachable only by
 * also buying a 25 km vista and eighteen headlamps. The DPR cap still applies before
 * the fraction, because past 2 it is not sharpness, it is arithmetic.
 *
 * The one thing it will not be is unbounded. The top rung's ceiling is the most this
 * game ever draws on purpose, so it bounds a manual choice too: without it, 150% on a
 * retina laptop asks for 20 megapixels, and a player who cannot reach ten frames a
 * second cannot reach the menu that would undo it either.
 */
export function manualRenderScale(
  cssPixels: number,
  devicePixelRatio: number,
  mobilePresentation: boolean,
  fraction: number,
): number {
  const top = GRAPHICS_TIERS.blessing;
  const ceiling = mobilePresentation ? top.mobileMaxPixels : top.maxPixels;
  return Math.min(
    Math.min(devicePixelRatio, MAX_PIXEL_RATIO) * fraction,
    Math.sqrt(ceiling / Math.max(1, cssPixels)),
  );
}

/**
 * The offered fractions that actually differ on THIS display, plus whichever one the
 * player is already on.
 *
 * The bound in `manualRenderScale` is absolute, so it flattens the top of the row on a
 * large display: on a 4K television 125% and 150% both resolve to the top rung's
 * ceiling, and on a phone every choice from 100% up does — three buttons with one
 * outcome, which is a menu describing a resolution it cannot deliver. The row is built
 * from the display instead of from the list.
 *
 * `current` is retained whatever it resolves to, because a player who carried a stored
 * 150% to a 4K television must still see which button he is on.
 */
export function offeredRenderScales(
  cssPixels: number,
  devicePixelRatio: number,
  mobilePresentation: boolean,
  current: RenderScale = null,
): readonly RenderScaleFraction[] {
  const offered: RenderScaleFraction[] = [];
  let previous = 0;
  for (const fraction of RENDER_SCALES) {
    const ratio = manualRenderScale(cssPixels, devicePixelRatio, mobilePresentation, fraction);
    if (ratio <= previous && fraction !== current) continue;
    offered.push(fraction);
    previous = Math.max(previous, ratio);
  }
  return offered;
}
/**
 * Four samples was the only useful multisampling level in measurement: 2x retained
 * almost all of the cost. Whether it is enabled is an independent display setting;
 * graphics tiers control resolution and shadows.
 */
const MSAA_SAMPLES = 4;

/** Touch plus a coarse pointer or phone-sized screen avoids classifying touch laptops. */
export function prefersMobilePresentation(): boolean {
  if (navigator.maxTouchPoints <= 0) return false;
  const coarse = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  const phoneSized = Math.min(window.screen.width, window.screen.height) <= 600;
  return coarse || phoneSized;
}

// ---------------------------------------------------------------------------
// Ink outlines: the second half of the drawn-landscape look, in the same pass.
// ---------------------------------------------------------------------------

/**
 * Relative luminance gradient that counts as an edge. Low enough to catch a dune
 * against the sky and the ground's own shading bands, high enough that the road's
 * aggregate texture and the stipple are not outlined dot by dot.
 */
const INK_THRESHOLD = 0.14;

const PHOTO_SEPIA_STRENGTH = 0.1;
const PHOTO_DAY_SATURATION = 0.9;
const PHOTO_NIGHT_SATURATION = 0.85;
const PHOTO_NIGHT_EXPOSURE_MIN_EV = 2;
const PHOTO_NIGHT_EXPOSURE_MAX_EV = 3;
const PHOTO_DAY_BLACK_LIFT = 0.018;

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Applies the camera's authored print look in display space. Exposure is applied
 * in linear light so each EV is a real doubling; the listed sepia, saturation,
 * and black-lift controls then follow in their requested order.
 */
function processPhotoPixels(data: Uint8ClampedArray, dayFactor: number): void {
  const day = Math.min(1, Math.max(0, dayFactor));
  const night = 1 - day;
  const exposureEv =
    night <= 0
      ? 0
      : PHOTO_NIGHT_EXPOSURE_MIN_EV +
        (PHOTO_NIGHT_EXPOSURE_MAX_EV - PHOTO_NIGHT_EXPOSURE_MIN_EV) * night;
  const exposure = 2 ** exposureEv;
  const saturation = PHOTO_DAY_SATURATION +
    (PHOTO_NIGHT_SATURATION - PHOTO_DAY_SATURATION) * night;
  const blackLift = PHOTO_DAY_BLACK_LIFT * day;

  for (let i = 0; i < data.length; i += 4) {
    let r = linearToSrgb(srgbToLinear(data[i]! / 255) * exposure);
    let g = linearToSrgb(srgbToLinear(data[i + 1]! / 255) * exposure);
    let b = linearToSrgb(srgbToLinear(data[i + 2]! / 255) * exposure);

    const sepiaR = r * 0.393 + g * 0.769 + b * 0.189;
    const sepiaG = r * 0.349 + g * 0.686 + b * 0.168;
    const sepiaB = r * 0.272 + g * 0.534 + b * 0.131;
    r += (sepiaR - r) * PHOTO_SEPIA_STRENGTH;
    g += (sepiaG - g) * PHOTO_SEPIA_STRENGTH;
    b += (sepiaB - b) * PHOTO_SEPIA_STRENGTH;

    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    r = luminance + (r - luminance) * saturation;
    g = luminance + (g - luminance) * saturation;
    b = luminance + (b - luminance) * saturation;

    const shadow = 1 - smoothstep(0.08, 0.4, luminance);
    r += blackLift * shadow;
    g += blackLift * shadow;
    b += blackLift * shadow;

    data[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    data[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    data[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
  }
}

function drawPhotoMileage(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mileageKm: number,
): void {
  const fontSize = Math.max(15, Math.round(height * 0.052));
  const inset = Math.max(12, Math.round(width * 0.026));
  const label = `${Math.max(0, mileageKm).toFixed(1)} km`;
  context.save();
  context.font = `600 ${fontSize}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
  context.textAlign = 'right';
  context.textBaseline = 'bottom';
  context.lineJoin = 'round';
  context.lineWidth = Math.max(2, fontSize * 0.14);
  context.strokeStyle = 'rgba(20, 16, 11, 0.72)';
  context.fillStyle = 'rgba(242, 233, 211, 0.94)';
  context.strokeText(label, width - inset, height - inset);
  context.fillText(label, width - inset, height - inset);
  context.restore();
}


const MAX_PENDING_GPU_QUERIES = 8;

interface GpuTimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface PendingGpuQuery {
  readonly query: WebGLQuery;
  readonly eligible: boolean;
}



export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly fog: THREE.FogExp2;
  // --- Heat-haze post pass ---
  /** Scene-pass target sampled by the fullscreen haze/ink pass on every tier. */
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
   * Camera height above the grazed-ground line, metres, for the hot-layer
   * integration. Defaulted to a standing eye so the very first frame is sensible
   * before the loop supplies one.
   */
  private hazeEyeHeight = DEFAULT_EYE_HEIGHT_M;
  private hazeMinimumEyeHeight = DEFAULT_HEAT_MIRAGE.minimumEyeHeightM;
  /** Live handle on the pass's physical constants; see createHeatMirageUniforms. */
  private readonly heatUniforms = createHeatMirageUniforms();
  /** Rise rates of the two strata octaves, strata per second. */
  private hazeBroadRiseHz = DEFAULT_HEAT_MIRAGE.broadRiseHz;
  private hazeFineRiseHz = DEFAULT_HEAT_MIRAGE.fineRiseHz;
  /** Wall clock of the previous frame, seconds; negative until the first one. */
  private hazeClockS = -1;
  /** What the pass was last told, kept for the depth-resolve decision. */
  private daylight = 0;
  private shimmerStrength = 0;
  private mirageStrength = 0;
  /** Hand torch projected from the rendered eye; disabled rather than recreated. */
  private readonly torchLight: THREE.SpotLight;
  private readonly torchTarget = new THREE.Object3D();
  /** Reused 2D target for compact photographs; created only when the shutter fires. */
  private photoCanvas: HTMLCanvasElement | null = null;
  private photoContext: CanvasRenderingContext2D | null = null;


  /**
   * The tier's cap, resolved against this display once. `adaptResolution` scales
   * THIS, not the raw cap: basing it on the cap meant that on any display below
   * the cap (a DPR 1.25 monitor, say) the controller's own "reduced" ratios were
   * still larger than the native ratio the constructor had chosen, so the first
   * step down quietly asked the weakest machines to draw MORE pixels.
   */
  private basePixelRatio: number;
  private quality: GraphicsQuality;
  private readonly adaptiveResolution: AdaptiveResolutionController;
  private readonly timerQueryGl: WebGL2RenderingContext | null;
  private readonly timerQueryExt: GpuTimerQueryExtension | null;
  private readonly pendingGpuQueries: PendingGpuQuery[] = [];
  private readonly completedGpuSamples: number[] = [];
  private readonly completedGpuSampleEligibility: boolean[] = [];
  private queryEligible = false;

  constructor(
    canvas: HTMLCanvasElement,
    quality: GraphicsQuality = 'standard',
    msaa = true,
    inkStrength = DEFAULT_INK_STRENGTH,
    private readonly mobilePresentation = prefersMobilePresentation(),
    /**
     * The player's fixed drawing-buffer fraction, or null for the rung's own budget
     * adapted by measurement. While it is set the controller is pinned: a named
     * resolution that still drifts is not a named resolution.
     */
    private renderScale: RenderScale = null,
    fieldOfView = DEFAULT_FIELD_OF_VIEW,
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // NOT antialiased. Standard and Blessing draw scene pixels into
      // `hazeTarget`, whose MSAA sample count is controlled independently;
      // acceptable draws directly to the default framebuffer. A multisampled
      // backbuffer would allocate and resolve an image that cannot differ by one
      // pixel after the fullscreen pass.
      antialias: false,
      // Never ask a phone for its highest-performance configuration. On a desktop this
      // hint picks the discrete GPU, which is what it is for; on a phone there is only
      // one GPU, and asking for maximum performance is asking the driver and the power
      // governor for clocks the game does not need and the device cannot shed. The game
      // wants a phone that stays cool, and says so.
      powerPreference: this.mobilePresentation ? 'default' : 'high-performance',
    });
    primeMaxAnisotropy(this.renderer);
    this.adaptiveResolution = new AdaptiveResolutionController(quality);
    const context = this.renderer.getContext();
    if (
      typeof WebGL2RenderingContext !== 'undefined'
      && context instanceof WebGL2RenderingContext
    ) {
      this.timerQueryGl = context;
      this.timerQueryExt = context.getExtension(
        'EXT_disjoint_timer_query_webgl2',
      ) as GpuTimerQueryExtension | null;
    } else {
      this.timerQueryGl = null;
      this.timerQueryExt = null;
    }
    this.basePixelRatio = this.pixelRatioFor(quality);
    this.adaptiveResolution.setPinned(renderScale !== null);
    this.updateAdaptiveFloor();
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.shadowMap.enabled = shadowsFor(quality, this.mobilePresentation);
    // PCFSoft's wider kernel costs extra texture taps for a blur that reads as
    // noise at this shadow resolution; plain PCF is visually near-identical and
    // materially cheaper on a low-end iGPU.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // Draw statistics are accumulated by hand across BOTH passes of a frame.
    //
    // Three resets its counters at the start of every `render` call by default, so after
    // this renderer's two passes the counters describe only the second one — the single
    // fullscreen triangle. That is worse than no reading at all, because it looks like an
    // answer. With auto-reset off and an explicit reset at the top of the frame, the
    // counters describe the frame.
    this.renderer.info.autoReset = false;

    const viewportWidth = Math.max(1, canvas.clientWidth);
    const viewportHeight = Math.max(1, canvas.clientHeight);
    this.camera = new THREE.PerspectiveCamera(
      fieldOfView,
      viewportWidth / viewportHeight,
      CAMERA_NEAR,
      CAMERA_FAR,
    );

    // Density is retuned per frame from the sky gradient's haze value.
    this.fog = new THREE.FogExp2(0xd8c39a, 0.00035);
    this.scene.fog = this.fog;

    // Every tier renders into this colour-and-depth target, then uses the fullscreen
    // pass for authored colour, restrained film grain and ink. Acceptable suppresses
    // only the haze warp; standard and blessing sample the resolved depth so nearby
    // geometry never inherits a horizon-shaped screen mask.
    // The independent MSAA setting decides geometry-edge samples.
    const hazeDepth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    hazeDepth.minFilter = THREE.NearestFilter;
    hazeDepth.magFilter = THREE.NearestFilter;
    this.hazeTarget = new THREE.WebGLRenderTarget(1, 1, {
      samples: msaa ? MSAA_SAMPLES : 0,
      depthTexture: hazeDepth,
    });
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
        tDepth: { value: this.hazeTarget.depthTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uMirage: { value: 0 },
        uHazePhase: { value: new THREE.Vector2() },
        ...this.heatUniforms,
        uDaylight: { value: 0 },
        uEyeAbove: { value: DEFAULT_EYE_HEIGHT_M },
        uGroundSlope: { value: 0 },
        uHorizon: { value: 0.5 },
        uCameraRotation: { value: new THREE.Matrix3() },
        uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(fieldOfView) / 2) },
        uCameraNear: { value: CAMERA_NEAR },
        uCameraFar: { value: CAMERA_FAR },
        uInkStrength: { value: Math.min(1, Math.max(0, inkStrength)) },
        uInkThreshold: { value: INK_THRESHOLD },
        uViewTint: { value: new THREE.Color(1, 1, 1) },
        uViewTintStrength: { value: 0 },
        uBinoculars: { value: 0 },
        uCameraViewfinder: { value: 0 },
        uSunUv: { value: new THREE.Vector2(0.5, 2) },
        uSunRays: { value: 0 },
        uSunRayColor: { value: new THREE.Color() },
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

    this.torchLight = new THREE.SpotLight(0xffedbd, 150, 65, 0.32, 0.58, 1.7);
    this.torchLight.visible = false;
    this.torchLight.castShadow = false;
    this.torchLight.target = this.torchTarget;
    this.scene.add(this.torchLight, this.torchTarget);


    this.resize();
    window.addEventListener('resize', this.resize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.disposeGpuQueries();
    this.hazeTarget.dispose();
    this.hazeMaterial.dispose();
    this.hazeGeometry.dispose();
    this.scene.remove(this.torchLight, this.torchTarget);
    this.torchLight.dispose();
    this.renderer.dispose();
  }


  /**
   * Re-reads the canvas CSS viewport after an in-page display-mode change.
   * Browser resizes already call the same path through the window listener.
   */
  resizeViewport(): void {
    this.resize();
  }

  /**
   * Waits until both program variants used by the live two-pass frame are ready.
   *
   * The scene pass renders into `hazeTarget`, where Three disables renderer tone
   * mapping and uses the working colour space. Compiling it with the default target
   * instead builds a different canvas-output program; on a cold driver cache that
   * left the real scene programs compiling after the loading cover disappeared.
   */
  async waitForFrameShaders(): Promise<void> {
    const previousTarget = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(this.hazeTarget);
      const sceneReady = compileSafely(this.renderer, this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      const postReady = compileSafely(this.renderer, this.hazeScene, this.hazeCamera);
      await Promise.all([sceneReady, postReady]);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  /**
   * Waits until the GPU has completed every command submitted before this call.
   *
   * Shader linking alone does not cover the first texture uploads, shadow maps,
   * PMREM bake, render-target resolve, or fullscreen pass. A fence after the final
   * covered draw makes all of those part of the launch barrier as well.
   */
  async waitForSubmittedFrame(): Promise<void> {
    const context = this.renderer.getContext();
    if (
      typeof WebGL2RenderingContext === 'undefined'
      || !(context instanceof WebGL2RenderingContext)
    ) {
      context.finish();
      return;
    }

    const fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (fence === null) throw new Error('could not create the launch GPU fence');
    context.flush();
    await new Promise<void>((resolve, reject) => {
      const poll = (): void => {
        const status = context.clientWaitSync(fence, 0, 0);
        if (status === context.TIMEOUT_EXPIRED) {
          setTimeout(poll, 8);
          return;
        }
        context.deleteSync(fence);
        if (status === context.WAIT_FAILED) {
          reject(new Error('the launch GPU fence failed'));
        } else {
          resolve();
        }
      };
      setTimeout(poll, 0);
    });
  }


  /** Updates inexpensive player-held/worn view effects without allocating. */
  setItemViewEffects(
    shades: ShadeTint | null,
    binoculars: boolean,
    torchlight: boolean,
    cameraViewfinder: boolean,
  ): void {
    const tint = this.hazeMaterial.uniforms.uViewTint.value as THREE.Color;
    if (shades === 'green') tint.setRGB(0.56, 0.86, 0.52);
    else if (shades === 'yellow') tint.setRGB(0.95, 0.78, 0.42);
    else if (shades === 'red') tint.setRGB(0.88, 0.42, 0.35);
    else tint.setRGB(1, 1, 1);
    this.hazeMaterial.uniforms.uViewTintStrength.value = shades === null ? 0 : 0.72;
    this.hazeMaterial.uniforms.uBinoculars.value = binoculars ? 1 : 0;
    this.hazeMaterial.uniforms.uCameraViewfinder.value = cameraViewfinder ? 1 : 0;

    this.torchLight.visible = torchlight;
    if (torchlight) {
      this.torchLight.position.copy(this.camera.position);
      this.camera.getWorldDirection(this._forward);
      this.torchTarget.position.copy(this.camera.position).addScaledVector(this._forward, 25);
      this.torchTarget.updateMatrixWorld();
    }
  }

  /**
   * The drawing-buffer ratio this display gets before adaptation: the rung's budget,
   * or the player's fraction when he has named one.
   */
  private pixelRatioFor(quality: GraphicsQuality): number {
    const canvas = this.renderer.domElement;
    const cssPixels = canvas.clientWidth * canvas.clientHeight;
    if (this.renderScale !== null) {
      return manualRenderScale(
        cssPixels,
        window.devicePixelRatio,
        this.mobilePresentation,
        this.renderScale,
      );
    }
    return renderScaleFor(quality, cssPixels, window.devicePixelRatio, this.mobilePresentation);
  }

  /**
   * Where dynamic resolution stops, as an ABSOLUTE pixel count rather than a fraction
   * of the ceiling.
   *
   * A fraction says nothing about the picture: 0.55 of a phone's budget and 0.55 of a
   * workstation's are different images entirely, and the one thing a floor has to
   * guarantee is the image below which the machine is no longer worth looking at. Every
   * rung used to answer this its own way — `acceptable` and both mobile paths in
   * absolute pixels, `standard` and `blessing` in ratios — so whether a rung had a real
   * floor depended on which rung it was.
   */
  private updateAdaptiveFloor(): void {
    const canvas = this.renderer.domElement;
    // `this.basePixelRatio`, never the renderer's live ratio: `setQuality` recomputes the
    // floor BEFORE it installs the new ratio, so reading it here would measure against the
    // rung the machine just left and quietly hand back that rung's floor.
    this.adaptiveResolution.setMinimumScale(
      minimumScaleFor(
        this.quality,
        canvas.clientWidth * canvas.clientHeight,
        this.basePixelRatio,
        this.mobilePresentation,
      ),
    );
  }

  private resize = (): void => {
    const canvas = this.renderer.domElement;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    this.basePixelRatio = this.pixelRatioFor(this.quality);
    this.updateAdaptiveFloor();
    this.renderer.setPixelRatio(this.basePixelRatio * this.adaptiveResolution.scale);
    this.renderer.setSize(width, height, false);
    this.resizeHazeTarget();

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  render(): void {
    this.pollGpuQueries();
    const query = this.beginGpuTimerQuery();
    try {
      this.drawFrame();
    } finally {
      if (query !== null) this.endGpuTimerQuery();
    }
  }

  /**
   * Captures the actual rendered view at a compact resolution, with eyepiece and
   * worn-glass effects removed. The ordinary render immediately after this restores
   * the player's viewfinder; only the photograph receives the clean optical image.
   * Mileage is burned into the print itself so saved and dropped photographs retain it.
   */
  capturePhoto(dayFactor: number, mileageKm: number): string | null {
    if (this.photoCanvas === null) {
      this.photoCanvas = document.createElement('canvas');
      this.photoContext = this.photoCanvas.getContext('2d', { alpha: false });
    }
    const target = this.photoCanvas;
    const context = this.photoContext;
    if (!target || !context) return null;

    const tintStrength = this.hazeMaterial.uniforms.uViewTintStrength.value as number;
    const binoculars = this.hazeMaterial.uniforms.uBinoculars.value as number;
    const viewfinder = this.hazeMaterial.uniforms.uCameraViewfinder.value as number;
    try {
      this.hazeMaterial.uniforms.uViewTintStrength.value = 0;
      this.hazeMaterial.uniforms.uBinoculars.value = 0;
      this.hazeMaterial.uniforms.uCameraViewfinder.value = 0;
      this.drawFrame();

      const source = this.renderer.domElement;
      const longest = Math.max(source.width, source.height, 1);
      const scale = Math.min(1, 640 / longest);
      target.width = Math.max(1, Math.round(source.width * scale));
      target.height = Math.max(1, Math.round(source.height * scale));
      context.drawImage(source, 0, 0, target.width, target.height);
      const pixels = context.getImageData(0, 0, target.width, target.height);
      processPhotoPixels(pixels.data, dayFactor);
      context.putImageData(pixels, 0, 0);
      drawPhotoMileage(context, target.width, target.height, mileageKm);
      return target.toDataURL('image/jpeg', 0.82);
    } catch {
      return null;
    } finally {
      this.hazeMaterial.uniforms.uViewTintStrength.value = tintStrength;
      this.hazeMaterial.uniforms.uBinoculars.value = binoculars;
      this.hazeMaterial.uniforms.uCameraViewfinder.value = viewfinder;
    }
  }

  private drawFrame(): void {
    this.renderer.info.reset();
    // Real time, not game time: the strata climb at a flicker rate the eye knows,
    // which a time-scaled or paused game clock would slow or freeze. The phases are
    // integrated here in doubles and wrapped (see advanceHazePhase), and the clock
    // the grain reads is wrapped at a whole number of its own cycles, so no uniform
    // grows with uptime and the float32 the shader holds never loses the pattern.
    const nowS = performance.now() * 0.001;
    const dt = this.hazeClockS < 0 ? 0 : Math.min(0.1, Math.max(0, nowS - this.hazeClockS));
    this.hazeClockS = nowS;
    const phase = this.hazeMaterial.uniforms.uHazePhase.value as THREE.Vector2;
    phase.set(
      advanceHazePhase(phase.x, dt, this.hazeBroadRiseHz),
      advanceHazePhase(phase.y, dt, this.hazeFineRiseHz),
    );
    this.hazeMaterial.uniforms.uTime.value = nowS % HAZE_CLOCK_PERIOD_S;
    this.hazeMaterial.uniforms.uHorizon.value = this.horizonScreenY();
    this.hazeMaterial.uniforms.uEyeAbove.value = Math.max(
      this.hazeMinimumEyeHeight,
      this.hazeEyeHeight,
    );
    this.camera.updateWorldMatrix(true, false);
    (this.hazeMaterial.uniforms.uCameraRotation.value as THREE.Matrix3).setFromMatrix4(
      this.camera.matrixWorld,
    );
    this.hazeMaterial.uniforms.uTanHalfFov.value = Math.tan(
      THREE.MathUtils.degToRad(this.camera.fov) / 2,
    );
    this.hazeMaterial.uniforms.uCameraNear.value = this.camera.near;
    this.updateSunRays();
    this.hazeMaterial.uniforms.uCameraFar.value = this.camera.far;
    // TWO PASSES ON EVERY TIER, and the reason is colour, not shimmer.
    //
    // Pass 1 renders into `hazeTarget`. Three writes the WORKING colour space
    // (linear) into a render target — only the canvas gets `outputColorSpace` —
    // and pass 2 copies those texels through untouched, so the frame reaches the
    // display linear-encoded and roughly a gamma darker than a direct render.
    // The whole game is lit and painted against that image.
    //
    // So this is deliberate, not an oversight: skipping the pass on the cheapest
    // tier made it the only correctly encoded tier, which read as washed out
    // beside the other two. Acceptable keeps the pass and drops the WARP instead
    // (see `setHeatHaze`), which is where the cost actually was.
    this.renderer.setRenderTarget(this.hazeTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.hazeScene, this.hazeCamera);
  }

  /**
   * Screen-space `uv.y` of the true horizon (0 = bottom of frame, 1 = top). Used by
   * the INK pass only — the shimmer works in world rays and needs no such row.
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

  /** Updates every physical parameter in the production heat-mirage shader. */
  setHeatMirageParameters(parameters: HeatMirageParameters): void {
    writeHeatMirageUniforms(this.heatUniforms, parameters);
    this.hazeBroadRiseHz = parameters.broadRiseHz;
    this.hazeFineRiseHz = parameters.fineRiseHz;
    this.hazeMinimumEyeHeight = parameters.minimumEyeHeightM;
  }

  /**
   * How much of the day's light the colour finish should assume, 0..1: the sand
   * veil and the toe lift. Deliberately separate from the heat: the two used to be
   * one number, so the mirage lab's heat slider re-graded the whole picture.
   */
  setDaylight(dayFactor: number): void {
    this.daylight = Math.min(1, Math.max(0, dayFactor));
    this.hazeMaterial.uniforms.uDaylight.value = this.daylight;
    this.updateDepthResolve();
  }

  /**
   * This frame's heat: shimmer and mirage strength, and the grazed-ground line the
   * shader integrates the hot layer against (render/heathaze.ts).
   *
   * Both strengths are always zero on the cheapest tier. The procedural field is the
   * expensive half of this pass; Acceptable pays the copy and outlines, which define
   * the drawn look, and skips the heat: at zero strength the shader branches past it
   * on a uniform every fragment agrees on.
   */
  setHeatHaze(frame: HeatHazeFrame): void {
    const enabled = this.quality !== 'acceptable';
    this.shimmerStrength = enabled ? Math.min(1, Math.max(0, frame.shimmer)) : 0;
    this.mirageStrength = enabled ? Math.min(1, Math.max(0, frame.mirage)) : 0;
    this.hazeMaterial.uniforms.uStrength.value = this.shimmerStrength;
    this.hazeMaterial.uniforms.uMirage.value = this.mirageStrength;
    this.hazeEyeHeight = frame.eyeAboveM;
    this.hazeMaterial.uniforms.uGroundSlope.value = frame.groundSlope;
    this.updateDepthResolve();
  }

  private updateDepthResolve(): void {
    // THE WARP IS NOT THE ONLY THING THAT SAMPLES DEPTH, which is what this line
    // used to assume. `tDepth` also decides where the sand veil begins and — far
    // more visibly — which fragments the INK pass is allowed to outline: the sky,
    // the stars and the planets are excluded by sitting at the far plane, and
    // that test runs on every tier, every frame, warp or no warp.
    //
    // Leaving the multisampled depth unresolved therefore did not skip a sample
    // nobody read. It handed the outline gate an UNDEFINED texture — three
    // invalidates the attachment when the flag is off — for the whole night and
    // for the entire lifetime of the cheapest tier, so the drawn look either
    // vanished or spread into the sky depending on what the driver left behind.
    // The resolve is skipped only when nothing in the pass reads depth at all.
    const ink = this.hazeMaterial.uniforms.uInkStrength.value as number;
    this.hazeTarget.resolveDepthBuffer =
      this.shimmerStrength > 0 || this.mirageStrength > 0 || ink > 0 || this.daylight > 0;
  }

  /**
   * The sun for the post pass's light shafts: direction (world, unit), colour and
   * strength (render/sky.ts `sunRayStrength`), set once a frame.
   */
  setSunRays(direction: THREE.Vector3, colour: THREE.Color, strength: number): void {
    this.sunRayDir.copy(direction);
    (this.hazeMaterial.uniforms.uSunRayColor.value as THREE.Color).copy(colour);
    this.sunRayStrength = strength;
  }

  private readonly sunRayDir = new THREE.Vector3(0, 1, 0);
  private sunRayStrength = 0;
  private readonly sunRayScratch = new THREE.Vector3();
  private readonly sunRayForward = new THREE.Vector3();

  /** Projects the sun onto the screen; shafts fade as it leaves the view's front. */
  private updateSunRays(): void {
    const u = this.hazeMaterial.uniforms;
    this.camera.getWorldDirection(this.sunRayForward);
    const facing = this.sunRayForward.dot(this.sunRayDir);
    if (this.sunRayStrength <= 0 || facing <= 0.05) {
      u.uSunRays.value = 0;
      return;
    }
    this.sunRayScratch.copy(this.camera.position).addScaledVector(this.sunRayDir, 1000).project(this.camera);
    (u.uSunUv.value as THREE.Vector2).set(this.sunRayScratch.x * 0.5 + 0.5, this.sunRayScratch.y * 0.5 + 0.5);
    // Full when the sun is in or near the frame, gone when it is well out to the side.
    u.uSunRays.value = this.sunRayStrength * smoothstep(0.05, 0.6, facing);
  }

  /** Size the scene-pass target to the actual drawing buffer (CSS size × pixel ratio). */
  private resizeHazeTarget(): void {
    this.renderer.getDrawingBufferSize(this._drawSize);
    this.hazeTarget.setSize(this._drawSize.x, this._drawSize.y);
    this.hazeMaterial.uniforms.uResolution.value.set(this._drawSize.x, this._drawSize.y);
  }


  // --- Adaptive resolution ---

  /**
   * The live drawing-buffer scale, where 1 is the tier's full resolution. The
   * launch settles this under the loading cover, so the first frame the player
   * sees is already at the resolution the rest of the session will run at.
   */
  get resolutionScale(): number {
    return this.adaptiveResolution.scale;
  }

  /**
   * Pixels the scene is actually shaded at, both passes.
   *
   * A COUNT rather than a percentage, because a percentage needs a stated base and the
   * base moved: with a manual render scale the resolution is a fraction of the display
   * and `resolutionScale` stays at 1, so the old "% of ceiling" readout would report
   * full resolution at every setting the player chose.
   */
  get renderedPixels(): number {
    this.renderer.getDrawingBufferSize(this._drawSize);
    return this._drawSize.x * this._drawSize.y;
  }

  /** Whether this context can time the GPU. Without it the scale never moves. */
  get measuresGpuTime(): boolean {
    return this.timerQueryExt !== null;
  }

  /**
   * Draw calls submitted by the last frame, both passes together.
   *
   * The number that separates a frame which is slow because it FILLS a lot of pixels from
   * one which is slow because it ISSUES a lot of work. Those two have opposite fixes, and
   * the CPU cost of submitting a frame (`draw` in the profiler) is dominated by the second:
   * measured on a phone, cutting the pixel budget by nearly three times and the light slots
   * by three moved the draw cost by twenty per cent, which is the signature of per-call
   * overhead rather than fill rate.
   */
  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  /** Triangles submitted by the last frame, both passes together. */
  get drawnTriangles(): number {
    return this.renderer.info.render.triangles;
  }

  /**
   * Mean measured GPU duration of a frame, or null without timer queries.
   *
   * Development only in practice: it exists so the on-device frame report can say
   * whether the frame is waiting on the GPU or the CPU, which no other reading can
   * separate on a phone.
   */
  get gpuFrameMs(): number | null {
    return this.adaptiveResolution.averageGpuMs;
  }

  /** Whether the live scale has been measured long enough to stand on its own. */
  get resolutionSettled(): boolean {
    return this.adaptiveResolution.verdictReached(performance.now());
  }

  /**
   * Incorporates completed GPU timer results using this frame's safety policy.
   * With no completed GPU result (including unsupported/disjoint queries), the
   * controller gets a null sample and intentionally retains its current scale.
   */
  adaptResolution(eligible: boolean, allowUpscale: boolean): void {
    this.queryEligible = eligible;
    const now = performance.now();
    let changed = false;

    if (this.completedGpuSamples.length === 0) {
      changed = this.adaptiveResolution.sample(null, eligible, allowUpscale, now) !== null;
    } else {
      while (this.completedGpuSamples.length > 0) {
        const gpuMs = this.completedGpuSamples.shift();
        const sampleEligible = this.completedGpuSampleEligibility.shift();
        if (gpuMs === undefined || sampleEligible === undefined) break;
        changed = this.adaptiveResolution.sample(
          gpuMs,
          eligible && sampleEligible,
          allowUpscale,
          now,
        ) !== null || changed;
      }
    }

    if (!changed) return;
    // setPixelRatio re-sizes the drawing buffer around the current CSS size, so
    // the canvas layout never moves when the resolution changes.
    this.renderer.setPixelRatio(this.basePixelRatio * this.adaptiveResolution.scale);
    this.resizeHazeTarget();
  }

  private beginGpuTimerQuery(): WebGLQuery | null {
    const gl = this.timerQueryGl;
    const ext = this.timerQueryExt;
    if (gl === null || ext === null || this.pendingGpuQueries.length >= MAX_PENDING_GPU_QUERIES) {
      return null;
    }

    const query = gl.createQuery();
    if (query === null) return null;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    this.pendingGpuQueries.push({
      query,
      eligible: this.queryEligible,
    });
    return query;
  }

  private endGpuTimerQuery(): void {
    const gl = this.timerQueryGl;
    const ext = this.timerQueryExt;
    if (gl !== null && ext !== null) gl.endQuery(ext.TIME_ELAPSED_EXT);
  }

  /** Non-blockingly collects completed GPU timings in submission order. */
  private pollGpuQueries(): void {
    const gl = this.timerQueryGl;
    const ext = this.timerQueryExt;
    if (gl === null || ext === null) return;

    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      this.disposeGpuQueries();
      return;
    }

    while (this.pendingGpuQueries.length > 0) {
      const pending = this.pendingGpuQueries[0];
      if (!gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE)) return;
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        this.disposeGpuQueries();
        return;
      }

      this.pendingGpuQueries.shift();
      const result = gl.getQueryParameter(pending.query, gl.QUERY_RESULT);
      const gpuMs = typeof result === 'number' ? result / 1_000_000 : Number.NaN;
      gl.deleteQuery(pending.query);
      if (!Number.isFinite(gpuMs) || gpuMs < 0) continue;
      if (this.completedGpuSamples.length === MAX_PENDING_GPU_QUERIES) {
        this.completedGpuSamples.shift();
        this.completedGpuSampleEligibility.shift();
      }
      this.completedGpuSamples.push(gpuMs);
      this.completedGpuSampleEligibility.push(pending.eligible);
    }
  }

  private disposeGpuQueries(): void {
    if (this.timerQueryGl !== null) {
      for (const { query } of this.pendingGpuQueries) {
        this.timerQueryGl.deleteQuery(query);
      }
    }
    this.pendingGpuQueries.length = 0;
    this.completedGpuSamples.length = 0;
    this.completedGpuSampleEligibility.length = 0;
  }

  /**
   * Switches the resolution/shadow tier in place. MSAA is deliberately untouched:
   * it is an independent display preference.
   */
  setQuality(quality: GraphicsQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.adaptiveResolution.setQuality(quality);
    this.disposeGpuQueries();
    // Read from the table, never re-derived: this line used to test the tier name
    // directly, and a phone's shadow pass is now off on every rung, so a second copy of
    // the rule here would silently disagree with the one the constructor used.
    this.renderer.shadowMap.enabled = shadowsFor(quality, this.mobilePresentation);
    this.basePixelRatio = this.pixelRatioFor(quality);
    this.updateAdaptiveFloor();
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.resizeHazeTarget();
  }

  /**
   * Installs the player's render-scale choice, or returns the rung to automatic.
   *
   * The controller is RESET either way rather than kept: its cost slope and its live
   * average were measured at a different pixel count, and coming back to `Auto` holding
   * a reduction it earned before the change would hand the player a resolution he
   * cannot account for.
   */
  setRenderScale(scale: RenderScale): void {
    if (scale === this.renderScale) return;
    this.renderScale = scale;
    this.adaptiveResolution.setPinned(scale !== null);
    this.disposeGpuQueries();
    this.basePixelRatio = this.pixelRatioFor(this.quality);
    this.updateAdaptiveFloor();
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.resizeHazeTarget();
  }

  /**
   * The CSS viewport the resolution policy is resolved against, for the menu.
   *
   * The menu cannot read `window.innerWidth`: cinema mode shortens the CANVAS, not the
   * window, so the two disagree by 180 pixels exactly while it is on — and a readout
   * that claims a resolution the game is not rendering is the drift this whole control
   * exists to remove.
   */
  viewport(): { readonly cssWidth: number; readonly cssHeight: number } {
    const canvas = this.renderer.domElement;
    return {
      cssWidth: Math.max(1, canvas.clientWidth),
      cssHeight: Math.max(1, canvas.clientHeight),
    };
  }

  /** Changes scene-target multisampling without changing resolution quality. */
  setMsaa(enabled: boolean): void {
    const samples = enabled ? MSAA_SAMPLES : 0;
    if (this.hazeTarget.samples === samples) return;
    this.hazeTarget.samples = samples;
    // Multisampling is allocation state; Three recreates the target on next bind.
    this.hazeTarget.dispose();
  }

  /** Changes post-process outline opacity without rebuilding the shader pass. */
  setInkStrength(strength: number): void {
    this.hazeMaterial.uniforms.uInkStrength.value = Math.min(1, Math.max(0, strength));
  }

  /**
   * Sets the draw distance in place, from the pause menu, with no reload.
   *
   * The far plane clears the draw distance by ORBIT_MARGIN (the far plane is
   * measured from the camera, which can stand that far past the car on the far
   * side of the desert it is looking at) and never drops below CAMERA_FAR, the
   * floor the sky dome and the orbit camera both depend on. The near plane rises
   * with it so the far/near ratio — and therefore the depth resolution spent on
   * the car up close — stays bounded; see MAX_DEPTH_RATIO.
   */
  setViewDistance(metres: number): void {
    const far = farPlaneForViewDistance(metres);
    this.camera.far = far;
    this.camera.near = nearPlaneForFarPlane(far);
    this.camera.updateProjectionMatrix();
  }
}
