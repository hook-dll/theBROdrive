import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { hashUnit2 } from '../core/rng';
import { weather } from '../world/weather';
import { CLOUD_DECKS, cloudDeckShift, cloudFieldOf, cloudPan, cloudSet, cloudShadeAlong } from './cloudfield';

/**
 * CLOUD SHADOWS ON THE GROUND: the shadows of the sky's own clouds (render/clouds.ts),
 * sliding across the desert with them.
 *
 * WHY IT EXISTS. Nothing inside 3 km of view changes on its own, and the worst offender is
 * the LIGHT: the sun moves a degree in four minutes and the ground holds one brightness
 * for minutes at a time. A patch of shade sliding across three kilometres of open ground
 * is visible from anywhere, needs no geometry, and never repeats in the same place twice.
 *
 * WHAT IT IS. The clouds are drawn from the sun into a small map every frame (the cloud
 * layer's coverage pass, render/clouds.ts): which ground, projected along the sun's ray,
 * has a cloud over it, blurred into a soft penumbra. Every ground material reads that
 * map PER VERTEX at its own position slid up the sun's ray, so each shadow lies exactly
 * where its cloud's silhouette falls, and multiplies the light leaving the surface. One
 * texture tap a vertex, nothing per fragment but a multiply, and no work at all at night.
 *
 * THE THINGS THAT MAKE IT CORRECT RATHER THAN MERELY CHEAP:
 *
 *  1. IT FOLLOWS THE CLOUDS, NOT A FIELD OF ITS OWN. The map is a picture of the meshes,
 *     taken along the same ray the shade looks up, so a shadow is a cloud's own shape
 *     at the sun's own slant. render/cloudfield.ts's `cloudShadeAlong` is its CPU twin.
 *  2. IT IS WORLD-ANCHORED, ACROSS A REBASE. The clouds stand in a field that repeats
 *     every `CLOUD_PERIOD_M`, and the scene origin goes in reduced modulo that period
 *     (`cloudPan`): the largest number a shader handles is one period, not one road.
 *  3. IT IS DRIVEN BY THE LOOP'S OWN CLOCK. `advanceCloudShadows` integrates the render
 *     frame's dt: a paused game's clouds stop with it, and a 60x day does not fly them
 *     past at sixty times the wind.
 *  4. IT IS OFF AT NIGHT. The ground light it would modulate is then hemisphere fill, and
 *     darkening fill reads as dirt rather than shade. The gate is the mirage's band on the
 *     same day factor (render/mirage.ts), so the two illusions leave together.
 *
 * WHY THE STATE IS MODULE-LEVEL. The ground materials are module-level singletons
 * (`TERRAIN_MATERIAL`, the road ribbon's `roadMaterial`, the vista's `MESA_MATERIAL`),
 * created at import time, long before anything in `main.ts` runs. One shared uniform
 * block is the only thing they can all be bound to, and it makes the per-frame cost a
 * handful of uniform writes for the whole world.
 */

/**
 * Deepest darkening, as a fraction of the light leaving the surface.
 *
 * A cumulus blocks the sun but not the sky, and in this desert the sky fill is a large
 * part of the ground's light: shaded sand keeps most of its brightness and loses its
 * contrast. 0.32 under the thickest cloud reads as shade; past about 0.45 it reads as a
 * bruise on the terrain.
 */
export const CLOUD_DARKEN_MAX = 0.32;
/** Mirage's own twilight band, so the two illusions leave together. */
export const CLOUD_DAY_LOW = 0.12;
export const CLOUD_DAY_HIGH = 0.42;

/** Hash domain of the wet-patch salt. */
const TAG_SALT = 0x43534832; // 'CSH2'

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Deepest darkening the current daylight allows. Zero is the shader's early-out. */
export function cloudShadowStrength(dayFactor: number): number {
  return CLOUD_DARKEN_MAX * smoothstep(CLOUD_DAY_LOW, CLOUD_DAY_HIGH, dayFactor);
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

/**
 * Where the map fades out, as a fraction of its half-width: ground beyond it is
 * unshaded. Out there the vista's rings are hundreds of metres apart and the haze has
 * the land half washed out, so a shadow would only band across its triangles.
 */
const MAP_FADE_START = 0.8;

const CLOUD_VERTEX_PARS = /* glsl */ `
uniform sampler2D uCloudMap;
/** xy: the map's centre in scene metres (on the sun-slid plane); z: 1 / its width. */
uniform vec3 uCloudMapFrame;
/** Horizontal metres per metre of height along the ray to the sun (\`setCloudSunShift\`). */
uniform vec2 uCloudSunSlope;
uniform float uCloudStrength;
uniform float uWet;
uniform float uWetSalt;
uniform vec2 uGroundPan;
varying float vCloudShade;
varying float vWetMask;

/**
 * The shade over a scene point: the map's coverage where the point's ray to the sun
 * crosses the map's plane, the same projection the coverage pass drew the clouds with.
 */
float cloudShade( vec3 world ) {
	vec2 slid = world.xz - world.y * uCloudSunSlope;
	vec2 uv = ( slid - uCloudMapFrame.xy ) * uCloudMapFrame.z;
	float edge = max( abs( uv.x ), abs( uv.y ) ) * 2.0;
	return textureLod( uCloudMap, uv + 0.5, 0.0 ).r * ( 1.0 - smoothstep( ${MAP_FADE_START.toFixed(2)}, 1.0, edge ) );
}

float wetHash( float cx, float cz, float salt ) {
	float hx = fract( cx * 0.1031 );
	float hy = fract( cz * 0.1031 );
	float hz = fract( ( ( cx + cz ) + salt ) * 0.1031 );
	float d = ( hx * ( hy + 33.33 ) + hy * ( hz + 33.33 ) ) + hz * ( hx + 33.33 );
	hx += d;
	hy += d;
	hz += d;
	return fract( ( hx + hy ) * hz );
}

/** Value noise on a lattice that wraps every \`cells\`, so the rebase pan never moves it. */
float wetNoise( vec2 p, float cells, float salt ) {
	vec2 i = floor( p );
	vec2 f = p - i;
	f = f * f * ( 3.0 - 2.0 * f );
	vec2 i0 = i - cells * floor( i / cells );
	vec2 i1 = ( i + 1.0 ) - cells * floor( ( i + 1.0 ) / cells );
	float a = wetHash( i0.x, i0.y, salt );
	float b = wetHash( i1.x, i0.y, salt );
	float c = wetHash( i0.x, i1.y, salt );
	float d = wetHash( i1.x, i1.y, salt );
	return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
`;

/**
 * What the fragment stage still needs: the shade, and how much of it to apply.
 * `uCloudStrength` is declared in BOTH stages on purpose: the vertex stage skips the tap
 * at night and the fragment stage skips the multiply.
 */
const CLOUD_FRAGMENT_PARS = /* glsl */ `
varying float vCloudShade;
varying float vWetMask;
uniform float uCloudStrength;
uniform float uWet;
`;

/**
 * WHY PER VERTEX. The shade ran in the FRAGMENT shader once (as a noise field), and on the
 * machine that reported it the frame went from 87 to 36 frames a second: the ground shader
 * is enormous (twelve light slots, the comic stack, the spotlight normals, eight shadow
 * taps) and the extra temporaries pushed it into register spilling. Per vertex it costs
 * one tap, and it is the right answer anyway: a penumbra is a hundred metres wide and the
 * meshes it lands on are metre-scale (the refined terrain grid 2.67 m, the road's rows
 * 1.3 m), so the interpolation across a triangle IS the picture.
 *
 * The vista's rings are up to 360 m apart, wider than a penumbra, and band it; out there
 * the haze has the ground half washed out, and the map fades before the far rings.
 */
const CLOUD_VERTEX_HOOK = /* glsl */ `#include <worldpos_vertex>
	vec3 cloudWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	float cloudDist = distance( cloudWorld, cameraPosition );
	vCloudShade = uCloudStrength > 0.0 ? cloudShade( cloudWorld ) : 0.0;
	// Wet ground dries in patches, not as one sheet: a nine-metre noise decides which
	// ground holds its water longest (the hollows, the ruts), evaluated per vertex for
	// the same reason as the shade above, and only while anything is wet.
	//
	// Only where the mesh can carry it. The vista's vertices are up to 360 m apart and
	// its rings follow the camera, so a nine-metre noise sampled on them is pure
	// aliasing: every vertex lands on an unrelated cell, and every rebuild re-rolls
	// them — whole hillsides blinked dark and light after rain. With distance the
	// noise gives way to its own mean, so far ground is evenly damp; the near tiles
	// are 2.67 m and keep every patch.
	vWetMask = 0.0;
	if ( uWet > 0.0 ) {
		float held = wetNoise( ( cloudWorld.xz + uGroundPan ) / 9.0, 4096.0, uWetSalt );
		held = mix( held, 0.5, smoothstep( 180.0, 420.0, cloudDist ) );
		vWetMask = smoothstep( 0.0, 0.35, uWet - held * 0.65 + 0.3 );
	}`;

/**
 * Applied to `outgoingLight`, the lit surface colour before fog and tone mapping: a
 * shadow must be fogged with the ground it is on and tone-mapped with it. The strength
 * test is the whole of the night gating: `uCloudStrength` is a uniform, so the branch is
 * coherent across every fragment in the draw.
 *
 * Wet ground only darkens. The road used to go glossy and mirror the horizon, and every
 * oncoming headlamp laid a streak along it, wet or dry; the owner (2026-10-16) wanted
 * none of it: desert asphalt is matt, and after rain it dries in minutes.
 */
const CLOUD_FRAGMENT_HOOK = /* glsl */ `
	if ( uCloudStrength > 0.0 ) {
		outgoingLight *= 1.0 - vCloudShade * uCloudStrength;
	}
	if ( uWet > 0.0 ) {
		// Water darkens anything porous by filling the air gaps that scattered light
		// back out: damp sand and wet asphalt both lose about a third of their light.
		outgoingLight *= 1.0 - 0.36 * vWetMask;
	}
#include <opaque_fragment>`;

/** Suffix, so a patched material never shares a program with an unpatched one. */
const CLOUD_PROGRAM_KEY = 'cloud-shadow-v6';

/**
 * ONE uniform block for the whole world. Every patched material is bound to these exact
 * objects, so a frame's writes reach every ground material at once.
 */
const uniforms = {
  /** The cloud layer's blurred coverage map (render/clouds.ts); null until it exists. */
  uCloudMap: { value: null as THREE.Texture | null },
  uCloudMapFrame: { value: new THREE.Vector3(0, 0, 1) },
  /** Horizontal metres per metre of height along the sun's ray (`setCloudSunShift`). */
  uCloudSunSlope: { value: new THREE.Vector2() },
  uCloudStrength: { value: 0 },
  /** Ground wetness from world/weather.ts, 0..1. */
  uWet: { value: 0 },
  uWetSalt: { value: 0 },
  /** The rebase origin reduced into one wet-patch period: puddles stay put on a rebase. */
  uGroundPan: { value: new THREE.Vector2() },
};

/**
 * The scene origin's position in the cloud field (`cloudPan`): the cloud layer and the
 * dome's storm deck read this very object, so the clouds, their shadows and the deck can
 * never be a frame apart.
 */
export const cloudPanUniform = { value: new THREE.Vector2() };

/**
 * Where each deck's clouds have drifted against the low deck's this frame
 * (`cloudDeckShift`), written with the pan: the cloud layer places the higher decks by it.
 */
export const cloudDeckShiftLive = new Float64Array(2 * CLOUD_DECKS);

/**
 * Lowest sun the shift follows. Below it the shadow would come from a cloud ten or more
 * kilometres off, out where the sky has faded its clouds into the horizon; the shadows
 * themselves are fading out with the day by then (`CLOUD_DAY_LOW`).
 */
const SUN_SHIFT_MIN_ELEVATION = 0.15;

/**
 * Points the ground's shade at the clouds that cast it: a ground point is shaded by
 * whatever cloud the ray from it to the sun (`sunDir`, unit, scene frame) passes
 * through. Called once a frame by the sky.
 */
export function setCloudSunShift(sunDir: THREE.Vector3): void {
  const k = 1 / Math.max(SUN_SHIFT_MIN_ELEVATION, sunDir.y);
  uniforms.uCloudSunSlope.value.set(sunDir.x * k, sunDir.z * k);
}

/** The frame's sun-ray slope and shade strength, which the cloud layer's coverage pass reads live. */
export const cloudShadowLive = { slope: uniforms.uCloudSunSlope, strength: uniforms.uCloudStrength };

/**
 * Hands the ground the cloud layer's map: `texture` covers `width` metres of the
 * sun-slid plane centred on scene `(centreX, centreZ)`.
 */
export function setCloudShadowMap(texture: THREE.Texture, centreX: number, centreZ: number, width: number): void {
  uniforms.uCloudMap.value = texture;
  uniforms.uCloudMapFrame.value.set(centreX, centreZ, 1 / width);
}

/** Materials already carrying the injection, so a second call cannot double it. */
const injected = new WeakSet<THREE.Material>();

function patchCloudShader(shader: WebGLProgramParametersWithUniforms): void {
  for (const [name, uniform] of Object.entries(uniforms)) shader.uniforms[name] = uniform;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${CLOUD_VERTEX_PARS}`)
    .replace('#include <worldpos_vertex>', CLOUD_VERTEX_HOOK);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${CLOUD_FRAGMENT_PARS}`)
    .replace('#include <opaque_fragment>', CLOUD_FRAGMENT_HOOK);
}

/**
 * Gives one ground material the cloud shadows. Returns the same material, so it can be
 * wrapped around a construction expression.
 *
 * CHAINS, NEVER REPLACES. Every ground material in the game already carries a patch
 * — `applyComicShading` on the terrain and the vista, `applyGroundSpotlightNormals`
 * on the road ribbon and its markings, and the desert tiles chain a third onto the
 * comic one — so this captures what is there and calls it first. Idempotent as
 * well: the terrain material factory is called twice and the road's asphalt finish
 * is handed out by name, so a second call on a material that already has the patch
 * has to be a no-op rather than a second copy of the GLSL (which would not compile:
 * `vCloudShade` would be declared twice).
 */
export function applyCloudShadow(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  if (injected.has(material)) return material;
  injected.add(material);

  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    patchCloudShader(shader);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:${CLOUD_PROGRAM_KEY}`;
  return material;
}

// ---------------------------------------------------------------------------
// Per frame
// ---------------------------------------------------------------------------

/** Seconds of drift accumulated from the render loop's own dt. */
let elapsed = 0;
const pan = { x: 0, z: 0 };

/** Period of the wet-patch lattice: 4096 cells of 9 m. */
const WET_PERIOD_M = 9 * 4096;

/**
 * Advances the drift and writes the frame's uniforms. Called once per rendered frame from
 * `main.ts`, before the cloud layer places its clouds (`Sky.updateClouds`).
 *
 * `dt` is the render frame's delta, NOT wall-clock: a paused or time-scaled game must not
 * have clouds drifting on its own. `dayFactor` is the sky's.
 */
export function advanceCloudShadows(
  seed: number,
  dt: number,
  dayFactor: number,
  originX: number,
  originZ: number,
): void {
  elapsed += dt;
  cloudPan(seed, elapsed, originX, originZ, pan);
  cloudPanUniform.value.set(pan.x, pan.z);
  cloudDeckShift(seed, elapsed, cloudDeckShiftLive);
  // Which wet-patch layout this seed gets, in sixteenths so the f32 uniform holds it exactly.
  uniforms.uWetSalt.value = Math.round(hashUnit2(seed, TAG_SALT) * 512 * 16) / 16;
  // Weather on the shade: a building storm puts deeper shade on the ground; once the
  // deck has closed the sun is gone and so are the patches (the lights carry the
  // gloom). Haze and dust scatter the sun into a flat light that casts no patch at all.
  const w = weather;
  const building = w.cloud * (1 - w.cloud) * 4;
  uniforms.uCloudStrength.value =
    cloudShadowStrength(dayFactor) *
    (1 + 0.25 * building) *
    (1 - 0.9 * Math.max(0, w.cloud - 0.6) / 0.4) *
    (1 - 0.6 * w.haze) *
    (1 - w.dust);
  uniforms.uWet.value = w.wet;
  uniforms.uGroundPan.value.set(
    originX - WET_PERIOD_M * Math.floor(originX / WET_PERIOD_M),
    originZ - WET_PERIOD_M * Math.floor(originZ / WET_PERIOD_M),
  );
}

/** The frame's values, read back by the cloud layer, the heat haze and tools/sky-variety.ts. */
export function cloudShadowFrame(): {
  elapsed: number;
  panX: number;
  panZ: number;
  strength: number;
  slopeX: number;
  slopeZ: number;
} {
  return {
    elapsed,
    panX: cloudPanUniform.value.x,
    panZ: cloudPanUniform.value.y,
    strength: uniforms.uCloudStrength.value,
    slopeX: uniforms.uCloudSunSlope.value.x,
    slopeZ: uniforms.uCloudSunSlope.value.y,
  };
}

const fieldScratch = { x: 0, z: 0 };
const shiftScratch = new Float64Array(2 * CLOUD_DECKS);

/**
 * The shade at an ABSOLUTE world point at height `y`, 0 (full sun) to 1, for the sun
 * slope `(slopeX, slopeZ)` and storm `storm`: the CPU twin of what the ground there reads
 * from the map (render/cloudfield.ts `cloudShadeAlong`).
 */
export function cloudShadowShadeAt(
  seed: number,
  x: number,
  y: number,
  z: number,
  elapsedS: number,
  slopeX: number,
  slopeZ: number,
  storm: number,
): number {
  cloudFieldOf(seed, x, z, elapsedS, fieldScratch);
  return cloudShadeAlong(cloudSet(seed), storm, cloudDeckShift(seed, elapsedS, shiftScratch), fieldScratch.x, y, fieldScratch.z, slopeX, slopeZ);
}
