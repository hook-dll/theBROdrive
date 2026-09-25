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

/** Sun shadows fade out between these view distances, metres. */
const SHADOW_FADE_FROM_M = 78;
const SHADOW_FADE_TO_M = 100;
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

/** Metres over which the haze thins by a factor of e, rising. */
const HAZE_SCALE_HEIGHT_M = 70;
/** Bounds on how much thicker or thinner than at eye level a sight line's haze is. */
const HAZE_THINNEST = 0.35;
const HAZE_THICKEST = 2.2;

/**
 * HAZE LIES LOW. Three's exponential fog is the same air at every height; real haze
 * thins upward, so a valley below the road fills with it and a hill above stands
 * clear. The fog's density is scaled by the mean density along the sight line through
 * air thinning as exp(-height / H) from the eye:
 *
 *   mean = (1 - exp(-k Δ)) / (k Δ),  k = 1 / H,  Δ = target height - eye height
 *
 * Measured from the eye, not from sea level: the land drifts by hundreds of metres
 * from region to region, and haze pooled at an absolute height would bury one region
 * and leave the next bare. On level ground the mean is 1 and nothing changes, so the
 * fog's colour and density (render/sky.ts) keep their meaning.
 */
function installHeightHaze(): void {
  const marker = '/* height-haze */';
  if (THREE.ShaderChunk.fog_pars_vertex.includes(marker)) return;
  const exp2 = 'float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );';
  if (!THREE.ShaderChunk.fog_fragment.includes(exp2) || !THREE.ShaderChunk.fog_vertex.includes('vFogDepth = - mvPosition.z;')) {
    throw new Error('Three fog shader layout changed');
  }
  THREE.ShaderChunk.fog_pars_vertex = `${marker}
#ifdef USE_FOG
	varying float vFogDepth;
	varying float vFogRise;
#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	// World height from the view position: every shader that fogs has mvPosition.
	vFogRise = ( transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) ).y - cameraPosition.y;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = THREE.ShaderChunk.fog_pars_fragment.replace(
    'varying float vFogDepth;',
    'varying float vFogDepth;\n\tvarying float vFogRise;',
  );
  const k = 1 / HAZE_SCALE_HEIGHT_M;
  THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
    exp2,
    `float fogRiseK = vFogRise * ${k.toFixed(5)};
		float fogMean = abs( fogRiseK ) < 0.001 ? 1.0 - 0.5 * fogRiseK : ( 1.0 - exp( - fogRiseK ) ) / fogRiseK;
		float fogAmount = fogDensity * vFogDepth * clamp( fogMean, ${HAZE_THINNEST.toFixed(2)}, ${HAZE_THICKEST.toFixed(2)} );
		float fogFactor = 1.0 - exp( - fogAmount * fogAmount );`,
  );
}

installHeightHaze();
