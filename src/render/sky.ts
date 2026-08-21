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

/** Dome radius. Inside the 4 km far plane, so it never clips; re-centred each frame. */
const DOME_RADIUS = 1500;
/** Stars sit just inside the dome so they layer over the gradient, not behind it. */
const STAR_RADIUS = 1400;
/** Aurora curtains live in front of the stars, well inside the dome. */
const AURORA_DISTANCE = 800;
/** Offset of the directional light along its direction; brackets the shadow frustum. */
const SUN_DISTANCE = 240;

/** Sun elevation (radians) below this counts as night for headlight/lamp logic. */
const NIGHT_ELEVATION = -0.08;

/**
 * The sun's great circle is tilted this far off the east-west vertical plane, so
 * the noon sun sits south of the zenith rather than dead overhead — northern
 * hemisphere long-shadow feel, and it keeps the light from pointing straight down.
 */
const SOUTH_TILT = 0.45;

/** Matches renderer.ts's starting density; the gradient's haze multiplies it. */
const BASE_FOG_DENSITY = 0.00035;

const STAR_COUNT = 4000;
/** Seed for the star field. Fixed so the sky is identical every session. */
const STAR_SEED = 0x5ca11ab1;
/** Fibonacci candidates filtered into a band give a deterministic galactic plane. */
const BAND_CANDIDATES = 9000;
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

/** Shared by the star field and the galactic band (band passes uDens01 = 1). */
const STAR_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aBright;
attribute float aThresh;
attribute vec3 aColor;
uniform float uPixelRatio;
varying float vBright;
varying float vThresh;
varying vec3 vColor;

void main() {
  vColor = aColor;
  vBright = aBright;
  vThresh = aThresh;
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STAR_FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform float uDens01;
varying float vBright;
varying float vThresh;
varying vec3 vColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float mask = smoothstep(1.0, 0.0, dot(c, c));

  // Density fades each star in past its own threshold rather than rebuilding
  // the buffer: at starDensity 1 only the bright ones show, at 4.5 all do.
  float vis = smoothstep(vThresh - 0.08, vThresh + 0.08, uDens01);
  float a = vBright * vis * uOpacity * mask;
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

  // --- Scratch state, reused every frame (no allocation in the hot path) ---
  private readonly _sunDir = new THREE.Vector3();
  private readonly _lightDir = new THREE.Vector3();
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

  constructor(scene: THREE.Scene, fog: THREE.FogExp2) {
    this.scene = scene;
    this.fog = fog;

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
    shadow.mapSize.set(2048, 2048);
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
      sizes[i] = 0.7 + b * 2.0;

      const t = hash01(STAR_SEED, i, 4);
      if (t < 0.72) {
        colors[i * 3] = 0.95; colors[i * 3 + 1] = 0.97; colors[i * 3 + 2] = 1.0;
      } else if (t < 0.9) {
        colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.87; colors[i * 3 + 2] = 0.7;
      } else {
        colors[i * 3] = 0.72; colors[i * 3 + 1] = 0.83; colors[i * 3 + 2] = 1.0;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(brights, 1));
    geometry.setAttribute('aThresh', new THREE.BufferAttribute(thresholds, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uOpacity: this.uStarOpacity,
        uDens01: this.uStarDens,
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
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
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(brights, 1));
    geometry.setAttribute('aThresh', new THREE.BufferAttribute(thresholds, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uOpacity: this.uBandOpacity,
        uDens01: { value: 1 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
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
    const starFade = smoothstep(0.1, -0.1, this.sunElevation); // 0 by day, 1 at night
    this.uStarOpacity.value = starFade;
    this.uStarDens.value = Math.min(1, Math.max(0, (g.starDensity - 1) / 3.5));
    this.uBandOpacity.value = starFade * g.galaxy;

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

    // Hemisphere bounce: sky tint above, warm sand below. Strong by day so
    // shadowed faces read as sun-warmed mid-tones; collapsing to a faint cool
    // moon fill at night so headlights and lamps stay the real illumination.
    this._hemiSky.copy(C_DAY_ZENITH)
      .offsetHSL(g.skyHueShift * 0.5, 0.02, 0.0)
      .lerp(C_DAY_HORIZON, 0.4)
      .lerp(C_NIGHT_ZENITH, night);
    this._hemiGround.copy(C_GROUND).lerp(C_NIGHT_GROUND, night);
    this.hemiLight.color.copy(this._hemiSky);
    this.hemiLight.groundColor.copy(this._hemiGround);
    this.hemiLight.intensity = 0.06 + 2.4 * day;

    // --- Reposition the sky with the camera ---
    this.root.position.set(cameraX, cameraY, cameraZ);

    // The classic shadow bug: a DirectionalLight's shadow frustum is defined
    // around its target, which defaults to the origin. Drive a few hundred
    // metres away and the shadow camera no longer looks at you, so shadows
    // vanish. Follow the camera every frame to keep shadows alive anywhere.
    this._targetPos.set(cameraX, cameraY, cameraZ);
    this.sunLight.position.copy(this._lightDir).multiplyScalar(SUN_DISTANCE).add(this._targetPos);
    this.sunLight.target.position.copy(this._targetPos);
    this.sunLight.target.updateMatrixWorld();
  }

  /** Unit vector pointing toward the sun. Live internal vector — do not retain across frames. */
  get sunDirection(): { x: number; y: number; z: number } {
    return this._sunDir;
  }

  get isNight(): boolean {
    return this.sunElevation < NIGHT_ELEVATION;
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
  }
}
