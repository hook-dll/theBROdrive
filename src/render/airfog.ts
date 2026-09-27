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
 *    haze and the weather's clarity. Physical and gentle.
 *  - EDGE: 1 - smoothstep(`airFog.y`, `airFog.z`, d), which reaches exactly zero at
 *    the vista's outer radius and nowhere else. It is the draw distance's own fade,
 *    set once per view distance, and has nothing to say about the weather.
 *  - WEATHER: the scene's `FogExp2` density, now carrying ONLY what weather adds (mgla,
 *    rain, a storm deck, a haboob). Its squared falloff is kept because those are
 *    authored as "sight ends at about N metres", which is what exp-squared draws.
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

THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = length( mvPosition.xyz );
#endif
`;

THREE.ShaderChunk.fog_pars_fragment += /* glsl */ `
#ifdef USE_FOG
	uniform vec3 airFog;
#endif
`;

THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	if ( airFog.z > 0.0 ) {
		float airClear = exp( - airFog.x * vFogDepth ) * ( 1.0 - smoothstep( airFog.y, airFog.z, vFogDepth ) );
		fogFactor = 1.0 - ( 1.0 - fogFactor ) * airClear;
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

// Every built-in material that fogs, and anything built from `...UniformsLib.fog`.
(THREE.UniformsLib.fog as Record<string, THREE.IUniform>).airFog = { value: airFog };
for (const shader of Object.values(THREE.ShaderLib)) {
  if ('fogColor' in shader.uniforms) shader.uniforms.airFog = { value: airFog };
}
