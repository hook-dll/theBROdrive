import * as THREE from 'three';
import { AdaptiveResolutionController } from './adaptivequality';
import type { GraphicsQuality } from '../game/settings';

/**
 * Renderer, scene and camera ownership.
 *
 * The far plane and fog are set up for the far-orbit camera: zooming out to a few
 * hundred metres means the horizon must still resolve, so the far plane is 4 km and
 * fog is exponential rather than linear. Linear fog over that range either erases
 * the middle distance or leaves the horizon looking like a flat card.
 */

/**
 * Far-plane floor in metres. The sky dome (DOME_RADIUS = 3000 in render/sky.ts)
 * and the far-orbit camera (DIST_MAX = 300 in render/cameras.ts) both need at
 * least this much reach, so `setViewDistance` never drops below it: the drawn
 * horizon may shrink, but the dome and the orbit arm must keep resolving.
 */
export const CAMERA_FAR = 4000;
/**
 * Near-plane floor in metres. As close as geometry may come to the hood camera
 * without being clipped — the in-car eye rides on the nose of the car (see
 * VIEW_CAR in vehicle/carmodels.ts), so the bonnet passes just beneath it.
 * `setViewDistance` only ever raises this, never lowers it.
 */
export const CAMERA_NEAR = 0.08;

/**
 * How far the free-look orbit camera may stand from the car (DIST_MAX in
 * render/cameras.ts). The far plane is measured from the camera, not the car,
 * so it must clear the draw distance by at least this much or the orbit camera
 * clips the far edge of the desert it can still see past the car.
 */
const ORBIT_MARGIN = 300;

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
 * Internal-resolution scale relative to the display's native backing resolution.
 *
 * The previous implementation used `min(devicePixelRatio, tierCap)`. That can
 * never exceed native DPR, so Standard and Blessing were literally identical on
 * common DPR-1 and DPR-1.25 displays. Tiers are multipliers instead:
 * Acceptable is visibly cheaper, Standard is native, Blessing is 2x per axis.
 */
const PIXEL_RATIO_SCALE: Record<GraphicsQuality, number> = {
  acceptable: 0.6,
  standard: 1,
  blessing: 2,
};
/** Absolute guard against pathological browser DPR values and oversized targets. */
const MAX_PIXEL_RATIO: Record<GraphicsQuality, number> = {
  acceptable: 1,
  standard: 2,
  blessing: 3,
};
/**
 * Four samples was the only useful multisampling level in measurement: 2x retained
 * almost all of the cost. Whether it is enabled is an independent display setting;
 * graphics tiers control resolution and shadows.
 */
const MSAA_SAMPLES = 4;
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
 * Animation speed multiplier. Heat shimmer must move slowly enough to read as a
 * local, rising disturbance rather than a current flowing across the landscape.
 * The individual cell rises still differ below; this only slows their shared clock.
 */
const HAZE_SPEED = 0.28;

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
/**
 * Ground distance, metres, at which the shimmer begins. Nothing closer than this
 * shimmers at all.
 *
 * This used to be two screen-space numbers — a 0.3-screen-height exponential below
 * the horizon and a 0.22 fade at the very bottom — and screen space is the wrong
 * space for it. A band 30% of the frame tall reaches right down onto ground a few
 * metres from the bumper, so near rocks, the verge and the car's own bonnet all
 * boiled, which is not what hot air does: you are looking at them through a couple
 * of metres of it, not a couple of hundred.
 *
 * Below the horizon a screen row IS a ground distance — a ray depressed by atan(h/D)
 * from an eye h above the ground lands at distance D — so the onset can be stated in
 * metres and converted per frame from the camera's own height and field of view (see
 * `groundCutUv`). At a 2 m eye and a 50 degree vertical field that puts the cut about
 * 2% of the frame below the horizon, which is why real shimmer reads as a thin
 * unstable strip in the far distance rather than a wobbling lens over everything.
 */
const HAZE_MIN_DISTANCE_M = 100;
/**
 * Screen-height scale over which the warp CELLS grow and speed up below the horizon.
 * Purely a texture variation so the frame does not shimmer in lockstep like one sheet
 * of glass, and deliberately not tied to the distance cut above: it is about the look
 * of the cells, not about where the effect applies.
 */
const HAZE_CELL_DEPTH_SCALE = 0.3;

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
  uniform float uGroundCut;
  uniform float uCellDepth;
  uniform float uInkStrength;
  uniform float uInkThreshold;

  varying vec2 vUv;

  /**
   * Weight of the hot-air layer at a screen row.
   *
   * ABOVE the horizon a sight-line climbs out of the shallow hot layer almost at
   * once, so the sky is nearly still: a fast exponential decay.
   *
   * BELOW the horizon the screen row is a ground DISTANCE, and that is what this now
   * keys on. uGroundCut is the row at which the ground is HAZE_MIN_DISTANCE_M away,
   * computed per frame from the camera's height and field of view, so everything
   * nearer than that fades to nothing. The previous version decayed over a fixed
   * fraction of the frame instead, which reached down onto ground a few metres away
   * and boiled the verge and the bonnet along with the horizon.
   */
  float hotLayer(float y) {
    float d = y - uHorizon;
    if (d > 0.0) return exp(-d / uSkyFalloff);
    return 1.0 - smoothstep(uGroundCut * 0.25, uGroundCut, -d);
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
    // The warp is skipped outright when the shimmer is off — a uniform branch, so
    // every fragment in the draw takes the same side and the trig below is simply
    // not issued. That is what lets the cheapest tier keep this pass for its
    // outlines and its colour handling without paying for heat haze.
    vec2 uv = vUv;
    if (uStrength > 0.0) {
      // Cells are smaller and churn faster close to the ground, and the long
      // sight-lines near the horizon stack more of them along one ray. Scaling with
      // depth stops the whole frame shimmering in lockstep like one sheet of glass.
      float groundness = clamp((uHorizon - vUv.y) / uCellDepth, 0.0, 1.0);
      float scale = mix(1.0, 1.3, groundness);
      vec2 warp = hazeWarp(vUv * scale, uTime * mix(1.0, 1.25, groundness));
      // Rising air bends a sight-line up and down far more than sideways; the
      // horizontal term only exists so columns do not look like a venetian blind.
      warp.x *= 0.25;
      vec2 offset = warp * uStrength * hotLayer(vUv.y) * (uAmplitude / uResolution.y);
      uv = clamp(vUv + offset, 0.0, 1.0);
    }
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
  /** Scene-pass target; the fullscreen pass samples this texture outside acceptable. */
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
   * Camera height above the ground, metres, for the haze distance cut. Defaulted to a
   * standing eye so the very first frame is sensible before the loop has supplied one.
   */
  private hazeEyeHeight = 1.6;


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
      powerPreference: 'high-performance',
    });
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
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.shadowMap.enabled = quality !== 'acceptable';
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

    // Standard and Blessing render into this target, then a fullscreen pass warps
    // and copies it back. Acceptable keeps it at 1×1 and bypasses the pass.
    // The independent MSAA setting decides geometry-edge samples for those tiers.
    this.hazeTarget = new THREE.WebGLRenderTarget(1, 1, {
      samples: msaa ? MSAA_SAMPLES : 0,
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
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uAmplitude: { value: HAZE_AMPLITUDE_PX },
        uHorizon: { value: 0.5 },
        uSkyFalloff: { value: HAZE_SKY_FALLOFF },
        uGroundCut: { value: 0.02 },
        uCellDepth: { value: HAZE_CELL_DEPTH_SCALE },
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
    this.disposeGpuQueries();
    this.hazeTarget.dispose();
    this.hazeMaterial.dispose();
    this.hazeGeometry.dispose();
    this.renderer.dispose();
  }


  private pixelRatioFor(quality: GraphicsQuality): number {
    return Math.min(
      window.devicePixelRatio * PIXEL_RATIO_SCALE[quality],
      MAX_PIXEL_RATIO[quality],
    );
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
    this.pollGpuQueries();
    const query = this.beginGpuTimerQuery();
    try {
      this.hazeMaterial.uniforms.uTime.value = performance.now() * 0.001 * HAZE_SPEED;
      this.hazeMaterial.uniforms.uHorizon.value = this.horizonScreenY();
      this.hazeMaterial.uniforms.uGroundCut.value = this.groundCutUv();
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
      // (see `setHazeStrength`), which is where the cost actually was.
      this.renderer.setRenderTarget(this.hazeTarget);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.hazeScene, this.hazeCamera);
    } finally {
      if (query !== null) this.endGpuTimerQuery();
    }
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
   * Screen offset below the horizon, in UV, at which the ground is
   * HAZE_MIN_DISTANCE_M away. Everything below that row is nearer than the onset and
   * gets no shimmer.
   *
   * A ray depressed by `theta` from an eye `h` above the ground meets it at
   * `D = h / tan(theta)`, so the onset angle is `atan(h / D)` and its screen offset is
   * that angle's tangent measured against the half-field's. Linearising about the
   * horizon like this is exact enough for a stylised effect and, unlike a depth
   * texture, costs nothing and survives multisampling — which is the same reason the
   * ink pass works off colour gradients (see `inkEdge`).
   *
   * The eye height is clamped to a floor because the camera can legitimately sit
   * below the ground it is looking at, on a crest or inside a dip, and a zero or
   * negative height would collapse the band to nothing and switch the effect off.
   */
  private groundCutUv(): number {
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const h = Math.max(0.4, this.hazeEyeHeight);
    return 0.5 * (h / HAZE_MIN_DISTANCE_M) / Math.tan(halfFov);
  }

  /**
   * How far the camera is above the ground it is looking across, metres. Supplied by
   * the composition root, which is the only thing that knows both the camera and the
   * terrain; the renderer converts it into the distance cut above.
   */
  setHazeEyeHeight(metres: number): void {
    this.hazeEyeHeight = metres;
  }

  /**
   * Heat-haze strength, clamped to 0..1, and always zero on the cheapest tier.
   *
   * The warp is the expensive half of this pass — layered trig per pixel — while
   * the outlines are four taps and the copy is one. Acceptable pays the copy and
   * the outlines, which is what the drawn look is made of, and skips the shimmer:
   * at zero strength the shader branches past the warp on a uniform every fragment
   * agrees on, so the branch is free.
   */
  setHazeStrength(strength: number): void {
    const wanted = this.quality === 'acceptable' ? 0 : strength;
    this.hazeMaterial.uniforms.uStrength.value = Math.min(1, Math.max(0, wanted));
  }

  /** Size the scene-pass target to the actual drawing buffer (CSS size × pixel ratio). */
  private resizeHazeTarget(): void {
    this.renderer.getDrawingBufferSize(this._drawSize);
    this.hazeTarget.setSize(this._drawSize.x, this._drawSize.y);
    this.hazeMaterial.uniforms.uResolution.value.set(this._drawSize.x, this._drawSize.y);
  }


  // --- Adaptive resolution ---

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
    this.renderer.shadowMap.enabled = quality !== 'acceptable';
    this.basePixelRatio = this.pixelRatioFor(quality);
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.resizeHazeTarget();
  }

  /** Changes scene-target multisampling without changing resolution quality. */
  setMsaa(enabled: boolean): void {
    const samples = enabled ? MSAA_SAMPLES : 0;
    if (this.hazeTarget.samples === samples) return;
    this.hazeTarget.samples = samples;
    // Multisampling is allocation state; Three recreates the target on next bind.
    this.hazeTarget.dispose();
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
    const far = Math.max(CAMERA_FAR, metres + ORBIT_MARGIN);
    this.camera.far = far;
    this.camera.near = Math.max(CAMERA_NEAR, far / MAX_DEPTH_RATIO);
    this.camera.updateProjectionMatrix();
  }
}
