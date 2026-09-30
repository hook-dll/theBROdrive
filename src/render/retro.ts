/**
 * THE RETRO RUNG: a fixed low-resolution frame in whole pixels.
 *
 * `acceptable` on an Intel N100 mini-PC measured 36.5 ms of GPU per frame at 0.92 Mpx,
 * with 12 ms of CPU — a GPU-bound 20 FPS — and every lever below it only removed more
 * pixels and stretched the rest bilinearly, which reads as a broken image rather than a
 * cheap one. This rung answers the same machine with a different picture: roughly 360
 * lines, upscaled by an INTEGER factor with nearest filtering, so each pixel is a crisp
 * block and the frame reads as a deliberate style (Quake II ran at 640x480) instead of
 * as a blur. A quarter of the pixels is roughly a quarter of the fill, which is where
 * that machine's time was going.
 *
 * It is decided ONCE, at load, and switching to or from it reloads the drive. Two things
 * it changes are baked at build time and cannot be swapped in place: the ground-cover
 * geometry (cached forms, instanced per chunk) and the finishing pass's program variant.
 */

import * as THREE from 'three';

let active = false;

/** Whether this load was built for the retro rung. Fixed for the page's lifetime. */
export function retroActive(): boolean {
  return active;
}

/** Called once from main.ts, before any world geometry or material is built. */
export function installRetro(): void {
  if (active) return;
  active = true;
  installCheapSpecular();
}

/**
 * Blinn-Phong in place of multiscatter GGX for every direct light, in every lit material.
 *
 * Three's physical direct term evaluates the full GGX lobe AND two lookups into the DFG
 * table per light per fragment, and on an immediate-mode integrated GPU every overdrawn
 * fragment pays it again. A period renderer had no specular at all; this keeps a sun
 * glint on paint and glass — roughness mapped to the equivalent Blinn-Phong exponent —
 * for a fraction of the arithmetic. Installed into the shared chunk before anything
 * compiles, the same way render/lightshader.ts guards its light loop, so the comic,
 * ground and car materials that patch the standard shader all get it.
 */
function installCheapSpecular(): void {
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  const direct =
    'reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );';
  const entry = 'void RE_Direct_Physical(';
  if (!chunk.includes(direct) || !chunk.includes(entry)) {
    throw new Error('Three physical direct-light shader layout changed');
  }
  // The physical program does not include the Blinn-Phong chunk, so the lobe is here.
  // Roughness goes to an exponent through the GGX alpha, 2 / alpha^2 - 2.
  const lobe = `vec3 retroSpecular( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	float alpha = max( pow2( material.roughness ), 0.02 );
	// Never below 1: rough matt surfaces reach 0, and pow( 0.0, 0.0 ) is undefined in GLSL.
	float shininess = clamp( 2.0 / pow2( alpha ) - 2.0, 1.0, 2048.0 );
	vec3 F = F_Schlick( material.specularColorBlended, material.specularF90, dotVH );
	return F * ( 0.25 * RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess ) );
}

`;
  THREE.ShaderChunk.lights_physical_pars_fragment = chunk
    .replace(entry, lobe + entry)
    .replace(
      direct,
      'reflectedLight.directSpecular += irradiance * retroSpecular( directLight.direction, geometryViewDir, geometryNormal, material );',
    );
}

/**
 * Target line count. 360 is 1080p divided by three, 1440p by four, 720p by two and 4K by
 * six — every common panel lands on it exactly, so the pixels are square and even.
 */
const RETRO_LINES = 360;

/**
 * The drawing-buffer ratio for a canvas `cssHeight` CSS pixels tall on a display of
 * `devicePixelRatio`: the display's own pixels divided by a WHOLE number, so the
 * compositor's nearest-neighbour upscale gives every source pixel the same size. A
 * fractional factor would leave some rows and columns doubled and others not, which
 * shimmers in motion.
 */
export function retroPixelRatio(cssHeight: number, devicePixelRatio: number): number {
  const deviceLines = Math.max(1, cssHeight) * devicePixelRatio;
  const factor = Math.max(1, Math.round(deviceLines / RETRO_LINES));
  return devicePixelRatio / factor;
}
