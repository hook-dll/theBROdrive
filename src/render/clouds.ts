import * as THREE from 'three';
import { cloudShadowWind } from './cloudshadow';
import type { GraphicsQuality } from '../game/settings';
import type { LookPalette } from '../world/look/palette';
import { fogMaterialUniforms, FOG_PARS_GLSL, FOG_SKY_GRADIENT_GLSL } from './look/fog';

/**
 * THE CLOUD DECK: one curved plane over the camera, blended into the fog gradient.
 *
 * This replaces the baked cumulus cards, which could not be lit by anything but their
 * own bake, sat at one distance, and showed their own edges as billboards. What the
 * reference frames actually do (docs/slowroads-steam/notes/SrSkyLight.md §2) is one
 * plane: it follows the camera, reads a tiling noise texture at two different VIRTUAL
 * HEIGHTS, and lets the sky's own fog colour show through between the clouds. Two
 * shelves rather than one is what gives the deck depth for a single draw call — the
 * higher shelf is seen at the same angle through more air along the ray, so its pattern
 * slides differently as the camera moves, and the eye reads parallax.
 *
 * A THIRD, OFFSET SAMPLE of the same shelf is the light: the density's gradient along
 * the sun's azimuth tells us which side of a lump is facing the sun, which is enough to
 * light a deck as a volume without a volume. The palette then supplies the two colours
 * that gradient runs between, so a deck at dusk goes gold on its sunward edge and
 * lilac behind, and an overcast deck closes into one flat grey lid.
 *
 * IT IS FOGGED WITH THE SAME MODEL AS THE GROUND. Its alpha fades by radial distance
 * and by elevation, so clouds can never reach down to the terrain's horizon, and its
 * colour dissolves into `fogSkyColour` by the same EXP2 ramp that dissolves the woods
 * below it — so a fog spell swallows the clouds exactly as it swallows the trees.
 *
 * Stage 7 will put volumetric clouds in front of this on the strong tiers; the plane
 * stays as the cheap tier's deck, which is why it is built as a real layer rather than
 * as a placeholder.
 */

/** One tier: the deck's height above the eye, its width, and its mesh resolution. */
const CLOUD_TIERS: Record<GraphicsQuality, { altitude: number; scale: number; segments: number }> = {
  acceptable: { altitude: 850, scale: 11000, segments: 20 },
  standard: { altitude: 1100, scale: 18000, segments: 30 },
  blessing: { altitude: 1400, scale: 22000, segments: 40 },
};

/** Height difference between the two shelves, metres. */
const SHELF_GAP = 340;
/**
 * Texture repeat for each shelf, metres: the lower one carries the detail.
 *
 * The ratio of repeat to altitude is what decides whether the deck reads as cumulus or
 * as a wash: overhead, the plane's covered radius is `altitude * tan(halfFov)`, so a
 * repeat of 2.2 km under a 1.1 km deck puts about two cloud cells across the top of the
 * frame — where a longer repeat stretches one cell over the whole sky.
 */
const NEAR_REPEAT_M = 2200;
const FAR_REPEAT_M = 6200;
/** How far along the sun's azimuth the lighting probe reaches, metres. */
const SUN_PROBE_M = 190;

const CLOUD_TEXTURE_SIZE = 256;

// ---------------------------------------------------------------------------
// The noise, generated at boot
// ---------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Tileable value noise.
 *
 * The lattice wraps at `period` cells, so the texture repeats seamlessly in both axes
 * and the deck can span kilometres without a visible seam or a mirrored repeat. Cosine
 * interpolation rather than smoothstep: at cloud scale the difference is invisible, and
 * the cheaper curve keeps the fbm below a millisecond.
 */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const wrap = (v: number): number => ((v % period) + period) % period;
  const x0 = wrap(xi);
  const y0 = wrap(yi);
  const x1 = wrap(xi + 1);
  const y1 = wrap(yi + 1);
  const ux = tx * tx * (3 - 2 * tx);
  const uy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

function fbm(x: number, y: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let k = 0; k < octaves; k++) {
    sum += valueNoise(x * period, y * period, period, seed + k * 17) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/**
 * The deck's own texture: a red channel of billowy cumulus density and a green channel
 * of its finer relief, which the shader reads for the shading gradient.
 *
 * Generated rather than shipped: 256² is 5 kB of noise the GPU can filter, the tiles are
 * seamless by construction, and no external asset has to be licensed — which matters
 * when the same texture is what a phone tier draws the whole sky with.
 */
function makeCloudTexture(): THREE.DataTexture {
  const size = CLOUD_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Two fields: a low-frequency one that decides where cumulus gather, and a
      // higher-frequency billow that gives every lump its cauliflower edge.
      const big = fbm(u, v, 4, 4, 0x51c0d);
      const billow = 1 - Math.abs(2 * fbm(u + 0.37, v + 0.11, 7, 3, 0x9e2f1) - 1);
      const gathered = Math.min(1, Math.max(0, (big - 0.34) / 0.36));
      const density = Math.min(1, Math.max(0, gathered * (0.5 + 0.8 * billow)));
      const i = (y * size + x) * 4;
      data[i] = Math.round(density * 255);
      data[i + 1] = Math.round(billow * 255);
      data[i + 2] = Math.round(density * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const CLOUD_VERTEX = /* glsl */ `
uniform float uAltitude;
uniform float uShelfGap;
uniform float uNearRepeat;
uniform float uFarRepeat;
uniform vec2 uWind;
uniform vec2 uCameraXZ;
uniform vec2 uSunUv;

varying vec2 vUvA;
varying vec2 vUvB;
varying vec2 vUvC;
varying float vRadial;
varying vec3 vPlaneWorld;

void main() {
	// 1 at the plane's centre, 0 at its rim: the deck's own horizon fade.
	float radial = clamp( 1.0 - length( position.xz ) * 2.0, 0.0, 1.0 );
	vRadial = radial;

	vec4 world = modelMatrix * vec4( position, 1.0 );
	// The edges bend down toward the horizon, as a real deck seen from underneath does.
	world.y -= ( 1.0 - radial ) * ( 1.0 - radial ) * uAltitude * 0.5;
	vPlaneWorld = world.xyz;

	// The lower shelf, sampled in world space: the deck stays where it is while the
	// camera drives through it, and the wind is a real displacement of the pattern.
	vUvA = ( world.xz + uWind ) / uNearRepeat;

	// The upper shelf. A point at the same angle lies further along the ray, so its
	// world offset from the camera scales by h1/h0 — that ratio IS the parallax, and it
	// is why the higher pattern slides differently as the car moves.
	float h0 = uAltitude;
	float h1 = uAltitude + uShelfGap;
	vec2 atFar = uCameraXZ + ( world.xz - uCameraXZ ) * ( h1 / h0 );
	vUvB = ( atFar + uWind ) / uFarRepeat;
	// A probe along the sun's own azimuth: the difference between these two samples is
	// the density's slope in the one direction that decides which side is lit.
	vUvC = vUvB + uSunUv;

	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
uniform sampler2D uCloud;
uniform vec3 uHighlight;
uniform vec3 uLowlight;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uCover;
uniform float uDark;
uniform float uRimElevation;

varying vec2 vUvA;
varying vec2 vUvB;
varying vec2 vUvC;
varying float vRadial;
varying vec3 vPlaneWorld;

${FOG_PARS_GLSL}
${FOG_SKY_GRADIENT_GLSL}

void main() {
	float layerA = texture2D( uCloud, vUvA ).r;
	vec4 layerB = texture2D( uCloud, vUvB );
	vec4 probe = texture2D( uCloud, vUvC );

	// The two shelves cover the sky together: a hole in one is filled by the other,
	// which is what makes a deck read as depth rather than as two overlaid patterns.
	float coverage = 1.0 - ( 1.0 - layerA ) * ( 1.0 - layerB.r );
	float threshold = 1.0 - uCover;
	float density = smoothstep( threshold, threshold + 0.17, coverage );

	vec3 toFragment = vPlaneWorld - cameraPosition;
	float distance = length( toFragment );
	vec3 dir = toFragment / max( distance, 1.0 );
	float elevation = dir.y;

	// The horizon fade: the deck thins out as it comes down, so it can never meet the
	// terrain's own horizon as a hard edge.
	float fade = vRadial * smoothstep( uRimElevation * 0.35, uRimElevation * 1.35, elevation );
	float alpha = density * fade;

	// The same air the ground is in, evaluated at the deck's own distance: a fog spell
	// swallows the clouds exactly as it swallows the woods below them.
	float nearM = fogParams.x;
	float farM = max( fogParams.y, nearM + 1.0 );
	float ramp = max( 0.0, ( distance - nearM ) * ( farM / ( farM - nearM ) ) );
	float fogAmount = 1.0 - exp( - fogDensity * fogDensity * ramp * ramp );
	vec3 sky = fogSkyColour( fogColor, fogColorB, elevation );
	alpha *= 1.0 - fogAmount * 0.9;
	if ( alpha < 0.003 ) discard;

	// Which side faces the sun. The probe points along the sun's azimuth, so a positive
	// difference means the density is rising toward the sun: that edge is lit, the far
	// edge is the cloud's own shade.
	float towardSun = probe.r - layerB.r;
	float lit = clamp( 0.45 + towardSun * 6.0, 0.0, 1.0 );
	// A deck seen edge-on shows its own shaded side: the lower the cloud is in the frame,
	// the less of its lit top the eye is looking at.
	lit *= mix( 0.72, 1.0, smoothstep( 0.02, 0.45, elevation ) );
	// A closed or heavy deck is flat: its own colours already carry the darkness.
	lit = mix( lit, 0.22, uDark );
	vec3 col = mix( uLowlight, uHighlight, lit );
	col += uSunColor * max( towardSun, 0.0 ) * 0.5;
	// A closed deck is one lid: as the coverage goes to 1 the mottling is smoothed out
	// into the sky's own gradient, which is what an overcast layer looks like from below.
	float lid = smoothstep( 0.78, 1.0, uCover ) * 0.55;
	col = mix( col, sky, fogAmount * 0.85 + lid );
	alpha *= 1.0 - lid * 0.15;

	gl_FragColor = vec4( col, alpha );
}
`;

// ---------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------

export class Clouds {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly texture: THREE.DataTexture;
  /** Wind drift accumulated from the frame's own dt, metres: the deck stops with the game. */
  private readonly drift = new THREE.Vector2();
  private tier = CLOUD_TIERS.standard;
  private readonly wind = { x: 0, z: 0 };
  private windSeed = 0;
  private farPlane = 8000;

  constructor(quality: GraphicsQuality) {
    this.texture = makeCloudTexture();
    this.tier = CLOUD_TIERS[quality];
    this.geometry = new THREE.PlaneGeometry(1, 1, this.tier.segments, this.tier.segments);
    this.geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      uniforms: {
        ...fogMaterialUniforms(),
        uCloud: { value: this.texture },
        uHighlight: { value: new THREE.Color(1, 1, 1) },
        uLowlight: { value: new THREE.Color(0.6, 0.6, 0.65) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uCover: { value: 0.35 },
        uDark: { value: 0.15 },
        uAltitude: { value: this.tier.altitude },
        uShelfGap: { value: SHELF_GAP },
        uNearRepeat: { value: NEAR_REPEAT_M },
        uFarRepeat: { value: FAR_REPEAT_M },
        uRimElevation: { value: 0.1 },
        uWind: { value: new THREE.Vector2() },
        uCameraXZ: { value: new THREE.Vector2() },
        uSunUv: { value: new THREE.Vector2() },
      },
      transparent: true,
      depthWrite: false,
      // Depth TESTED, unlike the reference implementation: a cloud that is behind a
      // tree must be behind it, and only a deck that ignores the depth buffer can be
      // painted over a crown.
      depthTest: true,
      side: THREE.DoubleSide,
      fog: true,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // Before every other transparent object (rain, glints, contact patches): the deck
    // is the furthest thing in the frame.
    this.mesh.renderOrder = -9;
    this.setQuality(quality);
  }

  /** The world's wind, shared with the ground cloud shadows so both drift together. */
  setWindSeed(seed: number): void {
    this.windSeed = seed;
    cloudShadowWind(seed, this.wind);
  }

  /**
   * The presentation's far plane. The deck is clamped inside it: everything the camera
   * can draw must be inside its far plane, and a plane hanging outside would be cut off
   * as a circle of missing cloud rather than read as a smaller deck.
   */
  setFarPlane(farMetres: number): void {
    this.farPlane = Math.max(1200, farMetres);
    this.applySize();
  }

  /** The tier decides the deck's height and size; the far plane clamps it afterwards. */
  setQuality(quality: GraphicsQuality): void {
    this.tier = CLOUD_TIERS[quality];
    this.applySize();
  }

  /** Fits the deck inside the far plane and re-derives the rim's own elevation. */
  private applySize(): void {
    const { altitude } = this.tier;
    const width = Math.min(this.tier.scale, this.farPlane * 0.92);
    this.mesh.scale.setScalar(width);
    this.material.uniforms.uAltitude!.value = altitude;
    // The rim is bent down to half the altitude, so that is the elevation it leaves at.
    this.material.uniforms.uRimElevation!.value = Math.atan2(altitude * 0.5, width * 0.5);
  }

  /**
   * Places the deck for this frame.
   *
   * `relX/relY/relZ` are the camera's ORIGIN-RELATIVE position (the scene is
   * origin-relative, see world/origin.ts), `dt` the render frame's own delta, so a
   * paused game's clouds stop with it.
   */
  update(
    relX: number,
    relY: number,
    relZ: number,
    dt: number,
    palette: LookPalette,
    keyDirection: THREE.Vector3,
  ): void {
    this.drift.x += this.wind.x * dt;
    this.drift.y += this.wind.z * dt;
    this.mesh.position.set(relX, relY + this.tier.altitude, relZ);

    const u = this.material.uniforms;
    (u.uWind!.value as THREE.Vector2).set(this.drift.x, this.drift.y);
    (u.uCameraXZ!.value as THREE.Vector2).set(relX, relZ);
    (u.uSunDir!.value as THREE.Vector3).copy(keyDirection);

    const highlight = u.uHighlight!.value as THREE.Color;
    const lowlight = u.uLowlight!.value as THREE.Color;
    const sun = u.uSunColor!.value as THREE.Color;
    highlight.setRGB(palette.cloudHighlight.r, palette.cloudHighlight.g, palette.cloudHighlight.b);
    lowlight.setRGB(palette.cloudLowlight.r, palette.cloudLowlight.g, palette.cloudLowlight.b);
    sun.setRGB(palette.sunColor.r, palette.sunColor.g, palette.sunColor.b);

    u.uCover!.value = Math.min(0.999, Math.max(0.02, palette.cloudCover));
    u.uDark!.value = Math.min(1, Math.max(0, palette.cloudDark));

    // The lighting probe, as a UV offset: a step of SUN_PROBE_M metres along the sun's
    // azimuth, divided by the shelf's own repeat.
    const flat = Math.hypot(keyDirection.x, keyDirection.z);
    const sunUv = u.uSunUv!.value as THREE.Vector2;
    if (flat > 1e-4) {
      const reach = SUN_PROBE_M / FAR_REPEAT_M;
      sunUv.set((keyDirection.x / flat) * reach, (keyDirection.z / flat) * reach);
    } else {
      sunUv.set(0, 0);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
