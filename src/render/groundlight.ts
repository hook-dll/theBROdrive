import * as THREE from 'three';

/**
 * THE GROUND'S OWN LIGHT: sand, rock and road are lit as matt ground, not as Three's
 * physical material.
 *
 * Every ground material was a `MeshStandardMaterial` at roughness 0.93-0.98, metalness
 * 0, and paid for it: for the sun and for EVERY spotlight slot, per fragment, the
 * multiscatter GGX lobe (Fresnel, distribution, visibility and two DFG table lookups),
 * plus the environment's prefiltered specular. At that roughness the lobe is a few per
 * cent of grey that nobody sees. The ground is most of the frame's pixels, so this was
 * the bulk of what each light slot cost (measured 2026-10-16 on the M2 Pro at 1440
 * lines: 8.2 ms at 4 slots, 14.5 at 11, and a cliff from 16.3 to 35.0 ms at 14).
 *
 * What replaces it:
 *  - Lambert, exactly the diffuse term the physical light already had.
 *  - BACKSCATTER (the opposition surge): a grainy surface is brighter when the light
 *    is behind the eye, because the eye then sees the lit faces of the grains and none
 *    of their shadows. It is why low sun behind the camera sets dunes glowing and why
 *    a driver's own beams light the road ahead more than a bystander sees. No wrap
 *    term: a wrapped Lambert lifts grazing light, and headlamps on a flat road arrive
 *    grazing (cos 0.007 at 100 m), so it lit the far road many times over.
 *  - No specular at all: nothing on the ground reflects, the road included (owner,
 *    2026-10-16: desert asphalt is matt, and it dries in minutes after rain).
 *  - The environment as irradiance only. Its prefiltered specular is gone.
 *
 * The macros are redefined right after Three's physical lighting chunk, so every
 * `RE_Direct` call in the light loops (including the ground's slope-normal spotlight
 * call, render/comic.ts) and the one `RE_IndirectSpecular` call resolve to these.
 */

/**
 * Peak brightening by backscatter, at light exactly behind the eye. Lunar regolith and
 * dry sand measure 20-40 % within a few degrees; a third of the low end, spread over
 * tens of degrees by the cos^8 falloff, so a driver's own beams read a little brighter
 * and nothing turns into a hot spot.
 */
const BACKSCATTER_GAIN = 0.2;

const GROUND_LIGHT_GLSL = /* glsl */ `#include <lights_physical_pars_fragment>
void RE_Direct_Ground( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	float behind = saturate( dot( geometryViewDir, directLight.direction ) );
	behind *= behind;
	behind *= behind;
	behind *= behind;
	reflectedLight.directDiffuse += irradiance * ( 1.0 + ${BACKSCATTER_GAIN.toFixed(3)} * behind ) * BRDF_Lambert( material.diffuseContribution );
}
void RE_IndirectSpecular_Ground( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += material.diffuseContribution * irradiance * RECIPROCAL_PI;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Ground
#undef RE_IndirectSpecular
#define RE_IndirectSpecular RE_IndirectSpecular_Ground
`;

const GROUND_LIGHT_KEY = 'ground-light-v1';
const patched = new WeakSet<THREE.Material>();

/**
 * Gives one ground material the ground light above. Chains onto the patches already on
 * it (comic, cloud shadow, desert ground) and is idempotent, like `applyCloudShadow`.
 */
export function applyGroundLight<T extends THREE.MeshStandardMaterial>(material: T): T {
  if (patched.has(material)) return material;
  patched.add(material);
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    const include = '#include <lights_physical_pars_fragment>';
    if (!shader.fragmentShader.includes(include)) {
      throw new Error('Three physical fragment layout changed');
    }
    shader.fragmentShader = shader.fragmentShader.replace(include, GROUND_LIGHT_GLSL);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:${GROUND_LIGHT_KEY}`;
  return material;
}
