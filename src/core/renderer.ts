import * as THREE from 'three';
import { SandColor } from '../render/desertdust';
import '../render/lightshader';
import { setAirFogEdge } from '../render/airfog';
import { primeMaxAnisotropy } from '../render/texturequality';
import { retroActive, retroPixelRatio } from '../render/retro';
import { setCleanFrameHeight, setCleanStyle } from '../render/cleanstyle';
import {
  advanceHazePhase,
  createHeatMirageUniforms,
  DEFAULT_EYE_HEIGHT_M,
  DEFAULT_HEAT_MIRAGE,
  HAZE_FRAGMENT,
  HAZE_VERTEX,
  writeHeatMirageUniforms,
  type HeatHazeFrame,
  type HeatMirageParameters,
} from '../render/hazeshader';
import { PRESENT_FRAGMENT, PRESENT_VERTEX } from '../render/presentshader';
import {
  DEFAULT_FIELD_OF_VIEW,
  DEFAULT_INK_STRENGTH,
  screenLinesFor,
  shadowModeDefault,
  shadowModeFor,
  type ShadowMode,
  type GraphicsQuality,
  type FrameScale,
  type RetroLines,
  type VisualStyle,
} from '../game/settings';
import type { ShadeTint } from '../items/items';

/**
 * Renderer, scene and camera ownership.
 *
 * The far plane and fog are set up for the desert vista: the horizon runs to a few
 * kilometres and must still resolve, so the far plane is 4 km. The air's own veil and
 * the fade at the edge of the drawn world live in render/airfog.ts; the scene's
 * `FogExp2` carries only the weather.
 */

/**
 * Far-plane floor in metres. The sky dome (DOME_RADIUS = 3000 in render/sky.ts)
 * needs at least this much reach, so `setViewDistance` never drops below it: the
 * drawn horizon may shrink, but the dome must keep resolving.
 */
/** Albedo of a haboob wall, authored against the starting sand. */
const WALL_DUST = new SandColor(new THREE.Color(0.72, 0.42, 0.2));
/** The distant sand veil over the horizon, likewise. */
const SAND_VEIL = new SandColor(new THREE.Color(0.78, 0.69, 0.56));
/**
 * The cinema lens's Panini strength d (render/hazeshader.ts `paniniSource`) until the
 * console knob (`Renderer.panini`) changes it. The lens is only on in cinema mode.
 */
const DEFAULT_PANINI = 0.3;

export const CAMERA_FAR = 4000;
/**
 * Near-plane floor in metres. The cabin eye sits a hand's width from the headliner and
 * the pillars, so this must clear the trim round it without slicing into it.
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
 * Ceiling on the scene frame's size against the canvas's CSS size, whatever the chosen
 * height asks of it: past 2 it is not sharpness. It bites only on a canvas shorter than
 * half the chosen height — 1440p in a 600-pixel window, or `screen` on a phone whose DPR
 * is 3 — and the menu quotes the clamped result.
 */
const MAX_PIXEL_RATIO = 2;

/** The canvas in CSS pixels and in the device pixels it covers on the display. */
export interface CanvasPixels {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly deviceWidth: number;
  readonly deviceHeight: number;
}

/**
 * The scene frame a multiple draws on this canvas: the screen's device lines, held to
 * the rung's `screenLines`, times `scale`, bounded at `MAX_PIXEL_RATIO` times the CSS
 * height; the width at the canvas's own aspect. Where that comes out at the screen's own
 * height it is the screen's device pixels exactly, so a frame meant to be one for one
 * never misses by the rounding of the width.
 *
 * Exported because the menu quotes the frame this produces: one function, so the row
 * cannot name a resolution the renderer is not drawing. Half a line of headroom because
 * the size is `floor(cssHeight x ratio)`, and `H / h x h` can land one ulp under `H`.
 */
export function sceneFrameSize(
  scale: FrameScale,
  screenLines: number,
  canvas: CanvasPixels,
): { readonly width: number; readonly height: number } {
  const cssWidth = Math.max(1, canvas.cssWidth);
  const cssHeight = Math.max(1, canvas.cssHeight);
  const base = Math.min(canvas.deviceHeight, screenLines);
  const lines = Math.max(1, Math.min(Math.floor(base * scale), Math.floor(cssHeight * MAX_PIXEL_RATIO)));
  if (lines === canvas.deviceHeight) {
    return { width: Math.max(1, canvas.deviceWidth), height: Math.max(1, canvas.deviceHeight) };
  }
  const ratio = (lines + 0.5) / cssHeight;
  return {
    width: Math.max(1, Math.floor(cssWidth * ratio)),
    height: Math.max(1, Math.floor(cssHeight * ratio)),
  };
}

/**
 * How far past the screen a frame must be drawn before FXAA is left off: from here the
 * average of the frame's extra pixels (render/presentshader.ts) smooths the edges, and
 * FXAA over it only softens what is far away. 1.4 so that x1.5 of a screen whose base
 * the rung's ceiling did not shorten always counts, and 1080p-ish frames on a 990-line
 * window (1.09x) keep it.
 */
const SUPERSAMPLE_WITHOUT_FXAA = 1.4;

/**
 * The layer of meshes that only cast shadows: the near traffic cars' stand-ins
 * (render/farcars.ts, world/traffic.ts). See the constructor's `shadowMap.render`.
 */
export const SHADOW_ONLY_LAYER = 1;

/**
 * Steps per colour channel in the retro finish. Few enough that the dithered bands read
 * as a period framebuffer; enough that skin-tone paint and dusk skies keep their hue.
 */
const RETRO_LEVELS = 24;

/** The finishing pass's display-space S-curve (render/hazeshader.ts `uContrast`). */
const DISPLAY_CONTRAST = 0.45;

/**
 * The scene target's texel type: half float wherever the context can render to it (WebGL2
 * with EXT_color_buffer_float or _half_float, which every desktop and current phone GPU
 * has), so the linear radiance keeps its range and its dark end. Without it, eight-bit
 * sRGB storage: still linear radiance to the shader through the hardware decode, clipped
 * at 1, which the tone curve then maps a little short of white.
 */
function sceneTargetType(renderer: THREE.WebGLRenderer): THREE.TextureDataType {
  const extensions = renderer.extensions;
  return extensions.has('EXT_color_buffer_float') || extensions.has('EXT_color_buffer_half_float')
    ? THREE.HalfFloatType
    : THREE.UnsignedByteType;
}

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
/**
 * The GPU running average behind `gpuFrameMs` and the launch's rung measurement
 * (app/bootwarmup.ts). An exponential mean, not a streak or a window: a brief stall
 * raises it for a moment and decays again, so only cost that PERSISTS reads as the
 * frame's cost.
 */
const GPU_SAMPLE_WEIGHT = 0.08;
/**
 * Samples dropped after every resolution change: resizing reallocates the scene target
 * and its depth attachment, so the frames straddling it measure the reallocation.
 */
const GPU_DISCARD_SAMPLES = 8;
/** Samples the average converges over before it counts as a measurement; half a second at 60 Hz. */
const GPU_SETTLE_SAMPLES = 30;

/** The face a PCF shadow pass draws of a material with no `shadowSide` (three's WebGLShadowMap). */
const PCF_SHADOW_SIDE: Readonly<Record<THREE.Side, THREE.Side>> = {
  [THREE.FrontSide]: THREE.BackSide,
  [THREE.BackSide]: THREE.FrontSide,
  [THREE.DoubleSide]: THREE.DoubleSide,
};

/**
 * One caster of every plain shadow-depth shape: each face a pass can draw (front, back,
 * both), as a mesh and as an instanced mesh, without a map, with one, and alpha-tested
 * through one (three hands the depth material the source's map whether or not it
 * tests alpha, and the map is in the key). A depth program's key is little more than
 * that, so these cover any caster whose lit material is not more exotic (displacement,
 * skinning, morphs, an alpha map), whatever that lit material is — including content
 * first built far down the road, which the boot scene never held (measured: a mapped
 * double-sided caster's depth program linked mid-drive at 38 km). Compiled once at
 * boot (`waitForFrameShaders`); the holders keep the programs.
 */
function depthVariantSamples(): THREE.Object3D {
  const group = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  map.needsUpdate = true;
  for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
    for (const instanced of [false, true]) {
      for (const shape of ['plain', 'mapped', 'tested'] as const) {
        const material = new THREE.MeshBasicMaterial(
          shape === 'plain' ? { side } : shape === 'mapped' ? { side, map } : { side, map, alphaTest: 0.5 },
        );
        const mesh = instanced ? new THREE.InstancedMesh(geometry, material, 1) : new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        group.add(mesh);
      }
    }
  }
  return group;
}

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
  /**
   * The finished frame at the scene's size, drawn only while the frame has more lines
   * than the screen (`shrinking`): the finishing pass writes here instead of the canvas,
   * and the present pass shrinks it onto the canvas (render/presentshader.ts). Eight-bit,
   * display-encoded, no depth: exactly what the canvas would have held. 1x1 otherwise,
   * which Three never allocates while nothing draws into it.
   */
  private readonly frameTarget: THREE.WebGLRenderTarget;
  private readonly presentScene = new THREE.Scene();
  private readonly presentMaterial: THREE.ShaderMaterial;
  /** The scene frame, texels: what the scene and the finishing pass are drawn at. */
  private readonly sceneSize = new THREE.Vector2(1, 1);
  /** Whether the frame is taller than the canvas's device pixels and is shrunk onto it. */
  private shrinking = false;
  /** Frame lines per screen line; 0 on the retro rung. Decides FXAA (`applyFxaa`). */
  private supersample = 1;
  /**
   * The device pixels the canvas covers, from a `device-pixel-content-box` observer,
   * which is exact where `clientWidth x devicePixelRatio` is not at a fractional ratio;
   * 0 until it reports, or where the browser has no such box (Safari), and then the
   * product is rounded instead.
   */
  private observedDeviceWidth = 0;
  private observedDeviceHeight = 0;
  private readonly canvasObserver: ResizeObserver | null;
  /** Dev switch for the heat shimmer and mirage (pause menu); see `setHeatHaze`. */
  private heatHazeOn = true;
  /** Reused scratch for the camera's forward vector (horizon tracking). */
  private readonly _forward = new THREE.Vector3();
  /** Whether the cinema lens is on: cinema mode, set through `setCinema`. */
  private cinemaLens = false;
  /** The cinema lens's Panini strength; see `panini`. */
  private paniniStrength = DEFAULT_PANINI;
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
  /** `Settings.fxaa`, kept so a rung change can apply it (never on the retro rung). */
  private fxaa: boolean;
  /** `Settings.shadows`, kept so a rung change can apply it (phones may still force off). */
  private shadowMode: ShadowMode;
  /** Hand torch projected from the rendered eye; disabled rather than recreated. */
  private readonly torchLight: THREE.SpotLight;
  private readonly torchTarget = new THREE.Object3D();
  /** Reused 2D target for compact photographs; created only when the shutter fires. */
  private photoCanvas: HTMLCanvasElement | null = null;
  private photoContext: CanvasRenderingContext2D | null = null;
  /**
   * The driven car's live mirrors (render/carmirrors.ts): drawn after the game's frame,
   * inside its GPU timing, so the measured frame cost includes them like any other draw.
   */
  private mirrorPass: { draw(): void } | null = null;
  /**
   * The clouds' shadow map (render/clouds.ts): drawn before the scene pass, whose ground
   * reads it, and inside the GPU timing like the rest. Its programs are linked by
   * `waitForFrameShaders`, being in no scene the boot compile walks.
   */
  private cloudShadowPass: { draw(): void; compile(): Promise<unknown> } | null = null;

  private quality: GraphicsQuality;
  private readonly timerQueryGl: WebGL2RenderingContext | null;
  private readonly timerQueryExt: GpuTimerQueryExtension | null;
  private readonly pendingGpuQueries: PendingGpuQuery[] = [];
  private queryEligible = false;
  /** Exponential mean of the admitted GPU durations, ms; null since the last reset. */
  private gpuAverageMs: number | null = null;
  /** Admitted GPU samples since the last resolution change, discarded ones included. */
  private gpuSamples = 0;

  constructor(
    canvas: HTMLCanvasElement,
    quality: GraphicsQuality = 'standard',
    fxaa = true,
    inkStrength = DEFAULT_INK_STRENGTH,
    private readonly mobilePresentation = prefersMobilePresentation(),
    /**
     * `Settings.frameScale`; a lab without the setting draws the screen. The retro rung
     * ignores it for `retroLines`.
     */
    private frameScale: FrameScale = 1,
    fieldOfView = DEFAULT_FIELD_OF_VIEW,
    /** `Settings.shadows`; a lab without the setting draws its rung's default. */
    shadowMode: ShadowMode = shadowModeDefault(quality),
  ) {
    this.quality = quality;
    this.fxaa = fxaa;
    this.shadowMode = shadowMode;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // NOT antialiased. Every rung draws scene pixels into `hazeTarget`; the
      // antialiasing, where the player wants it, is FXAA in the fullscreen pass. A
      // multisampled backbuffer would allocate and resolve an image that cannot differ
      // by one pixel after that pass.
      antialias: false,
      // Never ask a phone for its highest-performance configuration. On a desktop this
      // hint picks the discrete GPU, which is what it is for; on a phone there is only
      // one GPU, and asking for maximum performance is asking the driver and the power
      // governor for clocks the game does not need and the device cannot shed. The game
      // wants a phone that stays cool, and says so.
      powerPreference: this.mobilePresentation ? 'default' : 'high-performance',
    });
    primeMaxAnisotropy(this.renderer);
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
    this.applyRetroCanvas();
    this.renderer.shadowMap.enabled =
      shadowModeFor(shadowMode, quality, this.mobilePresentation) !== 'off';
    // PCFSoft's wider kernel costs extra texture taps for a blur that reads as
    // noise at this shadow resolution; plain PCF is visually near-identical and
    // materially cheaper on a low-end iGPU.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Shadow-only casters (`SHADOW_ONLY_LAYER`). Three tests a caster's layers against the
    // VIEWING camera's in the shadow pass too, and builds the frame's draw lists before
    // that pass runs. So the layer is on for the shadow pass alone: a mesh on it alone
    // casts every shadow-casting light's shadow and is in no draw list of any picture,
    // the mirrors' included (they draw no shadow pass).
    const shadowMap = this.renderer.shadowMap;
    const drawShadows = shadowMap.render.bind(shadowMap);
    shadowMap.render = (lights, scene, camera) => {
      camera.layers.enable(SHADOW_ONLY_LAYER);
      try {
        drawShadows(lights, scene, camera);
      } finally {
        camera.layers.disable(SHADOW_ONLY_LAYER);
      }
    };
    // No Three tone mapping: the display transform is the fullscreen pass's own
    // (render/displaytransform.ts), applied once to the whole frame. Every scene material
    // renders into a target, where Three neither tone-maps nor encodes, and the pass is
    // the only material drawn to the canvas, where Three adds the sRGB encode.
    this.renderer.toneMapping = THREE.NoToneMapping;
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

    // Weather's share only, retuned per frame (render/airfog.ts has the clear air).
    this.fog = new THREE.FogExp2(0xd8c39a, 0);
    setAirFogEdge(CAMERA_FAR);
    this.scene.fog = this.fog;

    // Every tier renders into this colour-and-depth target, then uses the fullscreen
    // pass for the display transform, authored colour, ink and
    // FXAA. Acceptable suppresses only the haze warp; standard and blessing sample the
    // depth so nearby geometry never inherits a horizon-shaped screen mask.
    //
    // LINEAR HDR (`sceneTargetType`): the scene's radiance, unclipped, so the sun's disc,
    // a lamp lens and glinting paint keep their excess for the tone curve to roll off.
    //
    // NOT MULTISAMPLED. Four samples were the costliest line of the frame for what they
    // did: the target has a depth texture the pass reads, so every frame resolved colour
    // AND depth from four samples, at up to 4800x2700 on Blessing on top of its
    // supersampling. FXAA (`Settings.fxaa`) works on the shaded picture in the pass that
    // already reads it.
    const hazeDepth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    hazeDepth.minFilter = THREE.NearestFilter;
    hazeDepth.magFilter = THREE.NearestFilter;
    const sceneType = sceneTargetType(this.renderer);
    this.hazeTarget = new THREE.WebGLRenderTarget(1, 1, { depthTexture: hazeDepth, type: sceneType });
    if (sceneType === THREE.UnsignedByteType) this.hazeTarget.texture.colorSpace = THREE.SRGBColorSpace;

    this.hazeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.hazeMaterial = new THREE.ShaderMaterial({
      vertexShader: HAZE_VERTEX,
      fragmentShader: HAZE_FRAGMENT,
      // Page-lifetime, like the rung itself: the retro finish's ordered dither onto a
      // short palette (render/hazeshader.ts).
      defines: retroActive() ? { RETRO: '', RETRO_LEVELS: RETRO_LEVELS.toFixed(1) } : {},
      // Drawn to the canvas, so Three's output encode is sRGB: `toDisplay` in the shader
      // applies the tone curve, then that encode (`linearToOutputTexel`).
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.hazeTarget.texture },
        tDepth: { value: this.hazeTarget.depthTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
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
        uPanini: { value: 0 },
        uCameraNear: { value: CAMERA_NEAR },
        uCameraFar: { value: CAMERA_FAR },
        uInkStrength: { value: Math.min(1, Math.max(0, inkStrength)) },
        uInkThreshold: { value: INK_THRESHOLD },
        uFxaa: { value: fxaa && quality !== 'retro' ? 1 : 0 },
        uEncodeOutput: { value: 0 },
        uViewTint: { value: new THREE.Color(1, 1, 1) },
        uViewTintStrength: { value: 0 },
        uBinoculars: { value: 0 },
        uCameraViewfinder: { value: 0 },
        uWallM: { value: -1 },
        uDustInside: { value: 0 },
        uWindDir: { value: new THREE.Vector2(1, 0) },
        uWallPan: { value: 0 },
        uWallTime: { value: 0 },
        uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color(1, 1, 1) },
        uWallAir: { value: new THREE.Color(1, 1, 1) },
        uGradeSat: { value: 1 },
        uContrast: { value: DISPLAY_CONTRAST },
        uVeil: { value: 0 },
        uDustAlbedo: { value: WALL_DUST.value },
        uSandVeil: { value: SAND_VEIL.value },
        uAirThick: { value: 0 },
        uFogDensity: { value: 0 },
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

    // The frame target and the present pass: see `frameTarget` and render/presentshader.ts.
    // Nearest and unmipped because the present pass reads it texel by texel.
    this.frameTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.presentMaterial = new THREE.ShaderMaterial({
      vertexShader: PRESENT_VERTEX,
      fragmentShader: PRESENT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tFrame: { value: this.frameTarget.texture },
        uFrameSize: { value: new THREE.Vector2(1, 1) },
        uScale: { value: new THREE.Vector2(1, 1) },
      },
    });
    const presentMesh = new THREE.Mesh(this.hazeGeometry, this.presentMaterial);
    presentMesh.frustumCulled = false;
    this.presentScene.add(presentMesh);

    // Retuned with the vehicle lamps (render/vehiclelights.ts `LAMP_EXPOSURE`): 150 was
    // authored against the old linear-encoded frame.
    this.torchLight = new THREE.SpotLight(0xffedbd, 52, 65, 0.32, 0.58, 1.7);
    this.torchLight.visible = false;
    this.torchLight.castShadow = false;
    this.torchLight.target = this.torchTarget;
    this.scene.add(this.torchLight, this.torchTarget);


    // The window's resize event still drives it (a DPR change on a move between screens
    // arrives there everywhere); the observer adds the exact device-pixel size and the
    // layout changes no window event reports.
    this.canvasObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.observeCanvas);
    try {
      this.canvasObserver?.observe(this.renderer.domElement, { box: 'device-pixel-content-box' });
    } catch {
      this.canvasObserver?.observe(this.renderer.domElement);
    }
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.canvasObserver?.disconnect();
    this.disposeGpuQueries();
    this.hazeTarget.dispose();
    this.frameTarget.dispose();
    this.hazeMaterial.dispose();
    this.presentMaterial.dispose();
    this.hazeGeometry.dispose();
    this.scene.remove(this.torchLight, this.torchTarget);
    this.torchLight.dispose();
    this.renderer.dispose();
  }


  /**
   * Cinema mode's share of the frame: re-reads the canvas CSS viewport after the
   * letterbox has changed it (browser resizes already take the same path through the
   * window listener), and turns the Panini lens on or off with it.
   */
  setCinema(on: boolean): void {
    this.cinemaLens = on;
    this.resize();
  }

  /**
   * The cinema lens's Panini strength d, live: `__bro.renderer.panini = 0.5` in a dev
   * console. 0 is the plain rectilinear frame; outside cinema mode the value is kept
   * for the next time and the frame stays rectilinear. A uniform, never a program.
   */
  get panini(): number {
    return this.paniniStrength;
  }

  set panini(strength: number) {
    if (!Number.isFinite(strength)) return;
    this.paniniStrength = Math.max(0, strength);
    this.resizeHazeTarget();
  }

  /**
   * Waits until every program variant the live frame draws is ready — the scene pass,
   * the finishing pass both to the canvas and into the frame target (a render target is
   * a different program key: linear output), and the present pass — and the plain
   * shadow depth variants (`depthVariantSamples`) with them. Both finishing variants
   * always, because the player can move the frame past the screen's height from the
   * pause menu at any time.
   */
  async waitForFrameShaders(): Promise<void> {
    const sceneReady = this.compileForScenePass(this.scene);
    const depthReady = this.renderer.shadowMap.enabled
      ? this.compileShadowDepth(depthVariantSamples())
      : Promise.resolve();
    const previousTarget = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(this.frameTarget);
      const framedReady = this.renderer.compileAsync(this.hazeScene, this.hazeCamera);
      this.renderer.setRenderTarget(null);
      const postReady = this.renderer.compileAsync(this.hazeScene, this.hazeCamera);
      const presentReady = this.renderer.compileAsync(this.presentScene, this.hazeCamera);
      const shadeReady = this.cloudShadowPass?.compile();
      await Promise.all([sceneReady, depthReady, framedReady, postReady, presentReady, shadeReady]);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  /**
   * Compiles `object`'s programs exactly as the frame will draw them — the scene pass
   * against this scene's lights, fog and environment, into `hazeTarget`, and, where
   * shadows are on, the depth programs its casters take in the shadow passes — and
   * resolves when every one has linked. `object` need not be in the scene.
   *
   * The target is the point. The scene pass renders into `hazeTarget`, where Three
   * disables renderer tone mapping and uses the working colour space; compiled with
   * the default target, the same material builds a canvas-output program the frame
   * never draws, and the real one still links on first draw, on the main thread —
   * on a cold driver cache, after the loading cover had gone.
   *
   * The depth programs are the other half. Three links a caster's depth program the
   * first time a shadow pass draws it, and `compile` never touches them. By day the
   * sun's pass meets most of them under the loading cover; a drive resumed at night
   * has no sun pass, and the headlamp shadow (render/vehiclelights.ts) then linked
   * each depth variant as it first came into the beam — on ANGLE, a freeze.
   */
  compileForScenePass(object: THREE.Object3D): Promise<unknown> {
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.hazeTarget);
    try {
      const scene = this.renderer.compileAsync(object, this.camera, this.scene);
      if (!this.renderer.shadowMap.enabled) return scene;
      return Promise.all([scene, this.compileShadowDepth(object)]);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  /**
   * Long-lived depth materials, one per depth-program shape, that hold the shadow
   * depth programs compiled by `compileShadowDepth`. Three's shadow pass uses its own
   * private depth material; the program is shared by cache key, so these only have to
   * exist for the program to stay linked when the content that first needed it unloads.
   */
  private readonly shadowDepthHolders = new Map<string, THREE.MeshDepthMaterial>();

  /**
   * Links the depth program each caster in `object` will draw with in a shadow pass.
   *
   * The materials are the ones `WebGLShadowMap.getDepthMaterial` (three r185) would
   * hand the pass: the object's `customDepthMaterial`, or a depth material carrying the
   * source's shadow side (flipped, for PCF), alpha test, map and alpha map (handed over
   * whether or not alpha is tested), displacement. Each caster wears its depth material
   * for the one synchronous `compile` and gets its own back before this returns, so no
   * frame ever draws it so dressed. The object itself stays the one compiled —
   * instancing, skinning and morphs are in the program key. Compiled into `hazeTarget`:
   * like a shadow map, a render target, so no tone mapping and the working colour space.
   */
  private compileShadowDepth(object: THREE.Object3D): Promise<unknown> {
    const dressed: { mesh: THREE.Mesh; material: THREE.Mesh['material'] }[] = [];
    const depthFor = (material: THREE.Material): THREE.MeshDepthMaterial => {
      const alphaTest = material.alphaToCoverage ? 0.5 : material.alphaTest;
      const source = material as THREE.Material & {
        map?: THREE.Texture | null;
        alphaMap?: THREE.Texture | null;
        displacementMap?: THREE.Texture | null;
        displacementScale?: number;
      };
      const map = source.map ?? null;
      const alphaMap = source.alphaMap ?? null;
      const displacementMap = source.displacementMap && source.displacementScale !== 0 ? source.displacementMap : null;
      const side = material.shadowSide ?? PCF_SHADOW_SIDE[material.side];
      const key = `${side}|${alphaTest > 0}|${map?.channel ?? '-'}|${alphaMap?.channel ?? '-'}|${displacementMap?.channel ?? '-'}`;
      let depth = this.shadowDepthHolders.get(key);
      if (!depth) {
        depth = new THREE.MeshDepthMaterial();
        this.shadowDepthHolders.set(key, depth);
      }
      depth.side = side;
      depth.alphaTest = alphaTest;
      depth.map = map;
      depth.alphaMap = alphaMap;
      depth.displacementMap = displacementMap;
      return depth;
    };
    // Everything else in `object` is blanked for the call (`compile` skips a drawable
    // with no material): its scene-pass programs are compiled above, and compiling them
    // again here, fogless, would link variants the frame never draws.
    let casters = 0;
    object.traverse((child) => {
      const drawable = child as THREE.Mesh;
      if (!drawable.isMesh && !(child as THREE.Points).isPoints && !(child as THREE.Line).isLine && !(child as THREE.Sprite).isSprite) return;
      dressed.push({ mesh: drawable, material: drawable.material });
      if (!drawable.isMesh || !drawable.castShadow) {
        drawable.material = null as unknown as THREE.Material;
        return;
      }
      casters++;
      if (drawable.customDepthMaterial) drawable.material = drawable.customDepthMaterial;
      else drawable.material = Array.isArray(drawable.material) ? drawable.material.map(depthFor) : depthFor(drawable.material);
    });
    if (casters === 0) {
      for (const { mesh, material } of dressed) mesh.material = material;
      return Promise.resolve();
    }
    // The shadow pass draws with an empty scene: no fog. Fog is in the program key
    // (`fogExp2` and the fog flag) even for a depth material, so a depth program
    // compiled under this scene's fog is one the pass never uses. The lights stay:
    // the pass keeps the frame's light state, and the key carries the counts.
    const fog = this.scene.fog;
    this.scene.fog = null;
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.hazeTarget);
    try {
      return this.renderer.compileAsync(object, this.camera, this.scene);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.scene.fog = fog;
      for (const { mesh, material } of dressed) mesh.material = material;
      // The holders keep their programs, not the textures they were compiled with.
      for (const depth of this.shadowDepthHolders.values()) {
        depth.map = null;
        depth.alphaMap = null;
        depth.displacementMap = null;
      }
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
   * The scene frame for the current rung and canvas: the player's frame height, or on
   * the retro rung its own whole-pixel line count.
   */
  private frameSizeFor(canvas: CanvasPixels): { readonly width: number; readonly height: number } {
    // The retro rung's pixels are its look, so the frame height never moves them (see
    // render/retro.ts).
    if (this.quality === 'retro') {
      const ratio = retroPixelRatio(canvas.cssHeight, window.devicePixelRatio, this.retroLines);
      return {
        width: Math.max(1, Math.floor(canvas.cssWidth * ratio)),
        height: Math.max(1, Math.floor(canvas.cssHeight * ratio)),
      };
    }
    return sceneFrameSize(this.frameScale, screenLinesFor(this.quality, this.mobilePresentation), canvas);
  }

  /**
   * Nearest-neighbour upscaling of the canvas for the retro rung, done by the browser's
   * compositor: the scale is free and each drawing-buffer pixel lands as a crisp block.
   */
  private applyRetroCanvas(): void {
    this.renderer.domElement.style.imageRendering = this.quality === 'retro' ? 'pixelated' : '';
  }

  private observeCanvas = (entries: ResizeObserverEntry[]): void => {
    const box = entries[entries.length - 1]?.devicePixelContentBoxSize?.[0];
    this.observedDeviceWidth = box ? box.inlineSize : 0;
    this.observedDeviceHeight = box ? box.blockSize : 0;
    this.resize();
  };

  /**
   * Sizes the scene frame and the canvas.
   *
   * Up to the screen's own height the canvas IS the frame, as it always was: equal, or
   * smaller and scaled up by the compositor, which is free and as good as any upscale
   * this pass could afford at the screen's size. Past it, the canvas stays at the
   * screen's device pixels and the frame is shrunk onto it by `presentMaterial`, an
   * area average, instead of by the compositor's single bilinear tap (see
   * render/presentshader.ts for why that tap wasted most of a supersample). The retro
   * rung never shrinks: its frame is always coarser than the screen.
   *
   * The canvas is only re-sized when its size changes: assigning a canvas's width
   * clears it even to the same value, and the observer reports after the frame is drawn.
   */
  private resize = (): void => {
    const canvas = this.viewport();
    const frame = this.frameSizeFor(canvas);
    this.sceneSize.set(frame.width, frame.height);
    this.shrinking = this.quality !== 'retro' && frame.height > canvas.deviceHeight;
    this.supersample = this.quality === 'retro' ? 0 : frame.height / canvas.deviceHeight;
    this.applyFxaa();
    const width = this.shrinking ? canvas.deviceWidth : frame.width;
    const height = this.shrinking ? canvas.deviceHeight : frame.height;
    const element = this.renderer.domElement;
    if (element.width !== width || element.height !== height) {
      // Drawing-buffer pixels given directly at a ratio of 1: the frame and the screen are
      // both sized in device pixels here, and the CSS size is the layout's own.
      this.renderer.setDrawingBufferSize(width, height, 1);
    }
    this.resizeHazeTarget();

    this.camera.aspect = canvas.cssWidth / canvas.cssHeight;
    this.camera.updateProjectionMatrix();
  };

  render(): void {
    this.pollGpuQueries();
    const query = this.beginGpuTimerQuery();
    try {
      this.drawFrame();
      this.mirrorPass?.draw();
    } finally {
      if (query !== null) this.endGpuTimerQuery();
    }
  }

  /** The scene target's texel type, which a render target the scene shows (a mirror) shares. */
  get sceneTextureType(): THREE.TextureDataType {
    return this.hazeTarget.texture.type;
  }

  setMirrorPass(pass: { draw(): void } | null): void {
    this.mirrorPass = pass;
  }

  /** Installs the clouds' shadow map pass; see `cloudShadowPass`. Before `waitForFrameShaders`. */
  setCloudShadowPass(pass: Renderer['cloudShadowPass']): void {
    this.cloudShadowPass = pass;
  }

  /**
   * Draws the game's scene once more, from `camera` into `target`: a live mirror, right
   * after the frame. Every material keeps its program: any render target gives the same
   * key (working colour space, no tone mapping). The frame has just updated the scene's
   * world matrices and every shadow map, so this pass walks neither again, and it has no
   * post pass. Its draws add to the frame's `info` counters (reset once per frame).
   */
  renderMirror(target: THREE.WebGLRenderTarget, camera: THREE.Camera): void {
    const shadows = this.renderer.shadowMap;
    const autoUpdate = shadows.autoUpdate;
    const needsUpdate = shadows.needsUpdate;
    const matrices = this.scene.matrixWorldAutoUpdate;
    shadows.autoUpdate = false;
    shadows.needsUpdate = false;
    this.scene.matrixWorldAutoUpdate = false;
    try {
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.scene, camera);
    } finally {
      this.renderer.setRenderTarget(null);
      this.scene.matrixWorldAutoUpdate = matrices;
      shadows.autoUpdate = autoUpdate;
      shadows.needsUpdate = needsUpdate;
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

  /**
   * Draws one frame of the game through the two-pass frame. `scene` and `camera`
   * default to the game's own; an alternate pair is what `renderAlternate` passes for
   * the ending cutscene, which owns a scene of its own once the game loop has stopped.
   */
  private drawFrame(scene: THREE.Scene = this.scene, camera: THREE.PerspectiveCamera = this.camera): void {
    this.renderer.info.reset();
    // Real time, not game time: the strata climb at a flicker rate the eye knows,
    // which a time-scaled or paused game clock would slow or freeze. The phases are
    // integrated here in doubles and wrapped (see advanceHazePhase), so no uniform
    // grows with uptime and the float32 the shader holds never loses the pattern.
    const nowS = performance.now() * 0.001;
    const dt = this.hazeClockS < 0 ? 0 : Math.min(0.1, Math.max(0, nowS - this.hazeClockS));
    this.hazeClockS = nowS;
    const phase = this.hazeMaterial.uniforms.uHazePhase.value as THREE.Vector2;
    phase.set(
      advanceHazePhase(phase.x, dt, this.hazeBroadRiseHz),
      advanceHazePhase(phase.y, dt, this.hazeFineRiseHz),
    );
    this.hazeMaterial.uniforms.uHorizon.value = this.horizonScreenY(camera);
    this.hazeMaterial.uniforms.uEyeAbove.value = Math.max(
      this.hazeMinimumEyeHeight,
      this.hazeEyeHeight,
    );
    camera.updateWorldMatrix(true, false);
    (this.hazeMaterial.uniforms.uCameraRotation.value as THREE.Matrix3).setFromMatrix4(
      camera.matrixWorld,
    );
    this.hazeMaterial.uniforms.uTanHalfFov.value = Math.tan(
      THREE.MathUtils.degToRad(camera.fov) / 2,
    );
    this.hazeMaterial.uniforms.uCameraNear.value = camera.near;
    this.hazeMaterial.uniforms.uCameraFar.value = camera.far;
    // TWO PASSES ON EVERY TIER: scene radiance, then the display.
    //
    // Pass 1 renders into `hazeTarget`. Three writes the WORKING colour space (linear)
    // into a render target and applies no tone mapping there, so the target holds the
    // scene's linear radiance. Pass 2 does the haze, the dust and the veils on that
    // radiance, then maps it to the display exactly once — the renderer's tone operator
    // and the sRGB encode (`toDisplay` in render/hazeshader.ts) — and draws the grade,
    // the ink and the grain on the displayed picture. Acceptable keeps the pass and
    // drops the WARP (see `setHeatHaze`), which is where the cost was.
    //
    // A frame taller than the screen takes a third: pass 2 into `frameTarget`, then the
    // present pass shrinks it onto the canvas (see `resize`).
    //
    // Before both, the clouds' shadow map, for the game's own scene only: the ending
    // cutscene's ground does not read it.
    if (scene === this.scene) this.cloudShadowPass?.draw();
    this.renderer.setRenderTarget(this.hazeTarget);
    this.renderer.render(scene, camera);
    if (this.shrinking) {
      this.renderer.setRenderTarget(this.frameTarget);
      this.renderer.render(this.hazeScene, this.hazeCamera);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.presentScene, this.hazeCamera);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.hazeScene, this.hazeCamera);
    }
  }

  /**
   * Draws one frame of an ALTERNATE scene and camera through the same two-pass
   * frame — same post pass, same daylight, ink and heat uniforms.
   *
   * This exists for the ending cutscene: main.js has stopped its own loop by then, the
   * world's scene is left attached to `this.scene` and simply never drawn again, and
   * the beach is its own scene with its own sky and its own camera. The camera is
   * passed in rather than swapped into `this.camera` so the game's rig keeps the pose
   * it will never use again, and both scene and camera are the caller's to size (the
   * drawing buffer, pixel ratio and viewport stay this renderer's).
   */
  renderAlternate(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.pollGpuQueries();
    const query = this.beginGpuTimerQuery();
    try {
      this.drawFrame(scene, camera);
    } finally {
      if (query !== null) this.endGpuTimerQuery();
    }
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
  private horizonScreenY(camera: THREE.PerspectiveCamera = this.camera): number {
    camera.getWorldDirection(this._forward);
    const horizontal = Math.hypot(this._forward.x, this._forward.z);
    const pitch = Math.atan2(this._forward.y, horizontal);
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
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
   * veil. Deliberately separate from the heat: the two used to be
   * one number, so the mirage lab's heat slider re-graded the whole picture.
   */
  setDaylight(dayFactor: number): void {
    this.hazeMaterial.uniforms.uDaylight.value = Math.min(1, Math.max(0, dayFactor));
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
    const enabled = this.heatHazeOn && this.quality !== 'acceptable' && this.quality !== 'retro';
    this.hazeMaterial.uniforms.uStrength.value = enabled ? Math.min(1, Math.max(0, frame.shimmer)) : 0;
    this.hazeMaterial.uniforms.uMirage.value = enabled ? Math.min(1, Math.max(0, frame.mirage)) : 0;
    this.hazeEyeHeight = frame.eyeAboveM;
    this.hazeMaterial.uniforms.uGroundSlope.value = frame.groundSlope;
  }

  /**
   * The heat shimmer and the mirage, for a developer's A/B from the pause menu: off
   * is exactly the cheapest tier's pass, the field skipped on a uniform. Not a
   * setting, and not persisted.
   */
  get heatHaze(): boolean {
    return this.heatHazeOn;
  }

  set heatHaze(on: boolean) {
    this.heatHazeOn = on;
  }

  /**
   * The weather's share of the finishing pass: the approaching dust wall and the
   * grade's colour separation (world/weather.ts). `wallAlongM` is the camera's
   * absolute position across the wind, so the wall's crest stays put in the world.
   */
  setWeather(frame: {
    wallM: number;
    windX: number;
    windZ: number;
    wallAlongM: number;
    timeS: number;
    sunDirection: { x: number; y: number; z: number };
    sunColor: THREE.Color;
    air: THREE.Color;
    saturation: number;
    veil: number;
    airThick: number;
    /** The dust storm's own fog density (sky.dustFogDensity). */
    weatherFog: number;
    /** Inside the storm: the dust's density per metre from the camera (sky.dustSightFogDensity). */
    dustInside: number;
  }): void {
    const u = this.hazeMaterial.uniforms;
    u.uWallM.value = frame.wallM;
    u.uDustInside.value = frame.dustInside;
    (u.uWindDir.value as THREE.Vector2).set(frame.windX, frame.windZ);
    // One period of the crest noise (1100 m cells, 48 of them) so the uniform never
    // carries a road-sized number into f32.
    const period = 1100 * 48;
    u.uWallPan.value = frame.wallAlongM - period * Math.floor(frame.wallAlongM / period);
    u.uWallTime.value = frame.timeS % 2000;
    (u.uSunDirW.value as THREE.Vector3).set(frame.sunDirection.x, frame.sunDirection.y, frame.sunDirection.z);
    (u.uSunCol.value as THREE.Color).copy(frame.sunColor);
    (u.uWallAir.value as THREE.Color).copy(frame.air);
    u.uGradeSat.value = frame.saturation;
    u.uVeil.value = frame.veil;
    u.uAirThick.value = frame.airThick;
    u.uFogDensity.value = frame.weatherFog;
  }

  /**
   * Size the scene-pass target to the scene frame (`sceneSize`), the frame target with
   * it while the frame is shrunk onto the screen, and hand the lens its uniforms. The
   * cinema lens samples this same target: a 1.25x target under it was 1.56x the
   * scene's pixels, about 80% of the lens's cost (+1.35 ms in the cabin view on the M2
   * Pro), for a centre the lens magnifies past it; Catmull-Rom (render/hazeshader.ts
   * `sceneSample`) upscales that centre instead. Three's `setSize` is a no-op at an
   * unchanged size, so tuning the strength reallocates nothing.
   */
  private resizeHazeTarget(): void {
    const { x: width, y: height } = this.sceneSize;
    const uniforms = this.hazeMaterial.uniforms;
    this.hazeTarget.setSize(width, height);
    uniforms.uResolution.value.set(width, height);
    uniforms.uPanini.value = this.cinemaLens ? this.paniniStrength : 0;
    uniforms.uEncodeOutput.value = this.shrinking ? 1 : 0;
    // Back to 1x1 when not shrinking: `setSize` disposes the frame-sized texture, and
    // Three allocates the small one only if something draws into it.
    this.frameTarget.setSize(this.shrinking ? width : 1, this.shrinking ? height : 1);
    const canvas = this.renderer.domElement;
    (this.presentMaterial.uniforms.uFrameSize.value as THREE.Vector2).set(width, height);
    (this.presentMaterial.uniforms.uScale.value as THREE.Vector2).set(
      width / Math.max(1, canvas.width),
      height / Math.max(1, canvas.height),
    );
    setCleanFrameHeight(height);
  }

  // --- Resolution and GPU timing ---

  /** Pixels the scene is actually shaded at, both passes. */
  get renderedPixels(): number {
    return this.sceneSize.x * this.sceneSize.y;
  }

  /** The scene frame, pixels: what the scene and the finishing pass are shaded at. */
  get frameSize(): { readonly width: number; readonly height: number } {
    return { width: this.sceneSize.x, height: this.sceneSize.y };
  }

  /** The scene frame's height, lines; per-frame readers take this, which allocates nothing. */
  get frameHeight(): number {
    return this.sceneSize.y;
  }

  /**
   * The canvas's drawing buffer: the frame itself, or the screen's own device pixels
   * while a taller frame is shrunk onto them.
   */
  get presentedSize(): { readonly width: number; readonly height: number; readonly shrunk: boolean } {
    const canvas = this.renderer.domElement;
    return { width: canvas.width, height: canvas.height, shrunk: this.shrinking };
  }

  /** Whether this context can time the GPU. Without it `gpuFrameMs` stays null. */
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
   * Mean measured GPU duration of a frame, or null without timer queries or since the
   * last resolution change.
   *
   * Read by the on-device frame report, to say whether the frame is waiting on the GPU
   * or the CPU, which no other reading can separate on a phone; and by the launch, to
   * judge the rung (app/bootwarmup.ts).
   */
  get gpuFrameMs(): number | null {
    return this.gpuAverageMs;
  }

  /**
   * The newest single GPU frame time, ms — not the running average — for a live graph
   * (ui/perfoverlay.ts). Null until a timer query has completed.
   */
  get latestGpuMs(): number | null {
    return this.latestGpuMsValue;
  }
  private latestGpuMsValue: number | null = null;

  /**
   * Whether `gpuFrameMs` has seen enough frames at this resolution to stand for it: the
   * discarded straddling frames, then half a second of averaging.
   */
  get gpuTimeSettled(): boolean {
    return this.gpuSamples >= GPU_DISCARD_SAMPLES + GPU_SETTLE_SAMPLES;
  }

  /**
   * Whether the frame about to be drawn is a fair sample of the drive's GPU cost. Read
   * when its timer query begins, so a launch transient or an environment bake never
   * reaches the average.
   */
  setGpuTimingEligible(eligible: boolean): void {
    this.queryEligible = eligible;
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
      this.latestGpuMsValue = gpuMs;
      if (!pending.eligible) continue;
      this.gpuSamples += 1;
      if (this.gpuSamples <= GPU_DISCARD_SAMPLES) continue;
      this.gpuAverageMs = this.gpuAverageMs === null
        ? gpuMs
        : this.gpuAverageMs + (gpuMs - this.gpuAverageMs) * GPU_SAMPLE_WEIGHT;
    }
  }

  private disposeGpuQueries(): void {
    if (this.timerQueryGl !== null) {
      for (const { query } of this.pendingGpuQueries) {
        this.timerQueryGl.deleteQuery(query);
      }
    }
    this.pendingGpuQueries.length = 0;
  }

  /**
   * Installs the frame for the current rung, height and canvas, and forgets the GPU
   * average: it was measured at a pixel count that no longer applies. Only the drawing
   * buffer and the targets move; the canvas layout never does.
   */
  private applyResolution(): void {
    this.disposeGpuQueries();
    this.gpuAverageMs = null;
    this.gpuSamples = 0;
    this.resize();
  }

  /**
   * Switches the resolution tier in place. FXAA and shadows stay the player's choice;
   * only the retro rung, whose pixels are meant to show, never draws FXAA.
   */
  setQuality(quality: GraphicsQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.setFxaa(this.fxaa);
    this.applyRetroCanvas();
    // The phone rule is read from the table through `shadowModeFor`, never re-derived,
    // so it cannot disagree with the one the constructor used.
    this.applyShadowMode();
    this.applyResolution();
  }

  /** Installs the player's frame multiple (`Settings.frameScale`); no effect on the retro rung. */
  setFrameScale(scale: FrameScale): void {
    if (scale === this.frameScale) return;
    this.frameScale = scale;
    if (this.quality === 'retro') return;
    this.applyResolution();
  }

  /** Very Low's frame height, lines (`Settings.retroLines`); no effect on other rungs. */
  private retroLines: RetroLines = 360;

  /** Installs the player's Very Low line count; applies at once on that rung. */
  setRetroLines(lines: RetroLines): void {
    if (lines === this.retroLines) return;
    this.retroLines = lines;
    if (this.quality !== 'retro') return;
    this.applyResolution();
  }

  /**
   * The canvas the resolution policy is resolved against, for the menu and `resize`:
   * its CSS size and the device pixels it covers.
   *
   * The menu cannot read `window.innerWidth`: cinema mode shortens the CANVAS, not the
   * window, so the two disagree by 180 pixels exactly while it is on — and a readout
   * that claims a resolution the game is not rendering is the drift this whole control
   * exists to remove.
   */
  viewport(): CanvasPixels {
    const canvas = this.renderer.domElement;
    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    return {
      cssWidth,
      cssHeight,
      deviceWidth: this.observedDeviceWidth || Math.max(1, Math.round(cssWidth * dpr)),
      deviceHeight: this.observedDeviceHeight || Math.max(1, Math.round(cssHeight * dpr)),
    };
  }

  /**
   * `Settings.shadows`. Only Off against Near/Full toggles the shadow map, which
   * recompiles every lit program, as a rung change always has; Near against Full is the
   * sky's intensities and map updates (`Sky.setShadowMode`), so nothing recompiles.
   */
  setShadowMode(mode: ShadowMode): void {
    this.shadowMode = mode;
    this.applyShadowMode();
  }

  private applyShadowMode(): void {
    const enabled = shadowModeFor(this.shadowMode, this.quality, this.mobilePresentation) !== 'off';
    if (this.renderer.shadowMap.enabled !== enabled) this.renderer.shadowMap.enabled = enabled;
  }

  /**
   * `Settings.fxaa`: a uniform the pass branches on, so no program and no target change.
   * Never on the retro rung, and left off while the frame is supersampled by
   * `SUPERSAMPLE_WITHOUT_FXAA` or more, whatever the setting says.
   */
  setFxaa(enabled: boolean): void {
    this.fxaa = enabled;
    this.applyFxaa();
  }

  private applyFxaa(): void {
    const on = this.fxaa && this.quality !== 'retro' && this.supersample < SUPERSAMPLE_WITHOUT_FXAA;
    this.hazeMaterial.uniforms.uFxaa.value = on ? 1 : 0;
  }

  /**
   * `Settings.style`. Clean is uniforms only (render/cleanstyle.ts): the lit chunks'
   * switches and the small-scatter cull, so nothing recompiles and no target changes.
   */
  setStyle(style: VisualStyle): void {
    const clean = style === 'clean';
    setCleanStyle(clean);
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
    // The vista's outer ring is this same far plane (render/vista.ts).
    setAirFogEdge(far);
  }
}
