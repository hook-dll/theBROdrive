/**
 * TEMPORAL ANTIALIASING (`Settings.taa`; core/renderer.ts `drawFrame`).
 *
 * Every frame the scene camera's projection is nudged by a sub-pixel offset from a Halton
 * (2, 3) sequence (`TemporalAA.begin`), so over `TAA_SAMPLES` frames each pixel is shaded
 * at that many places inside itself. The resolve pass (`RESOLVE_FRAGMENT`) blends the
 * finished frame into a history carried from frame to frame, reprojected to where each
 * surface was the frame before, so a still edge converges to its coverage and stops
 * crawling as the camera moves.
 *
 * WHERE IT RUNS: after the finishing pass (render/hazeshader.ts), on its tone-mapped,
 * display-encoded picture, so the ink outlines, the grade and the weather are resolved
 * too; before FSR's EASU, which wants an antialiased input, and before RCAS, which takes
 * the softness off the result (the Sharpness setting).
 *
 * WHERE A PIXEL WAS. Two sources, per pixel of the nearest surface in its 3x3 (so a
 * moving silhouette carries its own motion onto the background beside it):
 *  - the world, from the depth and the two frames' cameras (`uViewToPrevClip`: the
 *    current view to the previous clip space, made in doubles on the CPU, so no
 *    kilometre-sized coordinate reaches f32);
 *  - the things that move by themselves (`trackMotion`: every vehicle, a trailer, the
 *    held item), from a motion pass (`VELOCITY_*`): their meshes drawn once more with
 *    their previous model matrices, writing the screen motion where the mesh IS the
 *    visible surface (its depth matches the scene's). The player's own car moves with
 *    the camera, so its motion on screen is the camera's own, and it stays sharp.
 *
 * WHAT IS KEPT of the history: clipped toward the current 3x3 neighbourhood's colour
 * spread in YCoCg (variance clipping, intersected with its min-max box), so a stale
 * colour cannot trail; and dropped where the surface the history held is not the one
 * reprojected there (the previous frame's distance, kept in the history's alpha), or the
 * pixel came from outside the frame. The history restarts on a camera cut (a jump of
 * `CUT_DISTANCE_M`), a stall (`MAX_GAP_MS`: a menu, a paused or hidden tab), an origin
 * rebase (`Renderer.resetTemporalHistory`), a resize and a switch.
 *
 * Programs: the resolve and the motion pass are one program each, whatever they draw (the
 * motion pass is a raw shader: its key carries no lights, fog or shadows), compiled at
 * boot (`TemporalAA.compile`).
 */
import * as THREE from 'three';
import { compileAsyncSafe } from './compileasync';

/** Jitter positions in one cycle. Sixteen: still edges converge to 1/16 steps of coverage. */
export const TAA_SAMPLES = 16;

/** Weight of the current frame in a still pixel: about the last ten frames make the picture. */
const BLEND_STILL = 0.1;
/** Weight of the current frame for a pixel moving `BLEND_MOVING_PX` or more a frame. */
const BLEND_MOVING = 0.2;
const BLEND_MOVING_PX = 24;
/** Variance clip width, standard deviations of the neighbourhood. */
const CLIP_GAMMA = 1.25;
/** A camera move this far in one frame is a cut (a teleport, a respawn, a rebase). */
const CUT_DISTANCE_M = 50;
/** A gap between TAA frames this long and the history is no longer this picture. */
const MAX_GAP_MS = 250;

function halton(index: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  for (let i = index; i > 0; i = Math.floor(i / base)) {
    result += (i % base) * fraction;
    fraction /= base;
  }
  return result;
}

/** Sub-pixel offsets, pixels in [-0.5, 0.5): x and y interleaved. Halton from index 1. */
const JITTER = new Float32Array(TAA_SAMPLES * 2);
for (let i = 0; i < TAA_SAMPLES; i++) {
  JITTER[i * 2] = halton(i + 1, 2) - 0.5;
  JITTER[i * 2 + 1] = halton(i + 1, 3) - 0.5;
}

// ---------------------------------------------------------------------------
// What moves by itself
// ---------------------------------------------------------------------------

/** Roots whose meshes the motion pass draws; an array, walked by index every frame. */
const motionRoots: THREE.Object3D[] = [];

/**
 * Registers `root` (a direct child of the game's scene) as moving by itself: its meshes
 * carry their own screen motion into the TAA resolve. Returns the disposer; call it when
 * the root leaves the scene for good.
 */
export function trackMotion(root: THREE.Object3D): () => void {
  motionRoots.push(root);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const at = motionRoots.indexOf(root);
    if (at >= 0) motionRoots.splice(at, 1);
  };
}

/** A mesh's world matrix this frame and the one before, for the motion pass. */
interface MotionEntry {
  readonly previous: THREE.Matrix4;
  readonly current: THREE.Matrix4;
  frame: number;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

/**
 * Depth-buffer value to view-space z (negative), for either depth convention. A uniform,
 * not a define: the programs' keys stay the same on either buffer.
 */
const VIEW_Z_GLSL = /* glsl */ `
  uniform float uReversedDepth;
  float viewZOf(float depth) {
    return uReversedDepth > 0.5
      ? (uCameraNear * uCameraFar) / ((uCameraNear - uCameraFar) * depth - uCameraNear)
      : (uCameraNear * uCameraFar) / ((uCameraFar - uCameraNear) * depth - uCameraFar);
  }
`;

/**
 * The motion pass, raw GLSL ES 3.0. `uMode`: 0 a mesh, 1 a skinned mesh (three's own
 * skinning, so the surface lands where the scene pass drew it), 2 anything else (drawn
 * nowhere). `projectionMatrix` is the jittered one the scene pass used; `uProjection`
 * and `uPrevProjection` are the unjittered current and previous ones.
 */
const VELOCITY_VERTEX = /* glsl */ `
  precision highp float;
  precision highp int;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform mat4 uProjection;
  uniform mat4 uPrevProjection;
  uniform mat4 uPrevModelView;
  uniform float uMode;
  uniform mat4 bindMatrix;
  uniform mat4 bindMatrixInverse;
  uniform highp sampler2D boneTexture;
  in vec3 position;
  in vec4 skinIndex;
  in vec4 skinWeight;
  out vec4 vClip;
  out vec4 vPrevClip;
  out float vViewZ;

  mat4 getBoneMatrix(const in float i) {
    int size = textureSize(boneTexture, 0).x;
    int j = int(i) * 4;
    int x = j % size;
    int y = j / size;
    vec4 v1 = texelFetch(boneTexture, ivec2(x, y), 0);
    vec4 v2 = texelFetch(boneTexture, ivec2(x + 1, y), 0);
    vec4 v3 = texelFetch(boneTexture, ivec2(x + 2, y), 0);
    vec4 v4 = texelFetch(boneTexture, ivec2(x + 3, y), 0);
    return mat4(v1, v2, v3, v4);
  }

  void main() {
    vec3 transformed = position;
    if (uMode > 1.5) {
      vClip = vec4(0.0, 0.0, 0.0, 1.0);
      vPrevClip = vClip;
      vViewZ = 0.0;
      gl_PointSize = 1.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    if (uMode > 0.5) {
      vec4 skinVertex = bindMatrix * vec4(transformed, 1.0);
      vec4 skinned = getBoneMatrix(skinIndex.x) * skinVertex * skinWeight.x;
      skinned += getBoneMatrix(skinIndex.y) * skinVertex * skinWeight.y;
      skinned += getBoneMatrix(skinIndex.z) * skinVertex * skinWeight.z;
      skinned += getBoneMatrix(skinIndex.w) * skinVertex * skinWeight.w;
      transformed = (bindMatrixInverse * skinned).xyz;
    }
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vClip = uProjection * mvPosition;
    vPrevClip = uPrevProjection * (uPrevModelView * vec4(transformed, 1.0));
    vViewZ = mvPosition.z;
  }
`;

/**
 * Writes (previous uv - current uv, previous view depth, 1) where this fragment is the
 * surface the scene pass left in the depth buffer, and nothing elsewhere: no depth buffer
 * of its own, the scene's depth decides. Glass and other surfaces that wrote no depth
 * pass nothing, so what shows through them keeps its own motion.
 */
const VELOCITY_FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp int;
  uniform highp sampler2D tDepth;
  uniform float uCameraNear;
  uniform float uCameraFar;
  in vec4 vClip;
  in vec4 vPrevClip;
  in float vViewZ;
  layout(location = 0) out highp vec4 outMotion;
  ${VIEW_Z_GLSL}

  void main() {
    float sceneDistance = -viewZOf(texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).x);
    float distance = -vViewZ;
    if (abs(sceneDistance - distance) > 0.02 + 0.01 * distance) discard;
    vec2 now = vClip.xy / vClip.w;
    vec2 before = vPrevClip.xy / vPrevClip.w;
    outMotion = vec4((before - now) * 0.5, vPrevClip.w, 1.0);
  }
`;

/**
 * The resolve: the finished frame (`tCurrent`, display-encoded, 8-bit) into the history
 * (`tHistory`, display-encoded, its alpha the distance each pixel held, log2(1 + m) / 16).
 * Drawn on the fullscreen triangle into the other history target.
 */
const RESOLVE_FRAGMENT = /* glsl */ `
  uniform sampler2D tCurrent;
  uniform sampler2D tHistory;
  uniform sampler2D tDepth;
  uniform sampler2D tVelocity;
  uniform vec2 uResolution;
  /** Current view space to the previous frame's clip space, unjittered. */
  uniform mat4 uViewToPrevClip;
  /** The unjittered projection's x and y scales and its off-centre terms. */
  uniform vec4 uProjection;
  uniform float uCameraNear;
  uniform float uCameraFar;
  /** 0 on the first frame after a cut: the history is not this picture. */
  uniform float uHistoryValid;
  /**
   * The cinema lens (render/hazeshader.ts \`paniniSource\`): the finished frame is the
   * scene image seen through Panini, so depth and motion are read where the lens looks
   * and the previous position is carried back through it. 0 is the plain frame.
   */
  uniform float uPanini;
  uniform float uTanHalfFov;
  ${VIEW_Z_GLSL}

  #define BLEND_STILL ${BLEND_STILL.toFixed(4)}
  #define BLEND_MOVING ${BLEND_MOVING.toFixed(4)}
  #define BLEND_MOVING_PX ${BLEND_MOVING_PX.toFixed(1)}
  #define CLIP_GAMMA ${CLIP_GAMMA.toFixed(3)}
  /** Allowed mismatch of the held and the expected distance, log2 units (about 7%). */
  #define DEPTH_SLACK 0.1

  vec3 toYCoCg(vec3 c) {
    return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
  }

  vec3 fromYCoCg(vec3 c) {
    float t = c.x - c.z;
    return vec3(t + c.y, c.x + c.z, t - c.y);
  }

  /** The history at \`uv\`, Catmull-Rom in five bilinear taps: a bilinear tap blurs it frame on frame. */
  vec3 historyTap(vec2 uv) {
    vec2 position = uv * uResolution;
    vec2 centre = floor(position - 0.5) + 0.5;
    vec2 f = position - centre;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 t0 = (centre - 1.0) / uResolution;
    vec2 t3 = (centre + 2.0) / uResolution;
    vec2 t12 = (centre + w2 / w12) / uResolution;
    float a = w12.x * w0.y;
    float b = w0.x * w12.y;
    float c = w12.x * w12.y;
    float d = w3.x * w12.y;
    float e = w12.x * w3.y;
    vec3 sum = texture2D(tHistory, vec2(t12.x, t0.y)).rgb * a
      + texture2D(tHistory, vec2(t0.x, t12.y)).rgb * b
      + texture2D(tHistory, t12).rgb * c
      + texture2D(tHistory, vec2(t3.x, t12.y)).rgb * d
      + texture2D(tHistory, vec2(t12.x, t3.y)).rgb * e;
    return max(sum / (a + b + c + d + e), vec3(0.0));
  }

  /** \`colour\` pulled along the line to the box's centre until it is inside the box. */
  vec3 clipToBox(vec3 colour, vec3 lo, vec3 hi) {
    vec3 centre = 0.5 * (hi + lo);
    vec3 extent = 0.5 * (hi - lo) + 1e-4;
    vec3 offset = colour - centre;
    vec3 reach = abs(offset / extent);
    float outside = max(reach.x, max(reach.y, reach.z));
    return outside > 1.0 ? centre + offset / outside : colour;
  }

  /** The lens's horizontal tangent and its screen scale (see \`paniniSource\`). */
  vec2 paniniFrame() {
    float tx = uTanHalfFov * uResolution.x / uResolution.y;
    float d = uPanini;
    float edge = atan(tx);
    return vec2(tx, (d + 1.0) * sin(edge) / (d + cos(edge)) / tx);
  }

  /** Screen uv to the scene image's uv through the lens: render/hazeshader.ts \`paniniSource\`. */
  vec2 paniniSource(vec2 uv) {
    vec2 frame = paniniFrame();
    float tx = frame.x;
    float d = uPanini;
    vec2 ndc = uv * 2.0 - 1.0;
    float x = ndc.x * tx * frame.y;
    float y = ndc.y * uTanHalfFov * frame.y;
    float k = x * x / ((d + 1.0) * (d + 1.0));
    float dscr = max(0.0, k * k * d * d - (k + 1.0) * (k * d * d - 1.0));
    float clon = (-k * d + sqrt(dscr)) / (k + 1.0);
    float s = (d + 1.0) / (d + clon);
    float lon = atan(x, s * clon);
    float lat = atan(y, s);
    vec2 plane = vec2(tan(lon), tan(lat) / cos(lon));
    return clamp(vec2(plane.x / tx, plane.y / uTanHalfFov) * 0.5 + 0.5, 0.0, 1.0);
  }

  /** The inverse: the scene image's uv to where the lens shows it on screen. */
  vec2 paniniScreen(vec2 source) {
    vec2 frame = paniniFrame();
    float tx = frame.x;
    float d = uPanini;
    vec2 plane = vec2((source.x * 2.0 - 1.0) * tx, (source.y * 2.0 - 1.0) * uTanHalfFov);
    float lon = atan(plane.x);
    float lat = atan(plane.y * cos(lon));
    float s = (d + 1.0) / (d + cos(lon));
    return vec2(s * sin(lon) / (tx * frame.y), s * tan(lat) / (uTanHalfFov * frame.y)) * 0.5 + 0.5;
  }

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 last = ivec2(uResolution) - 1;
    vec2 uv = (vec2(p) + 0.5) / uResolution;
    // Colour is the finished frame's own; depth and motion are the scene image's, which
    // the lens, when on, shows elsewhere on screen.
    vec2 sourceUv = uPanini > 0.0 ? paniniSource(uv) : uv;
    ivec2 sp = clamp(ivec2(sourceUv * uResolution), ivec2(0), last);
    vec3 sum = vec3(0.0);
    vec3 sumSquares = vec3(0.0);
    vec3 lo = vec3(1e9);
    vec3 hi = vec3(-1e9);
    vec3 centre = toYCoCg(texelFetch(tCurrent, p, 0).rgb);
    float nearest = texelFetch(tDepth, sp, 0).x;
    ivec2 nearestAt = sp;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 c = toYCoCg(texelFetch(tCurrent, clamp(p + ivec2(x, y), ivec2(0), last), 0).rgb);
        sum += c;
        sumSquares += c * c;
        lo = min(lo, c);
        hi = max(hi, c);
        ivec2 q = clamp(sp + ivec2(x, y), ivec2(0), last);
        float depth = texelFetch(tDepth, q, 0).x;
        bool nearer = uReversedDepth > 0.5 ? depth > nearest : depth < nearest;
        if (nearer) {
          nearest = depth;
          nearestAt = q;
        }
      }
    }
    float viewZ = viewZOf(nearest);
    vec4 motion = texelFetch(tVelocity, nearestAt, 0);
    vec2 prevUv;
    float expected;
    if (motion.a > 0.5) {
      prevUv = sourceUv + motion.xy;
      expected = motion.z;
    } else {
      vec2 ndc = sourceUv * 2.0 - 1.0;
      vec3 view = vec3((ndc + uProjection.zw) * -viewZ / uProjection.xy, viewZ);
      vec4 before = uViewToPrevClip * vec4(view, 1.0);
      prevUv = before.xy / before.w * 0.5 + 0.5;
      expected = before.w;
    }
    if (uPanini > 0.0) prevUv = paniniScreen(prevUv);
    float held = log2(1.0 + max(-viewZ, 0.0)) / 16.0;

    vec3 result = centre;
    bool inside = all(greaterThanEqual(prevUv, vec2(0.0))) && all(lessThanEqual(prevUv, vec2(1.0)));
    if (uHistoryValid > 0.5 && inside) {
      // Was the surface reprojected here the one the history held? The 2x2 the tap reads.
      ivec2 base = ivec2(floor(prevUv * uResolution - 0.5));
      float want = log2(1.0 + max(expected, 0.0));
      float hadLo = 1e9;
      float hadHi = -1e9;
      for (int y = 0; y <= 1; y++) {
        for (int x = 0; x <= 1; x++) {
          float had = texelFetch(tHistory, clamp(base + ivec2(x, y), ivec2(0), last), 0).a * 16.0;
          hadLo = min(hadLo, had);
          hadHi = max(hadHi, had);
        }
      }
      float miss = max(hadLo - want, want - hadHi);
      vec3 mean = sum / 9.0;
      vec3 sigma = sqrt(max(sumSquares / 9.0 - mean * mean, vec3(0.0)));
      vec3 history = clipToBox(
        toYCoCg(historyTap(prevUv)),
        max(lo, mean - CLIP_GAMMA * sigma),
        min(hi, mean + CLIP_GAMMA * sigma)
      );
      float speed = length((prevUv - uv) * uResolution);
      float blend = mix(BLEND_STILL, BLEND_MOVING, clamp(speed / BLEND_MOVING_PX, 0.0, 1.0));
      blend = mix(blend, 1.0, smoothstep(DEPTH_SLACK, 4.0 * DEPTH_SLACK, miss));
      result = mix(history, centre, blend);
    }
    gl_FragColor = vec4(clamp(fromYCoCg(result), 0.0, 1.0), held);
  }
`;

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/** The scene frame's TAA: its history, its motion pass, its jitter. Owned by core/renderer.ts. */
export class TemporalAA {
  /** Ping-pong history at the scene's size: display-encoded colour, distance in alpha. */
  private readonly history: readonly [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  /** The motion pass's output at the scene's size: uv motion, previous depth, coverage. */
  private readonly velocity: THREE.WebGLRenderTarget;
  private readonly resolveMaterial: THREE.ShaderMaterial;
  private readonly resolveScene = new THREE.Scene();
  private readonly velocityMaterial: THREE.RawShaderMaterial;
  /**
   * The motion pass's scene: its children are the shown motion roots this frame
   * (`motionList`), read in place, never re-parented, so their own parent stays the game's
   * scene. World matrices are the frame's own (no update walk).
   */
  private readonly velocityScene = new THREE.Scene();
  private readonly motionList: THREE.Object3D[] = [];
  private readonly motion = new WeakMap<THREE.Object3D, MotionEntry>();
  private readonly unjittered = new THREE.Matrix4();
  private readonly prevProjection = new THREE.Matrix4();
  private readonly prevView = new THREE.Matrix4();
  private readonly prevPosition = new THREE.Vector3();
  private readonly clearColor = new THREE.Color();
  private lastCamera: THREE.Camera | null = null;
  private lastTime = 0;
  private valid = false;
  private resetPending = true;
  private frame = 0;
  private sample = 0;
  private write = 0;
  private width = 1;
  private height = 1;

  constructor(
    type: THREE.TextureDataType,
    depth: THREE.DepthTexture,
    reversedDepth: boolean,
    private readonly triangle: THREE.BufferGeometry,
  ) {
    const historyTarget = (): THREE.WebGLRenderTarget => new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      type,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.history = [historyTarget(), historyTarget()];
    this.velocity = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    const reversed = reversedDepth ? 1 : 0;
    this.resolveMaterial = new THREE.ShaderMaterial({
      name: 'taa-resolve',
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: RESOLVE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tCurrent: { value: null },
        tHistory: { value: this.history[0].texture },
        tDepth: { value: depth },
        tVelocity: { value: this.velocity.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uViewToPrevClip: { value: new THREE.Matrix4() },
        uProjection: { value: new THREE.Vector4(1, 1, 0, 0) },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 1000 },
        uHistoryValid: { value: 0 },
        uReversedDepth: { value: reversed },
        uPanini: { value: 0 },
        uTanHalfFov: { value: 1 },
      },
    });
    const resolveMesh = new THREE.Mesh(triangle, this.resolveMaterial);
    resolveMesh.frustumCulled = false;
    this.resolveScene.add(resolveMesh);

    this.velocityMaterial = new THREE.RawShaderMaterial({
      name: 'taa-velocity',
      glslVersion: THREE.GLSL3,
      vertexShader: VELOCITY_VERTEX,
      fragmentShader: VELOCITY_FRAGMENT,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDepth: { value: depth },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 1000 },
        uProjection: { value: new THREE.Matrix4() },
        uPrevProjection: { value: this.prevProjection },
        uPrevModelView: { value: new THREE.Matrix4() },
        uMode: { value: 0 },
        uReversedDepth: { value: reversed },
      },
    });
    this.velocityMaterial.onBeforeRender = this.prepareMotion;
    this.velocityScene.overrideMaterial = this.velocityMaterial;
    this.velocityScene.matrixWorldAutoUpdate = false;
    this.velocityScene.children = this.motionList;
  }

  dispose(): void {
    this.history[0].dispose();
    this.history[1].dispose();
    this.velocity.dispose();
    this.resolveMaterial.dispose();
    this.velocityMaterial.dispose();
  }

  /** Sizes the targets to the scene frame (1x1 while TAA is off); a new size restarts the history. */
  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.history[0].setSize(width, height);
    this.history[1].setSize(width, height);
    this.velocity.setSize(width, height);
    (this.resolveMaterial.uniforms.uResolution.value as THREE.Vector2).set(width, height);
    this.reset();
  }

  /** Forgets the history: the next frame is drawn from itself alone. */
  reset(): void {
    this.resetPending = true;
  }

  /** The cinema lens's Panini strength the finished frame is drawn through; 0 for none. */
  setLens(panini: number): void {
    this.resolveMaterial.uniforms.uPanini.value = panini;
  }

  /**
   * Links both programs into the targets they draw to. The motion pass's key holds only
   * its shader (raw), so the one compile covers every mesh shape it meets.
   */
  compile(renderer: THREE.WebGLRenderer, camera: THREE.Camera): Promise<unknown> {
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(this.history[0]);
      const resolved = compileAsyncSafe(renderer, this.resolveScene, camera);
      renderer.setRenderTarget(this.velocity);
      const moved = compileAsyncSafe(renderer, new THREE.Mesh(this.triangle, this.velocityMaterial), camera);
      return Promise.all([resolved, moved]);
    } finally {
      renderer.setRenderTarget(previous);
    }
  }

  /**
   * Starts a TAA frame for `camera`: decides whether the history still holds, readies the
   * reprojection, and jitters the projection for the scene pass. `end` takes it back.
   */
  begin(camera: THREE.PerspectiveCamera, now: number): void {
    this.unjittered.copy(camera.projectionMatrix);
    const world = camera.matrixWorld.elements;
    const dx = world[12]! - this.prevPosition.x;
    const dy = world[13]! - this.prevPosition.y;
    const dz = world[14]! - this.prevPosition.z;
    const cut = this.resetPending
      || !this.valid
      || camera !== this.lastCamera
      || now - this.lastTime > MAX_GAP_MS
      || dx * dx + dy * dy + dz * dz > CUT_DISTANCE_M * CUT_DISTANCE_M;
    this.resetPending = false;
    // A skipped frame number makes every mesh's previous matrix its current one.
    this.frame += cut ? 2 : 1;
    if (cut) {
      this.prevProjection.copy(this.unjittered);
      this.prevView.copy(camera.matrixWorldInverse);
    }
    const u = this.resolveMaterial.uniforms;
    u.uHistoryValid.value = cut ? 0 : 1;
    (u.uViewToPrevClip.value as THREE.Matrix4)
      .multiplyMatrices(this.prevProjection, this.prevView)
      .multiply(camera.matrixWorld);
    const p = this.unjittered.elements;
    (u.uProjection.value as THREE.Vector4).set(p[0]!, p[5]!, p[8]!, p[9]!);
    u.uCameraNear.value = camera.near;
    u.uCameraFar.value = camera.far;
    u.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const v = this.velocityMaterial.uniforms;
    (v.uProjection.value as THREE.Matrix4).copy(this.unjittered);
    v.uCameraNear.value = camera.near;
    v.uCameraFar.value = camera.far;

    const at = (this.sample++ % TAA_SAMPLES) * 2;
    const projection = camera.projectionMatrix.elements;
    projection[8]! += JITTER[at]! * 2 / this.width;
    projection[9]! += JITTER[at + 1]! * 2 / this.height;
  }

  /**
   * The motion pass, right after the scene pass and with its jittered camera: every shown
   * motion root in `scene`, into the velocity target (cleared to "no motion of its own").
   * Then the camera's projection is put back.
   */
  drawMotion(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const list = this.motionList;
    list.length = 0;
    for (let i = 0; i < motionRoots.length; i++) {
      const root = motionRoots[i]!;
      if (root.visible && root.parent === scene) list.push(root);
    }
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.velocity);
    if (list.length === 0) {
      renderer.clear(true, false, false);
    } else {
      const shadows = renderer.shadowMap;
      const autoUpdate = shadows.autoUpdate;
      const needsUpdate = shadows.needsUpdate;
      shadows.autoUpdate = false;
      shadows.needsUpdate = false;
      try {
        renderer.render(this.velocityScene, camera);
      } finally {
        shadows.autoUpdate = autoUpdate;
        shadows.needsUpdate = needsUpdate;
      }
    }
    list.length = 0;
    renderer.setClearColor(this.clearColor, clearAlpha);
    camera.projectionMatrix.copy(this.unjittered);
  }

  /** Per mesh in the motion pass: its previous model-view and its shape. */
  private readonly prepareMotion = (
    _renderer: THREE.WebGLRenderer,
    _scene: THREE.Scene,
    _camera: THREE.Camera,
    _geometry: THREE.BufferGeometry,
    object: THREE.Object3D,
  ): void => {
    const mesh = object as THREE.Mesh;
    const u = this.velocityMaterial.uniforms;
    const skip = !mesh.isMesh
      || (object as THREE.InstancedMesh).isInstancedMesh === true
      || (object as THREE.BatchedMesh).isBatchedMesh === true;
    u.uMode.value = skip ? 2 : (object as THREE.SkinnedMesh).isSkinnedMesh === true ? 1 : 0;
    if (!skip) {
      let entry = this.motion.get(object);
      if (!entry) {
        entry = { previous: new THREE.Matrix4(), current: new THREE.Matrix4(), frame: -1 };
        this.motion.set(object, entry);
      }
      // Once per frame (a multi-material mesh is drawn once per group).
      if (entry.frame !== this.frame) {
        if (entry.frame === this.frame - 1) entry.previous.copy(entry.current);
        else entry.previous.copy(object.matrixWorld);
        entry.current.copy(object.matrixWorld);
        entry.frame = this.frame;
      }
      (u.uPrevModelView.value as THREE.Matrix4).multiplyMatrices(this.prevView, entry.previous);
    }
    this.velocityMaterial.uniformsNeedUpdate = true;
  };

  /**
   * Resolves `current` (the finished frame) into the history and returns the result's
   * texture; then keeps this frame's camera for the next one.
   */
  resolve(renderer: THREE.WebGLRenderer, current: THREE.Texture, camera: THREE.PerspectiveCamera, hazeCamera: THREE.Camera, now: number): THREE.Texture {
    const read = this.history[this.write ^ 1];
    const written = this.history[this.write];
    const u = this.resolveMaterial.uniforms;
    u.tCurrent.value = current;
    u.tHistory.value = read.texture;
    renderer.setRenderTarget(written);
    renderer.render(this.resolveScene, hazeCamera);
    this.write ^= 1;
    this.prevProjection.copy(this.unjittered);
    this.prevView.copy(camera.matrixWorldInverse);
    this.prevPosition.setFromMatrixPosition(camera.matrixWorld);
    this.lastCamera = camera;
    this.lastTime = now;
    this.valid = true;
    return written.texture;
  }
}
