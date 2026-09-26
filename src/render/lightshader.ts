import * as THREE from 'three';

/**
 * Keep every light slot and its program variant, but skip exactly black uniforms.
 * Install globally before compilation so ordinary, comic and loaded car materials
 * agree. The condition is uniform across fragments; spotlight derivatives and all
 * active-light/shadow operations remain untouched.
 */
function installPointLightZeroGuard(): void {
  const guard = 'if ( any( notEqual( pointLights[ i ].color, vec3( 0.0 ) ) ) )';
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  // Module evaluation is normally once; also tolerate re-evaluation during HMR.
  if (chunk.includes(guard)) return;

  const pointLoop = /(#pragma unroll_loop_start\s+for \( int i = 0; i < NUM_POINT_LIGHTS; i \+\+ \) \{\s*)(pointLight = pointLights\[ i \];[\s\S]*?RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);)(\s*\}\s*#pragma unroll_loop_end)/;
  if (!pointLoop.test(chunk)) throw new Error('Three point-light shader layout changed');
  THREE.ShaderChunk.lights_fragment_begin = chunk.replace(
    pointLoop,
    `$1${guard} {\n\t\t$2\n\t\t}$3`,
  );
}

installPointLightZeroGuard();

/**
 * Sun shadows fade out between these view distances, metres.
 *
 * The shadow map covers the near field only (config/graphics.json
 * `shadowFrustumHalfSize`): the car, the player and the props beside them. A tree over
 * the road used to cast into a ±72 m map, but that is stage 4's job to bake into the
 * ground, and a map that big spent its resolution on empty fields. The fade has to end
 * before the map's own edge or the edge itself becomes a line of popping shadows.
 */
const SHADOW_FADE_FROM_M = 16;
const SHADOW_FADE_TO_M = 24;
/** Share of the shadow map, at each edge, over which its shadows fade out. */
const SHADOW_EDGE_FADE = 0.07;

/**
 * Shadows that hold still while the camera moves. Three things made them flicker:
 *
 *  - three's PCF turns its five taps by a noise fixed to SCREEN pixels. Under a moving
 *    camera the world slides across a still noise, so every shadow edge boiled, and
 *    the comic light bands snap that boil into a hard on/off flicker. The taps are
 *    now turned by one fixed angle: a shadow's edge is a function of where it is in
 *    the world, not on the screen.
 *  - The map's edge. Past it three draws no shadow at all, so as the car drove the
 *    edge swept over the ground and whole tree shadows switched on. They now fade out
 *    over the map's last few percent.
 *  - The trees' shadow range (world/forest.ts casts to 110 m, refilled every 14 m of
 *    travel): a ring of trees gained their shadows at once. Every sun shadow fades out
 *    by `SHADOW_FADE_TO_M`, short of it. Nearer — 55 m was tried — the fade is itself
 *    a ring round the car along a wooded road, dappled near and lit beyond.
 */
function installShadowStabiliser(): void {
  const marker = '/* shadow-stabiliser */';
  const pars = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (pars.includes(marker)) return;

  const noise = 'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;';
  const pcfReturn = /(bool inFrustum = shadowCoord\.x >= 0\.0[^\n]*\n[\s\S]*?)return mix\( 1\.0, shadow, shadowIntensity \);/;
  if (!pars.includes(noise) || !pcfReturn.test(pars)) throw new Error('Three shadow-map shader layout changed');
  THREE.ShaderChunk.shadowmap_pars_fragment = `${marker}
float shadowRangeKeep( float viewDistance ) {
	return 1.0 - smoothstep( ${SHADOW_FADE_FROM_M.toFixed(1)}, ${SHADOW_FADE_TO_M.toFixed(1)}, viewDistance );
}
${pars
  .replaceAll(noise, 'float phi = 0.7;')
  // Only the first, directional/spot `getShadow` of each type is matched per call, so
  // run it until every one carries the edge fade.
  .replace(
    new RegExp(pcfReturn.source, 'g'),
    `$1float shadowEdge = min( min( shadowCoord.x, 1.0 - shadowCoord.x ), min( shadowCoord.y, 1.0 - shadowCoord.y ) );
			return mix( 1.0, shadow, shadowIntensity * smoothstep( 0.0, ${SHADOW_EDGE_FADE.toFixed(3)}, shadowEdge ) );`,
  )}`;

  const lights = THREE.ShaderChunk.lights_fragment_begin;
  const dirCall = /getShadow\( directionalShadowMap\[ i \],[^;]*vDirectionalShadowCoord\[ i \] \)/;
  if (!dirCall.test(lights)) throw new Error('Three directional shadow call layout changed');
  THREE.ShaderChunk.lights_fragment_begin = lights.replace(
    dirCall,
    (call) => `mix( 1.0, ${call}, shadowRangeKeep( length( geometryPosition ) ) )`,
  );
}

installShadowStabiliser();

