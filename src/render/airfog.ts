import * as THREE from 'three';

/**
 * AERIAL PERSPECTIVE, AND THE EDGE OF THE DRAWN WORLD, AS TWO SEPARATE THINGS.
 *
 * The scene fog used to do both jobs with one `FogExp2` density: veil the distance AND
 * hide where the vista mesh stops. Hiding a 1.5-8 km edge that way needs a visibility
 * of a few kilometres, which is thick haze, so under a clear, saturated sky a mesa
 * three kilometres out came out almost entirely the horizon's pale cyan, brighter than
 * the lit ground in front of it. Real air does not do that. Its light is added in
 * proportion to 1 - exp(-beta d) (Beer-Lambert, EXPONENTIAL, not squared), and clear
 * desert air has a visibility of tens of kilometres: a ridge ten kilometres off keeps
 * most of its own colour and only goes a little bluer and flatter.
 *
 * So the fog is now three factors of transmittance multiplied together:
 *
 *  - AIR: exp(-beta d), `airFog.x` = beta per metre, set by the sky from the regional
 *    haze, the weather's clarity, and the veil of mgla, rain and a storm deck — each a
 *    visibility added as extinction (render/sky.ts). Light weather is then light: a
 *    squared falloff for those turned a trace of haze into a solid wall at 4-5 km.
 *  - EDGE: 1 - smoothstep(`airFog.y`, `airFog.z`, d), which reaches exactly zero at
 *    the vista's outer radius and nowhere else. It is the draw distance's own fade,
 *    set once per view distance, and has nothing to say about the weather.
 *  - DUST: the scene's `FogExp2` density, now carrying ONLY a haboob. Its squared
 *    falloff is kept because a dust storm is a wall: clear up to it, blind inside.
 *
 * `vFogDepth` becomes the RADIAL distance from the eye rather than view-space depth.
 * The vista is a camera-centred disc, so its edge is a constant radius: by depth, the
 * edge at the sides of a wide field of view sat nearer than R and never finished
 * fading, and turning the camera slid the veil across the land.
 *
 * The uniform's value is a plain object on purpose: `UniformsUtils.clone` copies three
 * vectors per material but passes a plain object through by reference, so every
 * material shares this one and a write here reaches all of them. Three's vec3 setter
 * reads `.x .y .z`, so it uploads like a Vector3. A material that never received it
 * (a hand-written ShaderMaterial) sees zeros, and the shader treats `z = 0` as "no air
 * term" rather than fogging everything out.
 */
export const airFog = { x: 0, y: 0, z: 0 };
/**
 * The colour the dome's gradient climbs to, as the land's fog sees it: the other end of
 * `mix(fogColor, airSky, pow(h, 0.62))`, the dome's own law (render/sky.ts), so a
 * fogged fragment takes the sky's colour at ITS elevation rather than at h = 0. With
 * one flat fogColor, a mesa top a couple of degrees up dissolved into the h = 0 band
 * while the sky just above it had already climbed toward the zenith, and stood out as
 * a pale cut-out brighter than the sky behind it. Shared by reference like `airFog`.
 */
export const airSky = { x: 0, y: 0, z: 0 };
/**
 * The dome's anti-solar darkening, for the land's fog: `airSun` is the direction TO
 * the sun scaled by the term's strength (the dome's `uAntiSolar`, zero away from dawn
 * and dusk), `airDusk` the colour the low sky opposite the sun is pulled toward. The
 * dome mixes its horizon toward it behind you at twilight; without the same pull the
 * far ridges kept the glow of the sunset side and stood brighter than the dark sky
 * above them.
 */
export const airSun = { x: 0, y: 0, z: 0 };
export const airDusk = { x: 0, y: 0, z: 0 };

/** Where the edge fade starts, as a fraction of the vista's outer radius. */
const EDGE_FADE_START = 0.55;
/** ...and where it is complete, just inside the mesh's own rim. */
const EDGE_FADE_END = 0.97;

/** The drawn world ends `outerRadius` metres from the eye. */
export function setAirFogEdge(outerRadius: number): void {
  airFog.y = outerRadius * EDGE_FADE_START;
  airFog.z = outerRadius * EDGE_FADE_END;
}

/** Extinction of the clear air, per metre. */
export function setAirFogExtinction(beta: number): void {
  airFog.x = beta;
}

/** The top of the land fog's gradient; see `airSky`. */
export function setAirFogSky(color: THREE.Color): void {
  airSky.x = color.r;
  airSky.y = color.g;
  airSky.z = color.b;
}

/** The anti-solar pull; see `airSun`. `strength` 0 switches it off. */
export function setAirFogSun(sunDirection: THREE.Vector3, strength: number, dusk: THREE.Color): void {
  airSun.x = sunDirection.x * strength;
  airSun.y = sunDirection.y * strength;
  airSun.z = sunDirection.z * strength;
  airDusk.x = dusk.r;
  airDusk.y = dusk.g;
  airDusk.z = dusk.b;
}

THREE.ShaderChunk.fog_pars_vertex += /* glsl */ `
#ifdef USE_FOG
	varying vec3 vFogDir;
#endif
`;

THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = length( mvPosition.xyz );
	// World-space sight line: the view rotation's transpose takes an eye-space
	// direction back to world space.
	vFogDir = ( transpose( mat3( viewMatrix ) ) * mvPosition.xyz ) / max( vFogDepth, 1e-3 );
#endif
`;

THREE.ShaderChunk.fog_pars_fragment += /* glsl */ `
#ifdef USE_FOG
	uniform vec3 airFog;
	uniform vec3 airSky;
	uniform vec3 airSun;
	uniform vec3 airDusk;
	varying vec3 vFogDir;
#endif
`;

THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 fogTint = fogColor;
	if ( airFog.z > 0.0 ) {
		float airClear = exp( - airFog.x * vFogDepth ) * ( 1.0 - smoothstep( airFog.y, airFog.z, vFogDepth ) );
		fogFactor = 1.0 - ( 1.0 - fogFactor ) * airClear;
		vec3 fogDir = normalize( vFogDir );
		float fogUp = clamp( fogDir.y, 0.0, 1.0 );
		fogTint = mix( fogColor, airSky, pow( fogUp, 0.62 ) );
		// The dome's anti-solar darkening, same law (render/sky.ts).
		float antiSolar = length( airSun );
		if ( antiSolar > 0.0 ) {
			float away = pow( max( - dot( fogDir, airSun / antiSolar ), 0.0 ), 1.5 );
			fogTint = mix( fogTint, airDusk, antiSolar * away * ( 1.0 - smoothstep( 0.0, 0.45, fogUp ) ) );
		}
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif
`;

// Every built-in material that fogs, and anything built from `...UniformsLib.fog`.
(THREE.UniformsLib.fog as Record<string, THREE.IUniform>).airFog = { value: airFog };
(THREE.UniformsLib.fog as Record<string, THREE.IUniform>).airSky = { value: airSky };
(THREE.UniformsLib.fog as Record<string, THREE.IUniform>).airSun = { value: airSun };
(THREE.UniformsLib.fog as Record<string, THREE.IUniform>).airDusk = { value: airDusk };
for (const shader of Object.values(THREE.ShaderLib)) {
  if ('fogColor' in shader.uniforms) {
    shader.uniforms.airFog = { value: airFog };
    shader.uniforms.airSky = { value: airSky };
    shader.uniforms.airSun = { value: airSun };
    shader.uniforms.airDusk = { value: airDusk };
  }
}
