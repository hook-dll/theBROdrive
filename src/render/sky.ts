import * as THREE from 'three';
import { DAY_LENGTH } from '../game/state';
import { skyGradientAt } from '../world/gradient';
import { hash01 } from '../core/rng';

/**
 * Analytic sky: an inverted sphere with a custom ShaderMaterial, a single
 * shadow-casting sun (dim cool moon by night), deterministic hash-seeded stars,
 * a galactic band and an anachronistic aurora that only exists late in the run.
 *
 * Everything drifts with `s` through `skyGradientAt`: the change is slow enough
 * that a player doubts the sky ever looked different, but km 900 is unmistakably
 * not km 9.
 *
 * The dome shader runs the same tone-mapping + colour-space pipeline as the rest
 * of the scene, so its horizon colour and the `FogExp2` colour (also linear,
 * also tone-mapped by the standard material path) coincide exactly: distant
 * terrain dissolves into the sky instead of a grey band.
 */

// ---------------------------------------------------------------------------
// Placement constants
// ---------------------------------------------------------------------------

/**
 * Dome radius. It has to sit OUTSIDE the terrain's draw distance, not level with
 * it: the dome is re-centred on the camera every frame and drawn as a solid
 * inside-out sphere, so ground further from the camera than this gets occluded by
 * it — and since terrain chunks stretch far up and down the road, that showed as a
 * hard curved edge cutting across the distant desert. 3 km clears the 1.5 km
 * lateral reach plus a couple of chunks of road, and still sits inside the 4 km far
 * plane.
 */
const DOME_RADIUS = 3000;
/** Stars sit just inside the dome so they layer over the gradient, not behind it. */
const STAR_RADIUS = DOME_RADIUS * 0.93;
/** Aurora curtains live in front of the stars, well inside the dome. */
const AURORA_DISTANCE = 800;
/** Offset of the directional light along its direction; brackets the shadow frustum. */
const SUN_DISTANCE = 240;

/** Sun elevation (radians) below this counts as night for headlight/lamp logic. */
const NIGHT_ELEVATION = -0.08;

/**
 * Shadow length control, because a physically correct low sun draws nonsense.
 *
 * A shadow's length is the caster's height over tan(elevation), so at 3 degrees a
 * 1.7 m player throws a 32 m shadow and a car throws sixty metres of dark smear —
 * far larger than the thing casting it, streaked across the whole foreground, and
 * blurred by the shadow map's 18 cm texels into an unreadable blob. That is the
 * "shadow is sometimes enormous" everyone notices around dawn and dusk.
 *
 * Two limits, in preference order:
 *
 *  - The shadow-casting DIRECTION never drops below SHADOW_MIN_ELEVATION, while the
 *    sun's own position, colour and disc stay exactly where they were. Shadows keep
 *    pointing the right way and stop growing past about four times the caster's
 *    height. Cheating the direction rather than the light is what preserves the
 *    golden-hour colour and the raking shading that make the hour worth having.
 *  - Below SHADOW_FADE_ELEVATION the shadows fade out entirely (three's
 *    `shadow.intensity`), so the last of the mismatch between a clamped shadow and a
 *    horizon sun disappears into dusk instead of standing out in it.
 */
const SHADOW_MIN_ELEVATION = 0.26;
const SHADOW_FADE_ELEVATION = 0.12;

/**
 * The sun's great circle is tilted this far off the east-west vertical plane, so
 * the noon sun sits south of the zenith rather than dead overhead — northern
 * hemisphere long-shadow feel, and it keeps the light from pointing straight down.
 */
const SOUTH_TILT = 0.45;

/** Matches renderer.ts's starting density; the gradient's haze multiplies it. */
const BASE_FOG_DENSITY = 0.00035;

/**
 * 14k stars: still one draw call and still a dense field, thinned back from 20k
 * because at that count the sky was closer to a texture than to a sky.
 */
const STAR_COUNT = 14000;
/**
 * Star size: min, max, and how sharply size is weighted toward the small end.
 *
 * The knee this replaces only capped the top of the range, it did not make the top
 * RARE — measured on the built buffer, 24% of stars still landed in the largest
 * bucket, because brightness itself is only squared and 31% of the field sits above
 * the knee. So the map is convex instead: size = min + range · b^exponent, which
 * leaves the great majority of stars near the floor and thins the tail properly.
 *
 * At exponent 2.5 the field comes out ~1.2 px for a typical star, ~6% above 2.3 px,
 * and a hard maximum of 2.6 px — down from 3.65 px originally and 2.96 px at the
 * knee. A big star is now something to notice rather than the texture of the sky.
 */
const STAR_SIZE_MIN = 1.15;
const STAR_SIZE_MAX = 2.6;
const STAR_SIZE_EXPONENT = 2.5;
/** Seed for the star field. Fixed so the sky is identical every session. */
const STAR_SEED = 0x5ca11ab1;
/**
 * Fraction of stars that get a real colour instead of white. Kept this low
 * deliberately: a night sky reads as white, and a coloured star is meant to be a
 * find. Split red / yellow / green inside the branch below.
 */
const STAR_TINTED_FRACTION = 0.01;
/** Fraction of stars that scintillate at all; the rest are rock steady. */
const STAR_TWINKLE_FRACTION = 0.3;
/** Scintillation amplitude range, as a fraction of the star's own brightness. */
const STAR_TWINKLE_MIN = 0.1;
const STAR_TWINKLE_MAX = 0.34;
/**
 * The galactic plane is deliberately NOT thinned with the field: the band is what
 * makes the sky look like a galaxy seen edge-on, and it reads as dust rather than
 * as stars. Leaving it dense while the field came down 30% lets it stand out more.
 */
const BAND_CANDIDATES = 45000;
/** Half-width of the band in `dot(dir, normal)` space (~7.5 degrees). */
const BAND_HALF_WIDTH = 0.13;

// ---------------------------------------------------------------------------
// Palette (authored as sRGB hex; THREE converts to linear working space)
// ---------------------------------------------------------------------------

const C_DAY_ZENITH = new THREE.Color().setStyle('#4d8ede');
const C_DAY_HORIZON = new THREE.Color().setStyle('#d7e5f3');
const C_NIGHT_ZENITH = new THREE.Color().setStyle('#03040a');
const C_NIGHT_HORIZON = new THREE.Color().setStyle('#0d1424');
const C_SUN_LOW = new THREE.Color().setStyle('#ffb166');
const C_SUN_HIGH = new THREE.Color().setStyle('#fff7ec');
const C_SUNSET = new THREE.Color().setStyle('#ff6a38');
const C_TURBID = new THREE.Color().setStyle('#c9b18c');
const C_MOON = new THREE.Color().setStyle('#a9c6e6');
const C_GROUND = new THREE.Color().setStyle('#d8a45c'); // warm ochre sand bounce
const C_NIGHT_GROUND = new THREE.Color().setStyle('#0a0c14');

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;

void main() {
  // The dome is centred on the camera, so local position is the world offset
  // from the camera: normalising it gives the view ray direction directly.
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunGlowColor;
uniform float uSunGlowIntensity;
uniform float uMoonAmount;

varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, 0.0, 1.0);

  // Zenith-to-horizon gradient; the pow keeps most of the blue band high.
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.62));

  // Sun disc plus a broad additive glow (a Rayleigh-ish halo that reads as
  // atmospheric scatter without pulling in a full scattering model).
  float sd = dot(dir, uSunDir);
  float disc = smoothstep(0.99925, 0.99975, sd);
  float glow = pow(max(sd, 0.0), 6.0) * 0.45 + pow(max(sd, 0.0), 48.0) * 1.5;
  col += uSunColor * disc * 2.0;
  col += uSunGlowColor * glow * uSunGlowIntensity;

  // Moon: a dim cool disc opposite the sun, faded in only at night.
  float md = dot(dir, uMoonDir);
  float mdisc = smoothstep(0.99955, 0.99985, md);
  col += vec3(0.66, 0.74, 0.94) * mdisc * uMoonAmount * 0.6;

  gl_FragColor = vec4(col, 1.0);

  // Match the scene's ACES + sRGB output exactly, so this horizon colour and
  // the fog colour (set from the same linear value) are pixel-identical.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Linear-radiance twin of SKY_FRAGMENT, used only for the environment probe.
 *
 * The visible dome ends with `tonemapping_fragment` + `colorspace_fragment` so it
 * matches the scene's ACES + sRGB output exactly. An environment map must carry
 * *linear radiance* instead: feeding it display-referred sRGB would tonemap the
 * sky once into the probe and again when the reflection is shaded, which reads as
 * washed-out, low-contrast chrome. Derived by deleting those two includes from
 * the one source above, so the gradient, sun disc and glow can never drift apart.
 */
const SKY_FRAGMENT_LINEAR = SKY_FRAGMENT
  .replace('#include <tonemapping_fragment>', '')
  .replace('#include <colorspace_fragment>', '');

/**
 * Sun-elevation change, radians, that forces an environment rebake. A bake is a
 * cubemap render plus the roughness convolution — far too costly per frame — and
 * the dome's appearance is a function of sun elevation alone, so stepping the
 * probe gives ~70 bakes across a full day/night cycle with no visible stepping
 * in the reflections.
 */
const ENV_BAKE_STEP = 0.03;

/** Shared by the star field and the galactic band (band passes uDens01 = 1). */
const STAR_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aBright;
attribute float aThresh;
attribute vec3 aColor;
attribute float aTwinkle;
attribute float aPhase;
uniform float uPixelRatio;
uniform float uTime;
varying float vBright;
varying float vThresh;
varying vec3 vColor;
varying float vTwinkle;

void main() {
  vColor = aColor;
  vBright = aBright;
  vThresh = aThresh;

  // Scintillation. Two incommensurate sines so it never settles into a visible
  // pulse, and it modulates SIZE as well as brightness: the brightest stars are
  // already clipped at full alpha, so on those the size is the only channel with
  // anywhere left to go. aTwinkle is zero for most stars.
  float ph = aPhase * 6.2831853;
  float shimmer = 0.62 * sin(uTime * 2.30 + ph) + 0.38 * sin(uTime * 3.70 + ph * 1.7);
  vTwinkle = 1.0 + aTwinkle * shimmer;

  gl_PointSize = aSize * uPixelRatio * (1.0 + 0.35 * aTwinkle * shimmer);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STAR_FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform float uDens01;
varying float vBright;
varying float vThresh;
varying vec3 vColor;
varying float vTwinkle;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float mask = smoothstep(1.0, 0.0, dot(c, c));

  // Density fades each star in past its own threshold rather than rebuilding
  // the buffer: at starDensity 1 only the bright ones show, at 4.5 all do.
  float vis = smoothstep(vThresh - 0.08, vThresh + 0.08, uDens01);
  float a = min(1.0, vBright * vTwinkle * 1.75 * vis * uOpacity * mask);
  if (a < 0.004) discard;

  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

const AURORA_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 p = position;
  // Two incommensurate sines make the curtain drift sideways and breathe,
  // slowly enough that it never loops visibly within a session.
  float w = sin(p.y * 0.020 + uTime * 0.30 + uPhase * 6.2831853)
          + 0.55 * sin(p.y * 0.046 - uTime * 0.19 + uPhase * 3.1415927);
  p.x += w * 16.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const AURORA_FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  // Vertically-faded: hangs brightest in its lower half, gone at both edges.
  float vertical = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
  float stripe = 0.62 + 0.38 * sin(vUv.x * 22.0 + vUv.y * 9.0);
  float a = vertical * stripe * uOpacity;
  if (a < 0.004) discard;

  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Uniform direction on a Fibonacci sphere. Deterministic, evenly distributed. */
function fibonacciDir(i: number, n: number, out: THREE.Vector3): THREE.Vector3 {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  return out.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

export class Sky {
  private readonly scene: THREE.Scene;
  private readonly fog: THREE.FogExp2;

  /** Everything that must track the camera: dome, stars, band, aurora. */
  private readonly root = new THREE.Group();

  private readonly dome: THREE.Mesh;
  private readonly starPoints: THREE.Points;
  private readonly bandPoints: THREE.Points;
  private readonly auroraGroup = new THREE.Group();
  private readonly auroraGeometry: THREE.PlaneGeometry;
  private readonly auroraMaterials: THREE.ShaderMaterial[] = [];
  private readonly auroraUniforms: { uTime: { value: number }; uOpacity: { value: number } }[] = [];

  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;

  // --- Environment probe: what makes metal read as metal (see refreshEnvironment) ---
  private readonly pmrem: THREE.PMREMGenerator;
  /** Holds one dome, sharing the visible dome's uniforms, shaded in linear space. */
  private readonly envScene = new THREE.Scene();
  private readonly envMaterial: THREE.ShaderMaterial;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /** Sun elevation the live probe was baked at. NaN forces a bake on frame one. */
  private envBakedElevation = Number.NaN;

  // --- Dome shader uniforms (typed references; mutated in place each frame) ---
  private readonly uSunDir = new THREE.Vector3(0, 1, 0);
  private readonly uMoonDir = new THREE.Vector3(0, -1, 0);
  private readonly uZenith = new THREE.Color();
  private readonly uHorizon = new THREE.Color();
  private readonly uSunColor = new THREE.Color();
  private readonly uSunGlowColor = new THREE.Color();
  private readonly uSunGlowIntensity = { value: 0 };
  private readonly uMoonAmount = { value: 0 };

  // --- Star / band uniforms ---
  private readonly uStarOpacity = { value: 0 };
  private readonly uStarDens = { value: 0 };
  private readonly uBandOpacity = { value: 0 };
  /**
   * Shared by the star field and the band, so both scintillate on one clock. Wraps
   * well inside float precision; the shimmer is two sines and cannot tell.
   */
  private readonly uStarTime = { value: 0 };

  // --- Scratch state, reused every frame (no allocation in the hot path) ---
  private readonly _sunDir = new THREE.Vector3();
  private readonly _lightDir = new THREE.Vector3();
  /** Light direction with its elevation clamped, for the shadow camera only. */
  private readonly _shadowDir = new THREE.Vector3();
  private readonly _targetPos = new THREE.Vector3();
  private readonly _zenith = new THREE.Color();
  private readonly _horizon = new THREE.Color();
  private readonly _sunColor = new THREE.Color();
  private readonly _sunGlow = new THREE.Color();
  private readonly _lightColor = new THREE.Color();
  private readonly _hemiSky = new THREE.Color();
  private readonly _hemiGround = new THREE.Color();
  private readonly _dir = new THREE.Vector3();

  private sunElevation = -1.0; // radians; starts below the horizon (night)

  constructor(scene: THREE.Scene, fog: THREE.FogExp2, webgl: THREE.WebGLRenderer) {
    this.scene = scene;
    this.fog = fog;
    this.pmrem = new THREE.PMREMGenerator(webgl);

    // --- Sky dome ---
    const domeGeometry = new THREE.SphereGeometry(DOME_RADIUS, 48, 24);
    const domeMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uSunDir: { value: this.uSunDir },
        uMoonDir: { value: this.uMoonDir },
        uZenith: { value: this.uZenith },
        uHorizon: { value: this.uHorizon },
        uSunColor: { value: this.uSunColor },
        uSunGlowColor: { value: this.uSunGlowColor },
        uSunGlowIntensity: this.uSunGlowIntensity,
        uMoonAmount: this.uMoonAmount,
      },
      side: THREE.BackSide,
      // The sky is the backdrop: draw first, never write depth, never test it,
      // so opaque geometry simply paints over it.
      depthWrite: false,
      depthTest: false,
    });
    this.dome = new THREE.Mesh(domeGeometry, domeMaterial);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.root.add(this.dome);

    // --- Environment probe dome: same geometry and uniform objects as the
    // visible dome, so the probe tracks the time of day for free. Only the
    // fragment shader differs (linear radiance, see SKY_FRAGMENT_LINEAR).
    this.envMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT_LINEAR,
      uniforms: domeMaterial.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    const envDome = new THREE.Mesh(domeGeometry, this.envMaterial);
    envDome.frustumCulled = false;
    this.envScene.add(envDome);

    // --- Stars ---
    this.starPoints = this.buildStars();
    this.root.add(this.starPoints);

    // --- Galactic band ---
    this.bandPoints = this.buildBand();
    this.root.add(this.bandPoints);

    // --- Aurora ---
    this.auroraGeometry = new THREE.PlaneGeometry(220, 130, 20, 6);
    this.buildAurora();
    this.auroraGroup.visible = false; // absent until the gradient's aurora > 0
    this.root.add(this.auroraGroup);

    // --- Sun / moon directional light ---
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sunLight.castShadow = true;
    const shadow = this.sunLight.shadow;
    // 1024 on iGPU-class hardware: the 180 m frustum still resolves ~17 cm/texel,
    // and the renderer's PCF filter softens the larger texels into a stylised
    // blur. 2048 doubles the depth-pass fill cost for detail that never reads at
    // this camera scale.
    shadow.mapSize.set(1024, 1024);
    shadow.camera.near = 40;
    shadow.camera.far = SUN_DISTANCE + 300;
    shadow.camera.left = -90;
    shadow.camera.right = 90;
    shadow.camera.top = 90;
    shadow.camera.bottom = -90;
    shadow.bias = -0.0004;
    shadow.normalBias = 0.05;
    shadow.camera.updateProjectionMatrix();
    scene.add(this.sunLight);
    // The target must be in the scene graph for its matrixWorld to update.
    scene.add(this.sunLight.target);

    // --- Hemisphere bounce ---
    this.hemiLight = new THREE.HemisphereLight(0x88b4e6, 0xd8a45c, 1.0);
    scene.add(this.hemiLight);

    scene.add(this.root);
  }

  /** Deterministic star field: same sky every session, no stream RNG. */
  private buildStars(): THREE.Points {
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const brights = new Float32Array(STAR_COUNT);
    const thresholds = new Float32Array(STAR_COUNT);
    const twinkles = new Float32Array(STAR_COUNT);
    const phases = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
      fibonacciDir(i, STAR_COUNT, this._dir);
      // Small jitter breaks the Fibonacci spiral's visible seam.
      this._dir.x += (hash01(STAR_SEED, i, 0) - 0.5) * 0.03;
      this._dir.y += (hash01(STAR_SEED, i, 1) - 0.5) * 0.03;
      this._dir.z += (hash01(STAR_SEED, i, 2) - 0.5) * 0.03;
      this._dir.normalize();

      positions[i * 3] = this._dir.x * STAR_RADIUS;
      positions[i * 3 + 1] = this._dir.y * STAR_RADIUS;
      positions[i * 3 + 2] = this._dir.z * STAR_RADIUS;

      // Power-weighted brightness: a few dominant stars over many faint ones.
      const b = Math.pow(hash01(STAR_SEED, i, 3), 2.0) * 0.85 + 0.15;
      brights[i] = b;
      // Bright stars appear at low density; faint ones fill in as it rises.
      thresholds[i] = 1.0 - b;
      sizes[i] =
        STAR_SIZE_MIN + (STAR_SIZE_MAX - STAR_SIZE_MIN) * Math.pow(b, STAR_SIZE_EXPONENT);

      // Colour. Almost every star is white with only a hint of blue in it — the
      // eye reads a night sky as white, and the previous split (28% of the field
      // strongly warm or strongly blue) made it read as confetti. The hint varies
      // per star so the field is not one flat colour.
      const t = hash01(STAR_SEED, i, 4);
      if (t < 1 - STAR_TINTED_FRACTION) {
        const blue = hash01(STAR_SEED, i, 7);
        colors[i * 3] = 0.94 + blue * 0.05;
        colors[i * 3 + 1] = 0.96 + blue * 0.035;
        colors[i * 3 + 2] = 1.0;
      } else {
        // The rare ones, and they are rare on purpose: a red supergiant or a
        // yellow giant is a landmark you learn the sky by, not a texture.
        const pick = (t - (1 - STAR_TINTED_FRACTION)) / STAR_TINTED_FRACTION;
        if (pick < 0.4) {
          colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.55; colors[i * 3 + 2] = 0.42;
        } else if (pick < 0.8) {
          colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.84; colors[i * 3 + 2] = 0.52;
        } else {
          colors[i * 3] = 0.66; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 0.74;
        }
      }

      // Scintillation is atmospheric, so it belongs to stars seen through the most
      // air: amplitude scales with how near the horizon a star sits, and only a
      // minority get any at all. The rest are steady, which is what makes the ones
      // that do shimmer read as shimmering.
      const horizon = 1 - Math.abs(this._dir.y);
      twinkles[i] =
        hash01(STAR_SEED, i, 5) < STAR_TWINKLE_FRACTION
          ? STAR_TWINKLE_MIN +
            (STAR_TWINKLE_MAX - STAR_TWINKLE_MIN) * hash01(STAR_SEED, i, 8) * horizon
          : 0;
      phases[i] = hash01(STAR_SEED, i, 6);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(brights, 1));
    geometry.setAttribute('aThresh', new THREE.BufferAttribute(thresholds, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uOpacity: this.uStarOpacity,
        uDens01: this.uStarDens,
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uTime: this.uStarTime,
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  /** Faint additive band of denser points for the galactic plane. */
  private buildBand(): THREE.Points {
    const normal = new THREE.Vector3(0.42, 0.78, 0.46).normalize();
    const kept: number[] = [];
    for (let i = 0; i < BAND_CANDIDATES; i++) {
      fibonacciDir(i, BAND_CANDIDATES, this._dir);
      const d = this._dir.x * normal.x + this._dir.y * normal.y + this._dir.z * normal.z;
      if (Math.abs(d) < BAND_HALF_WIDTH) kept.push(this._dir.x, this._dir.y, this._dir.z);
    }

    const count = kept.length / 3;
    const positions = new Float32Array(kept.length);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const brights = new Float32Array(count);
    const thresholds = new Float32Array(count);
    const twinkles = new Float32Array(count);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const dx = kept[i * 3], dy = kept[i * 3 + 1], dz = kept[i * 3 + 2];
      positions[i * 3] = dx * STAR_RADIUS;
      positions[i * 3 + 1] = dy * STAR_RADIUS;
      positions[i * 3 + 2] = dz * STAR_RADIUS;

      brights[i] = 0.18 + hash01(STAR_SEED, 0x1, i) * 0.32;
      thresholds[i] = 0; // always shown while the band's opacity is non-zero
      sizes[i] = 1.0 + hash01(STAR_SEED, 0x2, i) * 1.2;
      // Faint blue-white dust with a little warmth mixed in.
      colors[i * 3] = 0.7 + hash01(STAR_SEED, 0x3, i) * 0.15;
      colors[i * 3 + 1] = 0.78 + hash01(STAR_SEED, 0x4, i) * 0.12;
      colors[i * 3 + 2] = 1.0;
      // The band shares the star shader, so it must carry the same attributes.
      // A gentle shimmer on a third of the dust makes the plane look grainy and
      // alive rather than printed on.
      twinkles[i] = hash01(STAR_SEED, 0x5, i) < 0.33 ? 0.12 : 0;
      phases[i] = hash01(STAR_SEED, 0x6, i);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(brights, 1));
    geometry.setAttribute('aThresh', new THREE.BufferAttribute(thresholds, 1));
    geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uOpacity: this.uBandOpacity,
        uDens01: { value: 1 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uTime: this.uStarTime,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  /** A few large additive curtain quads. Shared geometry; one material each so phases differ. */
  private buildAurora(): void {
    const palette = [
      new THREE.Color().setStyle('#35ffa8'),
      new THREE.Color().setStyle('#3dff9a'),
      new THREE.Color().setStyle('#55e0ff'),
      new THREE.Color().setStyle('#7a7dff'),
      new THREE.Color().setStyle('#3dffb0'),
    ];
    const count = palette.length;

    for (let k = 0; k < count; k++) {
      const uniforms = {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uPhase: { value: k / count },
        uColor: { value: palette[k] },
      };
      const material = new THREE.ShaderMaterial({
        vertexShader: AURORA_VERTEX,
        fragmentShader: AURORA_FRAGMENT,
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

      const mesh = new THREE.Mesh(this.auroraGeometry, material);

      // Spread curtains in an arc across the sky, alternating elevation.
      const az = -1.1 + (k / (count - 1)) * 2.2;
      const el = 0.5 + (k % 2) * 0.22;
      const cosEl = Math.cos(el);
      mesh.position.set(
        AURORA_DISTANCE * Math.sin(az) * cosEl,
        AURORA_DISTANCE * Math.sin(el),
        AURORA_DISTANCE * Math.cos(az) * cosEl,
      );
      // Plane normal (+Z) points back toward the camera at the origin.
      mesh.rotation.y = az + Math.PI;

      this.auroraGroup.add(mesh);
      this.auroraMaterials.push(material);
      this.auroraUniforms.push(uniforms);
    }
  }

  update(timeOfDay: number, s: number, cameraX: number, cameraY: number, cameraZ: number): void {
    const g = skyGradientAt(s);

    const dayFrac = (((timeOfDay % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH;
    const phase = (dayFrac - 0.25) * Math.PI * 2;
    const eastWest = Math.cos(phase);
    const upDown = Math.sin(phase);

    // Toward-sun direction on the tilted great circle (unit by construction).
    this._sunDir.set(
      eastWest,
      upDown * Math.cos(SOUTH_TILT),
      -upDown * Math.sin(SOUTH_TILT),
    );
    this.sunElevation = Math.asin(this._sunDir.y);

    // Day/night factors.
    const day = smoothstep(-0.12, 0.3, this.sunElevation);
    const night = smoothstep(0.02, -0.4, this.sunElevation);
    // 1 while the sun is near the horizon, widening with dust (longer sunsets).
    const sunset = 1 - smoothstep(0.02, 0.4 + 0.55 * g.dust, Math.abs(this.sunElevation));

    // --- Sky colours ---
    // Zenith: day blue, nudged away from familiar blue by skyHueShift, fading to
    // night navy. The 0.5 scale keeps the hue drift perceptible only by recall.
    this._zenith.copy(C_DAY_ZENITH)
      .offsetHSL(g.skyHueShift * 0.5, 0.02, 0.0)
      .lerp(C_NIGHT_ZENITH, night);

    // Horizon: day/night base, warm sunset glow (reddened by dust), then a
    // dust-driven turbid tan so the horizon mutes as the air thickens.
    this._horizon.copy(C_DAY_HORIZON).lerp(C_NIGHT_HORIZON, night);
    this._horizon.lerp(C_SUNSET, sunset * (0.45 + 0.55 * g.dust));
    this._horizon.lerp(C_TURBID, g.dust * 0.35 * day);

    // Sun disc: warm at low angle, white overhead.
    this._sunColor.copy(C_SUN_LOW).lerp(C_SUN_HIGH, smoothstep(0.0, 0.55, this.sunElevation));
    this._sunGlow.copy(C_SUNSET);
    const sunGlowIntensity =
      sunset * (0.9 + 1.6 * g.dust) + smoothstep(0.0, 0.6, this.sunElevation) * 0.22;

    // --- Fog tracks the horizon so distant terrain melts into the sky ---
    this.fog.color.copy(this._horizon);
    this.fog.density = BASE_FOG_DENSITY * g.haze;

    // --- Dome uniforms ---
    this.uSunDir.copy(this._sunDir);
    this.uMoonDir.set(-this._sunDir.x, -this._sunDir.y, -this._sunDir.z);
    this.uZenith.copy(this._zenith);
    this.uHorizon.copy(this._horizon);
    this.uSunColor.copy(this._sunColor);
    this.uSunGlowColor.copy(this._sunGlow);
    this.uSunGlowIntensity.value = sunGlowIntensity;
    this.uMoonAmount.value = night;

    // --- Stars & band ---
    // Stars remain through dusk and down to the horizon. The base desert has a
    // dense field; distance from civilisation fills the remaining faint stars.
    const starFade = smoothstep(0.35, -0.05, this.sunElevation);
    this.uStarOpacity.value = starFade;
    this.uStarDens.value = Math.min(1, 0.45 + Math.max(0, (g.starDensity - 1) / 6.5));
    this.uBandOpacity.value = starFade * g.galaxy;
    this.uStarTime.value = (performance.now() * 0.001) % 3600;

    // --- Aurora (skip the draw entirely when the gradient is zero) ---
    const auroraVisible = g.aurora > 0.001;
    this.auroraGroup.visible = auroraVisible;
    if (auroraVisible) {
      // Weighted toward night so it reads as a sky phenomenon, but never fully
      // absent once the gradient turns it on — an aurora over a desert.
      const opacity = g.aurora * (0.3 + 0.7 * starFade);
      const time = (performance.now() * 0.001) % 1000;
      for (let k = 0; k < this.auroraUniforms.length; k++) {
        this.auroraUniforms[k].uOpacity.value = opacity;
        this.auroraUniforms[k].uTime.value = time;
      }
    }

    // --- Lights: sun by day, dim cool moon (opposite) by night ---
    if (this.sunElevation >= 0) {
      this._lightDir.copy(this._sunDir);
      this._lightColor.copy(this._sunColor);
      this.sunLight.intensity = smoothstep(-0.06, 0.30, this.sunElevation) * 3.0;
    } else {
      this._lightDir.copy(this._sunDir).negate();
      this._lightColor.copy(C_MOON);
      this.sunLight.intensity = smoothstep(0.0, 0.45, -this.sunElevation) * 0.18;
    }
    this.sunLight.color.copy(this._lightColor);

    // Hemisphere bounce: sky tint above, warm sand below. Halved against the
    // pre-probe value because `scene.environment` now supplies real sky
    // irradiance to every standard material — running both at full strength
    // double-counts the ambient and flattens exactly the shading the probe was
    // added to recover. The hemisphere still earns its place: it keeps the warm
    // ground bounce on downward faces that a sky-only probe under-lights, and it
    // is what stops shadowed panels going to a dead flat tone.
    this._hemiSky.copy(C_DAY_ZENITH)
      .offsetHSL(g.skyHueShift * 0.5, 0.02, 0.0)
      .lerp(C_DAY_HORIZON, 0.4)
      .lerp(C_NIGHT_ZENITH, night);
    this._hemiGround.copy(C_GROUND).lerp(C_NIGHT_GROUND, night);
    this.hemiLight.color.copy(this._hemiSky);
    this.hemiLight.groundColor.copy(this._hemiGround);
    this.hemiLight.intensity = 0.04 + 1.15 * day;

    this.refreshEnvironment();

    // --- Reposition the sky with the camera ---
    this.root.position.set(cameraX, cameraY, cameraZ);

    // The classic shadow bug: a DirectionalLight's shadow frustum is defined
    // around its target, which defaults to the origin. Drive a few hundred
    // metres away and the shadow camera no longer looks at you, so shadows
    // vanish. Follow the camera every frame to keep shadows alive anywhere.
    this._targetPos.set(cameraX, cameraY, cameraZ);

    // Shadow direction: the light's own direction, with its elevation lifted to
    // SHADOW_MIN_ELEVATION so a horizon sun cannot stretch every shadow across the
    // whole frame (see the constants). Azimuth is untouched, so shadows still fall
    // away from the sun; only their length is capped. The light's POSITION is what
    // three derives the shadow direction from, so this is the one place to do it —
    // the disc, colour and intensity above are all left alone.
    const dir = this._lightDir;
    const horizontal = Math.hypot(dir.x, dir.z);
    const elevation = Math.atan2(dir.y, horizontal);
    if (elevation < SHADOW_MIN_ELEVATION && horizontal > 1e-4) {
      const flat = Math.cos(SHADOW_MIN_ELEVATION) / horizontal;
      this._shadowDir.set(dir.x * flat, Math.sin(SHADOW_MIN_ELEVATION), dir.z * flat);
    } else {
      this._shadowDir.copy(dir);
    }
    this.sunLight.position.copy(this._shadowDir).multiplyScalar(SUN_DISTANCE).add(this._targetPos);
    // Fade the whole shadow out as the true sun sinks: at that point the ground is
    // in general shade anyway, and a clamped shadow under a horizon sun is the one
    // case where the cheat above would be visible.
    this.sunLight.shadow.intensity = smoothstep(0, SHADOW_FADE_ELEVATION, Math.abs(this.sunElevation));
    this.sunLight.target.position.copy(this._targetPos);
    this.sunLight.target.updateMatrixWorld();
  }

  /**
   * Rebake the environment probe when the sun has moved enough to matter.
   *
   * This is the single reason painted metal reads as metal. A
   * MeshStandardMaterial takes almost all of a metal's response from *indirect
   * specular*, which is sampled from `scene.environment`; with no probe, a
   * metalness-0.55 body panel loses ~45% of its diffuse to the metal term and
   * gets nothing back, leaving only the sun's narrow specular lobe. That is the
   * flat, dead look — and it means raising `metalness` without a probe makes
   * panels worse, not shinier.
   *
   * Baking the game's own dome rather than importing an HDRI keeps the
   * reflection locked to the current sky (sunset paint goes orange for free) and
   * keeps the project asset-free, which is the same constraint the procedural
   * meshes are built under.
   */
  private refreshEnvironment(): void {
    if (Math.abs(this.sunElevation - this.envBakedElevation) < ENV_BAKE_STEP) return;
    this.envBakedElevation = this.sunElevation;

    const previous = this.envTarget;
    // near/far must bracket the dome; it is the only thing in the probe scene.
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, DOME_RADIUS * 2);
    this.scene.environment = this.envTarget.texture;
    // fromScene allocates a fresh target per call, so the day cycle leaks a
    // cubemap per bake unless the previous one is released here.
    if (previous !== null) previous.dispose();
  }

  /** Unit vector pointing toward the sun. Live internal vector — do not retain across frames. */
  get sunDirection(): { x: number; y: number; z: number } {
    return this._sunDir;
  }

  get isNight(): boolean {
    return this.sunElevation < NIGHT_ELEVATION;
  }

  /**
   * How "day" the sun position reads, 0..1. Drives the daytime-only heat haze:
   * zero at night and through the dawn/dusk dip, one under a clear daytime sun.
   * Reuses the same curve as the update loop's day/night sky blend, so the haze
   * disappears exactly when the sky goes dark.
   */
  get dayFactor(): number {
    return smoothstep(-0.12, 0.3, this.sunElevation);
  }


  dispose(): void {
    this.scene.remove(this.root);
    this.scene.remove(this.sunLight);
    this.scene.remove(this.sunLight.target);
    this.scene.remove(this.hemiLight);

    this.dome.geometry.dispose();
    (this.dome.material as THREE.ShaderMaterial).dispose();

    this.starPoints.geometry.dispose();
    (this.starPoints.material as THREE.ShaderMaterial).dispose();
    this.bandPoints.geometry.dispose();
    (this.bandPoints.material as THREE.ShaderMaterial).dispose();

    this.auroraGeometry.dispose();
    for (const m of this.auroraMaterials) m.dispose();

    this.scene.environment = null;
    this.envMaterial.dispose();
    if (this.envTarget !== null) this.envTarget.dispose();
    this.pmrem.dispose();
  }
}
