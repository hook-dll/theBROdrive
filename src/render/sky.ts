import * as THREE from 'three';
import { maxAnisotropy } from './texturequality';
import { GRAPHICS_CONFIG } from '../config';
import { viewDistanceFor, type GraphicsQuality } from '../game/settings';
import { farPlaneForViewDistance } from '../core/renderer';
import { DAY_LENGTH } from '../game/state';
import { newWeatherState, type WeatherState } from '../world/weather';
import { newSeasonState, type SeasonState } from '../world/season';
import { MOONLIGHT, newLookPalette, paletteAt, type LookPalette } from '../world/look/palette';
import { fogMaterialUniforms, FOG_PARS_GLSL, FOG_SKY_GRADIENT_GLSL, writeFog } from './look/fog';
import { setGroundLook } from './look/groundmaterial';
import { setBushLook } from './look/bushmaterial';
import { setTreeLook } from './look/treeglsl';
import { setWorldLighting } from './look/lighting';
import { AstronomySystem } from './astronomy';
import { Clouds } from './clouds';
import { StarField } from './starcatalog';
import { PlanetField } from './planetfield';

/**
 * THE SKY, AND THE LIGHT THAT COMES OUT OF IT.
 *
 * There is no physical scattering model here, and no post-processing. The whole
 * atmosphere is the three-colour fog of render/look/fog.ts, and the dome is simply that
 * fog at an infinite distance: it paints itself with `fogSkyColour`, the same gradient
 * every fogged material in the world dissolves into, so the ground and the sky can
 * never disagree about what colour the horizon is. The cloud deck (render/clouds.ts)
 * sits on the same gradient.
 *
 * On top of it are the few things a screenshot needs and the fog cannot give: the sun's
 * disc and halo in the key light's own colour, the Moon with its phase, and the real
 * Tycho-2 star field. Time is continuous — a real sun path from astronomy, with the
 * palette interpolating between six authored hours and the weather and season channels
 * moving the air on top.
 *
 * The lights are the palette's colours and relative strengths over the physical
 * illuminance astronomy reports, with one global exposure so that a 50-fold range from
 * noon to a moonless night still lands on the display. Night keeps an authored floor
 * under the sky's fill: fifty-fold adaptation is honest but it left the ground at
 * nothing at all, and a world you cannot see is not a dark world, it is a broken one.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Dome radius, metres. The dome is re-centred on the camera every frame. */
const DOME_RADIUS = 3000;
/** Offset of the directional light along its direction; brackets the shadow frustum. */
const SUN_DISTANCE = 240;
/** Reference axes for the shadow map's texel lattice (see `stabilizeShadowTarget`). */
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_UP_FALLBACK = new THREE.Vector3(1, 0, 0);

/** Sun elevation (radians) below this counts as night for headlight and lamp logic. */
const NIGHT_ELEVATION = -0.08;
/** Sun elevation at which roadside lamps reach full output: the end of civil twilight. */
const LAMP_FULL_ELEVATION = -0.14;

/**
 * Shadow direction is held no lower than this above the horizon, radians.
 *
 * The shadow map covers the near field only (see `shadowFrustumHalfSize`), so an exact
 * horizon light would throw a car's shadow out of the map entirely and leave a hole
 * where it used to be. Ten degrees keeps a 1.5 m car's shadow inside ±25 m and still
 * reads as a low sun; the elevation itself is untouched everywhere else — the disc, the
 * light and the fade all use the real one.
 */
const SHADOW_MIN_ELEVATION = 0.18;
/** Shadows appear as the true sun rises through this band, radians above the horizon. */
const SHADOW_FADE_ELEVATION = 0.05;
/**
 * The shadow direction moves in steps of this many radians (0.15°), never smoothly.
 *
 * A shadow map re-aimed every frame lays a new texel lattice over the world every frame,
 * and every shadow edge crawls through it. Held still between steps the lattice is fixed
 * to the world (see `stabilizeShadowTarget`); a step moves a nearby shadow by less than
 * one texel.
 */
const SHADOW_DIR_STEP = 0.0026;
/** How far ahead of the camera, as a share of the frustum's half-size, its centre sits. */
const SHADOW_LEAD = 0.42;
/**
 * The key's share of the light at which its shadow is gone, and at which it is full.
 *
 * A shadow can darken a surface by at most key / (key + fill), so a key that is a sliver
 * of the lighting casts a shadow nobody can see — and it still pays for the whole map.
 * That is every night, when the Moon is the key. Fading between 2 and 5 % leaves every
 * daylight shadow as it was and makes the night's exactly zero.
 */
const SHADOW_KEY_SHARE_GONE = 0.02;
const SHADOW_KEY_SHARE_FULL = 0.05;

/** Deliberate presentation scale: the physical lunar disc is too small in play. */
const MOON_VISUAL_SCALE = 3;
/**
 * Display-referred radiance of sunlit lunar regolith, day and night.
 *
 * Sunlit regolith does not change brightness with phase — the shader's photometric
 * function carries every angle-dependent term — so these two numbers encode EXPOSURE,
 * which the dome has none of its own: the scene pass is not tone mapped (three disables
 * tone mapping for render targets), and the post pass copies texels through. The two
 * ends are set by what the display can still show: by day the disc has about 0.65 of
 * headroom before it flattens into a white hole, and at night a full Moon must land
 * just under 1 so the maria stay a clear half-tone below the highlands.
 */
const MOON_RADIANCE_DAY = 0.75;
const MOON_RADIANCE_NIGHT = 1.15;
/** The disc is drawn this many times its physical angular radius. */
const SUN_VISUAL_SCALE = 3;
/**
 * Total display-referred light the key and the sky bounce are exposed to between them.
 * The two lights are written as their share of the real illuminance times this exposure,
 * so under full adaptation they sum to it and only their split carries the time of day.
 */
export const EXPOSURE_TARGET = 5;
/**
 * Soft floor under normalized scene illuminance: the limit of visual adaptation, not a
 * numerical epsilon. `EXPOSURE_TARGET / ADAPTATION_FLOOR` is a maximum 50x exposure,
 * which preserves detail at sunset and then lets the world become genuinely dark.
 */
export const ADAPTATION_FLOOR = 0.1;
/** The sky's own dark adaptation for stars and planets, exactly as authored. */
const CELESTIAL_ADAPTATION_FLOOR = EXPOSURE_TARGET / 25_000;
/** How far the air must drift before the reflection probe is worth rebuilding. */
const ENV_REBAKE_DELTA = 0.03;
/** And how long, at least, between two rebuilds: a probe per twilight is a stall. */
const ENV_REBAKE_INTERVAL_S = 0.25;

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;

void main() {
  // The dome is centred on the camera, so local position is the world offset from the
  // eye: normalising it gives the view ray direction directly.
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // On the far plane, a hair inside it: drawn after the opaque world, the dome is
  // depth-tested there and shades only the sky left showing.
  gl_Position.z = gl_Position.w * 0.999999;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform vec3 uSunGlowColor;
uniform float uSunGlowIntensity;
uniform float uSunDiscGain;
/** 0 with a clear sky, 1 when the deck or the fog has closed over the disc. */
uniform float uSunVeil;
uniform float uSunAngularRadius;
uniform float uMoonAngularRadius;
uniform float uMoonRadiance;
uniform float uMoonAmount;
uniform sampler2D uMoonTexture;

varying vec3 vDir;

${FOG_PARS_GLSL}
${FOG_SKY_GRADIENT_GLSL}

/**
 * McEwen's lunar-Lambert photometric function.
 *
 * Regolith is not Lambertian, and that difference is most of what makes a Moon look like
 * the Moon: it is a porous, strongly backscattering powder, so a full Moon reads as a
 * flat, evenly lit disc and a crescent keeps bright horns. The Lommel-Seeliger ratio
 * mu0/(mu0+mu) is what saves the horns — they lie against the limb, where mu -> 0 — and
 * the weight l between the two terms is what gives a crescent's terminator its fade.
 */
float lunarLambert( float mu0, float mu, float phaseAngle ) {
  float l = exp( -phaseAngle * 0.9549 );
  return 2.0 * l * mu0 / max( mu0 + mu, 0.0001 ) + ( 1.0 - l ) * mu0;
}

vec2 moonTextureUv( vec3 offset, float mu ) {
  vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), uMoonDir ) + vec3( 0.00001, 0.0, 0.0 ) );
  vec3 up = cross( uMoonDir, right );
  vec2 plane = vec2( dot( offset, right ), dot( offset, up ) );
  return vec2(
    0.5 + atan( plane.x, mu ) / 6.28318530718,
    0.5 + asin( clamp( plane.y, -1.0, 1.0 ) ) / 3.14159265359
  );
}

void main() {
  vec3 dir = normalize( vDir );

  // The whole sky: the fog's own gradient at full depth, which is exactly what the far
  // ground dissolves into along the horizon.
  vec3 col = fogSkyColour( fogColor, fogColorB, dir.y );

  float sd = dot( dir, uSunDir );
  // Disc edges are one-pixel derivative transitions: a fixed width would be wider than
  // the disc itself and mix its surroundings in.
  float sunEdge = cos( uSunAngularRadius );
  float sunAa = max( fwidth( sd ) * 0.5, 0.0000001 );
  float disc = smoothstep( sunEdge - sunAa, sunEdge + sunAa, sd );
  // Two lobes: a wide warm spread, which is what a low sun in moist air actually does,
  // and a tight core so a high sun stays a recognisable disc rather than a bright patch.
  float glow = pow( max( sd, 0.0 ), 8.0 ) * 0.30 + pow( max( sd, 0.0 ), 64.0 ) * 1.10;

  col += uSunColor * disc * uSunDiscGain * uSunVeil;
  col += uSunGlowColor * glow * uSunGlowIntensity * uSunVeil;

  // --- Moon ------------------------------------------------------------------
  // Composited ADDITIVELY, which is the whole reason the daytime Moon works: what
  // reaches the eye is lunar radiance PLUS the airlight of the entire column in front of
  // it, and that airlight is the sky colour already in col. Three things the blend had
  // to author, and got wrong, then fall out for nothing: the disc can only ever be
  // brighter than the sky around it; the unlit side is exactly sky, so it vanishes by
  // day and returns as earthshine at night; and the daylight pedestal compresses the
  // maria's contrast by itself.
  float md = dot( dir, uMoonDir );
  float moonEdge = cos( uMoonAngularRadius );
  float moonAa = max( fwidth( md ) * 0.5, 0.0000001 );
  float mdisc = smoothstep( moonEdge - moonAa, moonEdge + moonAa, md );

  vec3 moonOffset = ( dir - uMoonDir * md ) / max( sin( uMoonAngularRadius ), 0.0001 );
  float mu = sqrt( max( 0.0, 1.0 - dot( moonOffset, moonOffset ) ) );
  vec3 moonNormal = moonOffset - uMoonDir * mu;
  float mu0 = max( dot( moonNormal, uSunDir ), 0.0 );
  float cosPhase = -dot( uSunDir, uMoonDir );
  float sunlit = lunarLambert( mu0, mu, acos( clamp( cosPhase, -1.0, 1.0 ) ) );
  // Earthshine: the Earth's phase as seen from the Moon is the Moon's own complement, so
  // the ashen light peaks exactly when the crescent is thinnest.
  float earthshine = ( 0.5 - 0.5 * cosPhase ) * 0.015 * ( 0.35 + mu * 0.65 );

  vec3 lunarAlbedo = texture2D( uMoonTexture, moonTextureUv( moonOffset, mu ) ).rgb;
  // The map is a near-neutral grey photograph, but regolith is about a quarter less blue
  // than sunlight for the same green — the only thing that can turn the ivory of a high
  // full Moon back on, because an additive disc inherits the sky's blue pedestal.
  lunarAlbedo *= vec3( 1.10, 1.0, 0.84 );
  col += lunarAlbedo * ( sunlit + earthshine ) * uMoonRadiance * mdisc * uMoonAmount;

  gl_FragColor = vec4( col, 1.0 );

  // Inert on the path renderer.ts uses (three compiles tone mapping out of anything drawn
  // into a render target and the colour-space conversion is the identity into a linear
  // one), and correct for any path that draws the dome straight to the canvas.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Share of the sky's own value the environment probe carries.
 *
 * A sky is bright, and a hemisphere of it used as a reflection lights everything rough
 * that faces up: with the full value, the grass on a verge came back as white frost and
 * the fields as paint. The probe is for what a *reflective* surface shows of the sky —
 * car paint, glass, a wet road — so it carries this share and leaves the fill to the
 * hemisphere light, which is where the reference implementation puts it too (their
 * terrain runs with `envMapIntensity 0`).
 */
const ENV_RADIANCE_SCALE = 0.55;

/** Linear-radiance twin of the dome shader, used only for the environment probe. */
const SKY_FRAGMENT_LINEAR = SKY_FRAGMENT
  .replace('#include <tonemapping_fragment>', '')
  .replace('#include <colorspace_fragment>', '')
  .replace(
    'gl_FragColor = vec4( col, 1.0 );',
    `gl_FragColor = vec4( col * ${ENV_RADIANCE_SCALE.toFixed(2)}, 1.0 );`,
  );

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

export class Sky {
  private readonly scene: THREE.Scene;
  private readonly fog: THREE.FogExp2;

  /** Camera-centred dome, real catalogue stars and unresolved planets. */
  private readonly root = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly starField: StarField;
  private readonly planetField = new PlanetField();
  private readonly clouds: Clouds;

  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly ambientLight: THREE.AmbientLight;
  /** Solar System Scope lunar map, CC BY 4.0; attribution is in LICENSE. */
  private readonly moonTexture: THREE.Texture;
  private readonly astronomy = new AstronomySystem();
  private readonly moonReady: Promise<void>;

  /** This frame's look, built from the table: the air, the light and the clouds. */
  private readonly palette: LookPalette = newLookPalette();
  /** The weather and season along the road, set by `setWeather` / `setSeason`. */
  private readonly weather: WeatherState = newWeatherState();
  private readonly season: SeasonState = newSeasonState();
  private readonly look = {
    sunElevation: -1,
    sunAzimuth: 0,
    overcast: 0,
    precip: 0,
    fog: 0,
    season: this.season,
  };
  /** Coverage of the deck this frame, 0..1: the ground shadows follow it. */
  cloudCover = 0.3;

  private exposure = 1;
  /** The presentation's far plane: the scale of the whole fog model. */
  private fogFar = 8000;

  // --- Environment probe: what makes metal read as metal ----------------------
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  /** Holds one dome, sharing the visible dome's uniforms, shaded in linear space. */
  private readonly envMaterial: THREE.ShaderMaterial;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envBakedAtS = -1e9;
  private readonly envKey = { a: 0, b: 0, sunY: -2, sunR: 0 };

  /** True only for the update that successfully replaced the environment target. */
  private didBakeEnvironment = false;

  // --- Dome uniforms (typed references; mutated in place each frame) ----------
  private readonly uSunDir = new THREE.Vector3(0, 1, 0);
  private readonly uMoonDir = new THREE.Vector3(0, -1, 0);
  private readonly uSunColor = new THREE.Color();
  private readonly uSunGlowColor = new THREE.Color();
  private readonly uSunGlowIntensity = { value: 0 };
  private readonly uSunDiscGain = { value: 2 };
  private readonly uSunVeil = { value: 1 };
  private readonly uMoonAmount = { value: 0 };
  private readonly uSunAngularRadius = { value: 0.00465 };
  private readonly uMoonAngularRadius = { value: 0.0045 };
  private readonly uMoonRadiance = { value: MOON_RADIANCE_DAY };

  // --- Scratch state, reused every frame (no allocation in the hot path) ------
  private readonly _sunDirection = new THREE.Vector3();
  private readonly _keyDirection = new THREE.Vector3(0, 1, 0);
  private readonly _keyColor = new THREE.Color();
  private readonly _hazeTint = new THREE.Color();
  private readonly _shadowDir = new THREE.Vector3(0, 0, 0);
  private readonly _shadowDirWanted = new THREE.Vector3();
  private readonly _targetPos = new THREE.Vector3();
  private readonly _shadowRight = new THREE.Vector3();
  private readonly _shadowUp = new THREE.Vector3();
  private sunElevation = -1.0;
  private sunAzimuth = 0;

  constructor(
    scene: THREE.Scene,
    fog: THREE.FogExp2,
    webgl: THREE.WebGLRenderer,
    starField: StarField,
  ) {
    this.moonTexture = new THREE.Texture();
    this.moonReady = new THREE.ImageLoader().loadAsync('/data/moon.jpg').then((image) => {
      this.moonTexture.image = image;
      this.moonTexture.needsUpdate = true;
    });
    // Raw sampling: the map is a display-referred photograph of the Moon, and its sRGB
    // numbers used directly as reflectance land close to the contrast the eye reports.
    this.moonTexture.colorSpace = THREE.NoColorSpace;
    this.moonTexture.wrapS = THREE.RepeatWrapping;
    this.moonTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.moonTexture.magFilter = THREE.LinearFilter;
    // The disc's orthographic-to-equirectangular mapping compresses lunar longitude
    // without bound toward the limb, which is precisely where a crescent lives; isotropic
    // mipmapping answers that by returning the mean grey of the whole map.
    this.moonTexture.anisotropy = maxAnisotropy();

    this.scene = scene;
    this.fog = fog;
    this.pmrem = new THREE.PMREMGenerator(webgl);

    // --- Sky dome ---
    const domeGeometry = new THREE.SphereGeometry(DOME_RADIUS, 48, 24);
    const domeMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        ...fogMaterialUniforms(),
        uSunDir: { value: this.uSunDir },
        uMoonDir: { value: this.uMoonDir },
        uSunColor: { value: this.uSunColor },
        uSunGlowColor: { value: this.uSunGlowColor },
        uSunGlowIntensity: this.uSunGlowIntensity,
        uSunDiscGain: this.uSunDiscGain,
        uSunVeil: this.uSunVeil,
        uMoonTexture: { value: this.moonTexture },
        uMoonAmount: this.uMoonAmount,
        uSunAngularRadius: this.uSunAngularRadius,
        uMoonAngularRadius: this.uMoonAngularRadius,
        uMoonRadiance: this.uMoonRadiance,
      },
      side: THREE.BackSide,
      // Drawn AFTER the opaque world, on the far plane and depth-tested, so its shader
      // runs only where sky shows. Never writes depth: the post pass tells sky from
      // ground by the far plane.
      depthWrite: false,
      depthTest: true,
      fog: true,
    });
    this.dome = new THREE.Mesh(domeGeometry, domeMaterial);
    // After everything opaque (0), before the stars (5.5, additive) and long before the
    // cloud deck, which is transparent and therefore drawn after all of them.
    this.dome.renderOrder = 5;
    this.dome.frustumCulled = false;
    this.root.add(this.dome);

    // --- The cloud deck: one curved plane, following the camera ---
    // The tier arrives through `setQuality`, which the game applies at boot and again
    // whenever the player changes it.
    this.clouds = new Clouds('standard');

    // --- Environment probe dome: same geometry and uniform objects as the visible
    // dome, so the probe tracks the time of day for free. Only the fragment shader
    // differs (linear radiance, see SKY_FRAGMENT_LINEAR).
    this.envMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT_LINEAR,
      uniforms: domeMaterial.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: true,
    });
    const envDome = new THREE.Mesh(domeGeometry, this.envMaterial);
    envDome.frustumCulled = false;
    this.envScene.add(envDome);

    // --- Real Tycho-2 star field, and the naked-eye planets ---
    this.starField = starField;
    this.root.add(starField.points);
    this.root.add(this.planetField.points);

    // --- The key light: the Sun by day, the Moon by night ---
    this.sunLight = new THREE.DirectionalLight(0xffffff, 0);
    this.sunLight.castShadow = true;
    const shadow = this.sunLight.shadow;
    shadow.mapSize.set(GRAPHICS_CONFIG.shadowMapSize, GRAPHICS_CONFIG.shadowMapSize);
    shadow.camera.near = GRAPHICS_CONFIG.shadowNear;
    shadow.camera.far = GRAPHICS_CONFIG.shadowFar;
    const shadowHalfSize = GRAPHICS_CONFIG.shadowFrustumHalfSize;
    shadow.camera.left = -shadowHalfSize;
    shadow.camera.right = shadowHalfSize;
    shadow.camera.top = shadowHalfSize;
    shadow.camera.bottom = -shadowHalfSize;
    shadow.bias = GRAPHICS_CONFIG.shadowBias;
    shadow.normalBias = GRAPHICS_CONFIG.shadowNormalBias;
    shadow.camera.updateProjectionMatrix();
    scene.add(this.sunLight);
    // The target must be in the scene graph for its matrixWorld to update.
    scene.add(this.sunLight.target);

    // --- Fill: a flat ambient for overcast, and the sky/ground hemisphere over it ---
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0);
    scene.add(this.ambientLight);
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
    scene.add(this.hemiLight);

    scene.add(this.root);
    scene.add(this.clouds.mesh);
  }

  /** Prevents the launch cover from leaving while the lunar texture is still decoding. */
  async waitForAssets(): Promise<void> {
    await this.moonReady;
  }

  /** The weather to draw this frame's sky, light and air for. */
  setWeather(weather: WeatherState): void {
    Object.assign(this.weather, weather);
  }

  /** The season along the road: what the air and the ground are tinted by. */
  setSeason(season: SeasonState): void {
    Object.assign(this.season, season);
  }

  /** The world's seed, so the deck and the ground shadows ride the same wind. */
  setWorldSeed(seed: number): void {
    this.clouds.setWindSeed(seed);
  }

  /** Places the deck where the camera is (origin-relative, as the scene is). */
  updateClouds(relX: number, relY: number, relZ: number, dt: number): void {
    this.clouds.update(relX, relY, relZ, dt, this.palette, this._keyDirection);
  }

  update(
    calendarEpoch: string,
    timeOfDay: number,
    dayIndex: number,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    viewDirX = 0,
    viewDirZ = 0,
  ): void {
    this.didBakeEnvironment = false;
    const nowS = performance.now() * 0.001;

    const celestial = this.astronomy.update(calendarEpoch, dayIndex, timeOfDay);
    this._sunDirection.copy(celestial.sun.direction);
    this.sunElevation = THREE.MathUtils.degToRad(celestial.sun.altitudeDeg);
    this.sunAzimuth = THREE.MathUtils.degToRad(celestial.sun.azimuthDeg);

    // --- The look for this moment -------------------------------------------
    this.look.sunElevation = this.sunElevation;
    this.look.sunAzimuth = this.sunAzimuth;
    this.look.overcast = this.weather.overcast;
    this.look.precip = this.weather.precip;
    this.look.fog = this.weather.fog;
    paletteAt(this.look, this.palette);
    this.cloudCover = this.palette.cloudCover;

    // One air for the whole frame: the fog every material is drawn in, the sky the dome
    // is painted with, and the light colours the world uses.
    writeFog(this.palette, this.fogFar, this.fog);
    setWorldLighting(this.palette);
    // The ground's own colours, from the same table: the meadow's four tones, the season's
    // layer tints and the crop colours, written once for every ground material there is.
    setGroundLook(this.palette);
    // The bushes' two atlases and the mix between them, off the ground's own season pair,
    // so a bush changes season on the frame its ground does.
    setBushLook(this.palette);
    // The trees' two seasonal atlases, off the same season pair the ground uses, so a wood
    // and the floor under it turn on the same frame.
    setTreeLook(this.palette);

    // --- Dome ------------------------------------------------------------------
    this.uSunDir.copy(celestial.sun.direction);
    this.uMoonDir.copy(celestial.moon.direction);
    const lowSun = 1 - smoothstep(0.03, 0.4, this.sunElevation);
    // The disc grows and softens as the sun comes down: three times its physical radius
    // overhead, half again as much at the horizon, where the halo does the rest.
    this.uSunAngularRadius.value = celestial.sun.angularRadiusRad * SUN_VISUAL_SCALE * (1 + 0.5 * lowSun);
    this.uSunColor.setRGB(this.palette.sunColor.r, this.palette.sunColor.g, this.palette.sunColor.b);
    this.uSunGlowColor.copy(this.uSunColor);
    // The halo takes the haze tint at dusk, which is what puts a warm spread around a
    // setting sun instead of a white dot in a coloured sky.
    this._hazeTint.setRGB(this.palette.fogC.r, this.palette.fogC.g, this.palette.fogC.b);
    this.uSunGlowColor.lerp(this._hazeTint, lowSun * 0.55);
    this.uSunGlowIntensity.value = (0.1 + 0.6 * lowSun) * (1 - 0.85 * this.weather.overcast) * (1 - 0.8 * this.weather.fog);
    this.uSunDiscGain.value = 2 * (1 - 0.3 * this.weather.overcast);
    // What the deck and the fog take off the disc: a closed deck hides the sun behind it,
    // and a fog spell swallows it too.
    this.uSunVeil.value =
      Math.max(0, smoothstep(-0.05, 0.02, this.sunElevation)) *
      (1 - 0.9 * smoothstep(0.35, 0.85, this.weather.overcast)) *
      (1 - 0.9 * this.weather.fog);
    const visibleMoonRadius = celestial.moon.angularRadiusRad * MOON_VISUAL_SCALE;
    this.uMoonAngularRadius.value = visibleMoonRadius;
    // The disc's authored exposure rides the SAME night factor as the palette, so the
    // Moon and the sky it sits in are always adapted to each other.
    // The night floor, and where it takes over from the photometric fill: from a few
    // degrees above the horizon (the sun is already too weak to light anything) down to
    // about ten degrees below, so the ground keeps some light through twilight instead of
    // dropping to black at the horizon and being lifted again after it.
    const night = smoothstep(0.05, -0.2, this.sunElevation);
    this.uMoonRadiance.value = MOON_RADIANCE_DAY + (MOON_RADIANCE_NIGHT - MOON_RADIANCE_DAY) * night;
    this.uMoonAmount.value =
      Math.max(0, smoothstep(-0.01, 0.005, celestial.moon.direction.y)) *
      (1 - 0.95 * smoothstep(0.4, 0.85, this.weather.overcast)) *
      (1 - 0.9 * this.weather.fog);

    // --- Exposure and the light rig -------------------------------------------
    //
    // No temporal adaptation: the exposure IS the analytic answer for the current
    // illuminance, applied the moment it changes. Easing it only ever lagged the correct
    // value, and a jump to another time of day whited the screen out for a second.
    const sceneIlluminance =
      celestial.keyIlluminanceLux / 40_000 + celestial.diffuseIlluminanceLux / 10_000;
    this.exposure = EXPOSURE_TARGET / (sceneIlluminance + ADAPTATION_FLOOR);
    const celestialExposure = EXPOSURE_TARGET / (sceneIlluminance + CELESTIAL_ADAPTATION_FLOOR);
    const fill = (celestial.diffuseIlluminanceLux / 10_000) * this.exposure;

    // One shadow-casting key: astronomy blends the Sun/Moon direction, and the palette
    // carries the colour of whichever is up.
    this._keyDirection.copy(celestial.keyDirection);
    this._keyColor
      .setRGB(MOONLIGHT.r, MOONLIGHT.g, MOONLIGHT.b)
      .lerp(this.uSunColor, celestial.keySunWeight);
    this.sunLight.color.copy(this._keyColor);
    this.sunLight.intensity =
      (celestial.keyIlluminanceLux / 40_000) * this.exposure * this.palette.sunIntensity;

    this.ambientLight.color.setRGB(
      this.palette.ambientColor.r,
      this.palette.ambientColor.g,
      this.palette.ambientColor.b,
    );
    this.ambientLight.intensity = fill * this.palette.ambientIntensity;

    this.hemiLight.color.setRGB(this.palette.hemiSky.r, this.palette.hemiSky.g, this.palette.hemiSky.b);
    this.hemiLight.groundColor.setRGB(
      this.palette.hemiGround.r,
      this.palette.hemiGround.g,
      this.palette.hemiGround.b,
    );
    // The night floor is absolute, not photometric: once the sun is gone the sky's fill
    // is the only light there is, and fifty-fold adaptation on an illuminance of nothing
    // is still nothing.
    this.hemiLight.intensity = Math.max(fill * this.palette.hemiIntensity, this.palette.nightFill);

    // The probe is baked, then its intensity is scaled continuously: re-baking a PMREM
    // every frame through twilight stalls the frame, and a stale bright probe makes night
    // materials glow.
    this.scene.environmentIntensity = Math.min(1, (sceneIlluminance * this.exposure) / EXPOSURE_TARGET);
    this.refreshEnvironment(nowS);

    // --- Stars -----------------------------------------------------------------
    // A closed deck hides the night sky: the star field has no depth test against the
    // clouds (both are drawn without writing depth), so visibility is what keeps a
    // rainy night from being a starry one.
    const clearSky = 1 - smoothstep(0.25, 0.75, this.cloudCover);
    const starVisibility =
      smoothstep(0.12, -0.12, this.sunElevation) * clearSky * (1 - 0.9 * this.weather.fog);
    this.starField.update(
      celestial.equatorialToWorld,
      celestialExposure / 18_000,
      starVisibility,
      celestial.moon.direction,
      visibleMoonRadius,
    );
    this.planetField.update(celestial, (celestialExposure / 18_000) * clearSky);

    // --- Reposition the sky with the camera -----------------------------------
    //
    // The origin makes every scene-graph position RELATIVE, and the camera is no
    // exception: the sky must stay relative too, so the root, the sun light and its
    // shadow target are all written with those same relative coordinates.
    this.root.position.set(cameraX, cameraY, cameraZ);

    // The classic shadow bug: a DirectionalLight's shadow frustum is defined around its
    // target, which defaults to the origin, so a few hundred metres of driving put the
    // shadow camera somewhere else entirely. It follows the camera every frame.
    this._targetPos.set(cameraX, cameraY, cameraZ);
    const viewFlat = Math.hypot(viewDirX, viewDirZ);
    if (viewFlat > 1e-4) {
      const lead = (SHADOW_LEAD * GRAPHICS_CONFIG.shadowFrustumHalfSize) / viewFlat;
      this._targetPos.x += viewDirX * lead;
      this._targetPos.z += viewDirZ * lead;
    }

    // The shadow direction is the key's, with its elevation held off the horizon (see
    // SHADOW_MIN_ELEVATION): the light's POSITION is what three derives the direction
    // from, so this is the only place to do it. Azimuth is untouched.
    const dir = this._keyDirection;
    const horizontal = Math.hypot(dir.x, dir.z);
    const elevation = Math.atan2(dir.y, horizontal);
    if (elevation < SHADOW_MIN_ELEVATION && horizontal > 1e-4) {
      const flat = Math.cos(SHADOW_MIN_ELEVATION) / horizontal;
      this._shadowDirWanted.set(dir.x * flat, Math.sin(SHADOW_MIN_ELEVATION), dir.z * flat);
    } else {
      this._shadowDirWanted.copy(dir);
    }
    if (this._shadowDir.lengthSq() === 0 || this._shadowDir.angleTo(this._shadowDirWanted) >= SHADOW_DIR_STEP) {
      this._shadowDir.copy(this._shadowDirWanted);
    }
    this.stabilizeShadowTarget();
    this.sunLight.position.copy(this._shadowDir).multiplyScalar(SUN_DISTANCE).add(this._targetPos);

    // Fade the whole shadow out as the true sun sinks, and with the key's share of the
    // light — which is what takes the Moon's invisible shadow away at night.
    const key = this.sunLight.intensity;
    const keyShare = key / Math.max(1e-9, key + this.hemiLight.intensity + this.ambientLight.intensity);
    const shadowStrength =
      smoothstep(0, SHADOW_FADE_ELEVATION, elevation) *
      smoothstep(SHADOW_KEY_SHARE_GONE, SHADOW_KEY_SHARE_FULL, keyShare);
    const shadow = this.sunLight.shadow;
    shadow.intensity = shadowStrength;
    // A zero-strength shadow is never drawn again until it returns; freezing the map
    // rather than clearing `castShadow` is the point, because `castShadow` is compiled
    // into every lit program. Except before the map exists: one pass while there is no
    // map puts the allocation and the compile under the loading cover.
    shadow.autoUpdate = shadowStrength > 0 || shadow.map === null;
    this.sunLight.target.position.copy(this._targetPos);
    this.sunLight.target.updateMatrixWorld();
  }

  /**
   * Snaps the shadow target to the shadow map's texel grid, in the plane perpendicular
   * to the shadow direction — the two axes the shadow camera actually samples. Without
   * it, every world point lands on a slightly different texel each frame and every
   * nearby shadow edge crawls.
   */
  private stabilizeShadowTarget(): void {
    const reference = Math.abs(this._shadowDir.y) > 0.999 ? WORLD_UP_FALLBACK : WORLD_UP;
    this._shadowRight.crossVectors(reference, this._shadowDir).normalize();
    this._shadowUp.crossVectors(this._shadowDir, this._shadowRight).normalize();

    const texel = (2 * GRAPHICS_CONFIG.shadowFrustumHalfSize) / GRAPHICS_CONFIG.shadowMapSize;
    const right = this._targetPos.dot(this._shadowRight);
    const up = this._targetPos.dot(this._shadowUp);
    const snappedRight = Math.round(right / texel) * texel;
    const snappedUp = Math.round(up / texel) * texel;
    this._targetPos
      .addScaledVector(this._shadowRight, snappedRight - right)
      .addScaledVector(this._shadowUp, snappedUp - up);
  }

  /**
   * Rebuilds the reflection probe when the air has actually changed.
   *
   * The probe is what a car's paint reflects, so it has to be the sky of this hour — but
   * a PMREM per frame stalls the main thread, and one baked at boot is the wrong sky for
   * every other hour of the day. Instead it is rebuilt when the horizon or the zenith
   * colour has moved by a visible amount, at most four times a second, which is a
   * fraction of a millisecond and cannot be seen.
   */
  private refreshEnvironment(nowS: number): void {
    const p = this.palette;
    const key = this.envKey;
    const airMoved = Math.max(
      Math.abs(p.fogA.r - key.a),
      Math.abs(p.fogA.g - key.b),
      Math.abs(p.fogB.b - key.a),
      Math.abs(p.fogB.g - key.b),
    );
    const sunMoved = Math.abs(p.sunColor.r - key.sunR);
    const settled = airMoved < ENV_REBAKE_DELTA && sunMoved < ENV_REBAKE_DELTA;
    if (this.envTarget !== null && (settled || nowS - this.envBakedAtS < ENV_REBAKE_INTERVAL_S)) return;
    key.a = p.fogA.r;
    key.b = p.fogB.g;
    key.sunY = this._keyDirection.y;
    key.sunR = p.sunColor.r;
    this.envBakedAtS = nowS;
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, DOME_RADIUS * 2, { size: 128 });
    this.scene.environment = this.envTarget.texture;
    this.didBakeEnvironment = true;
  }

  /**
   * Applies the rendering tier: the star field's depth and the deck's own size.
   *
   * `horizonMetres` is the presentation's own draw distance when the settings model has
   * one — the rung's authored horizon scaled by the player's distance axis — and absent
   * when the rung's number is the answer. It is passed rather than re-derived because the
   * fog's whole scale IS the distance the world ends at, and a second derivation here is
   * how a menu setting and the air the player looks through drift apart.
   */
  setQuality(
    quality: GraphicsQuality,
    mobilePresentation = false,
    horizonMetres?: number,
  ): void {
    this.starField.setQuality(quality, mobilePresentation);
    this.clouds.setQuality(quality);
    // The fog's whole scale is the presentation's far plane — the distance the world
    // actually ends at — so a short draw distance fogs a short world and the sky is fully
    // fogged at exactly the distance the last hill dissolves at.
    this.fogFar = farPlaneForViewDistance(
      horizonMetres ?? viewDistanceFor(quality, mobilePresentation),
    );
    this.clouds.setFarPlane(this.fogFar);
  }

  get didBakeEnvironmentThisFrame(): boolean {
    return this.didBakeEnvironment;
  }

  /** Unit vector pointing toward the sun. Live internal vector — do not retain it. */
  get sunDirection(): THREE.Vector3 {
    return this._sunDirection;
  }

  get isNight(): boolean {
    return this.sunElevation < NIGHT_ELEVATION;
  }

  /**
   * How lit the roadside lamps should be, 0..1.
   *
   * `isNight` is a threshold and has to stay one — a lamp either counts as on for
   * gameplay or it does not — but switching every lamp in view within one frame is the
   * most conspicuous step in the whole dusk, so the look gets its own continuous band,
   * from the geometric horizon to eight degrees below it, where civil twilight gives out
   * and a lamp starts contributing more than the sky does.
   */
  get lampFactor(): number {
    return smoothstep(0, LAMP_FULL_ELEVATION, this.sunElevation);
  }

  /** How "day" the sun position reads, 0..1: zero at night and through the dawn dip. */
  get dayFactor(): number {
    return smoothstep(-0.12, 0.3, this.sunElevation);
  }

  /** The key light's colour now: warm when low, near white overhead, moonlight at night. */
  get sunColor(): THREE.Color {
    return this.uSunColor;
  }

  /**
   * How strongly the sun draws shafts through the trees (core/renderer.ts
   * `setSunRays`): most in the morning and evening, when the light slants through the
   * woods; none from mid-morning to mid-afternoon, when a high sun makes no shafts worth
   * their cost, and none at night.
   */
  get sunRayStrength(): number {
    const up = smoothstep(-0.02, 0.06, this.sunElevation);
    const low = 1 - smoothstep(0.2, 0.5, this.sunElevation);
    return up * 0.6 * low;
  }

  /**
   * Perceptual visibility of local lights under the current solar illuminance. The lamps
   * still exist at noon, but a dark-adapted night beam cannot remain equally visible
   * against a hundred thousand lux of daylight.
   */
  get artificialLightFactor(): number {
    return 1 - this.dayFactor * 0.995;
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.scene.remove(this.clouds.mesh);
    this.scene.remove(this.sunLight);
    this.scene.remove(this.sunLight.target);
    this.scene.remove(this.hemiLight);
    this.scene.remove(this.ambientLight);

    this.dome.geometry.dispose();
    (this.dome.material as THREE.ShaderMaterial).dispose();
    this.moonTexture.dispose();
    this.clouds.dispose();

    this.starField.dispose();
    this.planetField.dispose();

    this.scene.environment = null;
    this.envMaterial.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
  }
}
