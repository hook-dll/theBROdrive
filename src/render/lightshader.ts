import * as THREE from 'three';

/**
 * Keep every light slot and its program variant, but skip exactly black uniforms.
 * Install globally before compilation so ordinary, comic and loaded car materials
 * agree. The condition is uniform across fragments; all active-light/shadow operations
 * remain untouched. (The spot loop has its own, `installClusteredSpotLoop`.)
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

/**
 * A spot slot whose colour (three's `color * intensity`) has no channel this bright is
 * DORMANT and skipped by the spot loop. The rig parks an unclaimed slot at 1e-8
 * (render/vehiclelights.ts `DORMANT_INTENSITY`), a hundredth of this; a lit lamp fading
 * through it is a millionth of a candela, nothing any pixel shows.
 */
export const SPOT_LIGHT_LIVE_MIN = 1e-6;

/** A `SPOT_REACH` mask with every slot in reach (an int uniform: all 32 bits set). */
export const SPOT_REACH_ALL = -1;

/**
 * THE CLUSTERED SPOT LOOP. Three draws spotlights as a loop over every slot, unrolled, so
 * a lit fragment paid for every slot the tier compiled: pixels x slots, the measured
 * 13-slot cliff (game/settings.ts), and the reason far traffic lamps lost their light.
 * Here a fragment shades only the beams that can reach it:
 *
 *  - FIXED slots, the ones three gives a shadow map or a light map (the driven car's
 *    shadowed headlamp, index 0 while `NUM_SPOT_LIGHT_SHADOWS` is 1; a lamp in the room
 *    scene), keep three's unrolled body as three wrote it: the samplers need a constant
 *    index. Each is skipped by a uniform branch when DORMANT (`SPOT_LIGHT_LIVE_MIN`) or out
 *    of reach (`SPOT_REACH`, below).
 *  - Every other slot is CLUSTERED. render/spotclusters.ts cuts the scene pass's view
 *    frustum into `SPOT_CLUSTER_TILES_X` x `_Y` screen tiles by `SPOT_CLUSTER_SLICES`
 *    depth slices and writes, per cell, a bit for each beam that can light any point of
 *    it (render/vehiclelights.ts `spotReaches`, the test the kit car's mask uses). The
 *    fragment reads its cell's word from `spotClusterMap` and loops over the set bits,
 *    each a dynamic index into three's own `spotLights`, through three's own
 *    `getSpotLightInfo` and `RE_Direct`. A beam left out of a cell is one whose cone or
 *    range ends before the cell, so its light there was exactly zero: the picture is the
 *    same, and only the beams that reach a pixel cost it anything.
 *  - With the grid off (`spotClusterGrid.x` 0: the ending, any other scene) the word is
 *    every clustered slot, each still skipped when dormant, which is the old loop's light
 *    in a loop of one body. `spotClusterGrid.x` below 0 says no clustered slot is lit at
 *    all (noon, or a mirror while every lamp is off): the word is 0 before the lookup.
 *
 * `SPOT_REACH` is a macro a material may define before this chunk: render/materials.ts
 * gives a kit car's body and glass a per-car mask of slots (bit `i` for spot `i`), which
 * main.ts fills for the occupied car from render/vehiclelights.ts `spotReachMask`.
 * Everyone else's is `true`.
 *
 * The program is fixed: the slot count, the shadowed slot and the grid size are the same
 * all session; the cluster map and grid are uniforms. The loop body is compiled once, not
 * once per slot. Derivatives must not be taken inside the clustered loop (its trip count
 * differs between neighbouring cells): the ground's slope normal (render/comic.ts) is
 * taken before it.
 *
 * DRIVER RISK, stated plainly. The dormant intensity is nonzero because some drivers
 * specialized the first executed program around an exactly-zero light contribution and
 * stalled for seconds when a slot first lit (vehiclelights.ts). No slot's uniforms ever
 * reach exactly zero, and the bodies are in the program from the boot; a driver that
 * specializes on uniform VALUES could still fold a never-taken branch away. The first
 * headlamp of a session on Windows/ANGLE is the moment to watch for a hitch.
 */
export const SPOT_CLUSTER_TILES_X = 16;
export const SPOT_CLUSTER_TILES_Y = 9;
export const SPOT_CLUSTER_SLICES = 24;
/**
 * Depth slices are geometric, two per octave from `SPOT_CLUSTER_NEAR_M` (anything nearer
 * is slice 0) to `SPOT_CLUSTER_NEAR_M * 2^(SLICES / 2)`, 2048 m: a fragment beyond that
 * gets no clustered light, so the grid is used only while every live beam's reach ends
 * inside it (render/spotclusters.ts).
 */
export const SPOT_CLUSTER_NEAR_M = 0.5;
export const SPOT_CLUSTER_SLICES_PER_OCTAVE = 2;
/** The most clustered slots one cell word can name. */
export const SPOT_CLUSTER_MAX_LIGHTS = 32;

/** A texture every lit material binds as the same object (three clones uniforms per material). */
class SharedDataTexture extends THREE.DataTexture {
  override clone(): this {
    return this;
  }
}

/** One `uint` per cell: bit `b` is spot `SPOT_FIXED_LIGHTS + b`. Written by render/spotclusters.ts. */
export const spotClusterMap = new SharedDataTexture(
  new Uint32Array(SPOT_CLUSTER_TILES_X * SPOT_CLUSTER_TILES_Y * SPOT_CLUSTER_SLICES),
  SPOT_CLUSTER_TILES_X,
  SPOT_CLUSTER_TILES_Y * SPOT_CLUSTER_SLICES,
  THREE.RedIntegerFormat,
  THREE.UnsignedIntType,
);
spotClusterMap.name = 'spot-clusters';
spotClusterMap.needsUpdate = true;
/**
 * Tiles per pixel (x, y) and the slice of a view depth `d`, `floor( log2( d ) * z + w )`.
 * `x` 0 turns the grid off (every clustered slot), below 0 says none is lit. A typed
 * array, so three's per-material uniform clone shares it rather than copying it.
 */
export const spotClusterGrid = new Float32Array(4);

const SPOT_CLUSTER_PARS = /* glsl */ `
#define SPOT_FIXED_LIGHTS ( NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_MAPS - NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
#define SPOT_CLUSTER_LIGHTS ( NUM_SPOT_LIGHTS - SPOT_FIXED_LIGHTS )
#if SPOT_CLUSTER_LIGHTS > 0
uniform highp usampler2D spotClusterMap;
uniform vec4 spotClusterGrid;
uint spotClusterMask( const in vec3 viewPosition ) {
	#if SPOT_CLUSTER_LIGHTS >= ${SPOT_CLUSTER_MAX_LIGHTS}
	uint everyLight = 0xffffffffu;
	#else
	uint everyLight = ( 1u << uint( SPOT_CLUSTER_LIGHTS ) ) - 1u;
	#endif
	if ( spotClusterGrid.x < 0.0 ) return 0u;
	if ( spotClusterGrid.x == 0.0 ) return everyLight;
	int slice = int( floor( log2( max( - viewPosition.z, 1e-6 ) ) * spotClusterGrid.z + spotClusterGrid.w ) );
	if ( slice >= ${SPOT_CLUSTER_SLICES} ) return 0u;
	ivec2 tile = min( ivec2( gl_FragCoord.xy * spotClusterGrid.xy ), ivec2( ${SPOT_CLUSTER_TILES_X - 1}, ${SPOT_CLUSTER_TILES_Y - 1} ) );
	tile.y += max( slice, 0 ) * ${SPOT_CLUSTER_TILES_Y};
	return texelFetch( spotClusterMap, tile, 0 ).r & everyLight;
}
#endif`;

/** The lit materials three builds from `ShaderLib` (the game draws no lit `ShaderMaterial`). */
const LIT_SHADER_LIBS = ['standard', 'physical', 'lambert', 'phong', 'toon'] as const;

function installClusteredSpotLoop(): void {
  const pars = THREE.ShaderChunk.lights_pars_begin;
  if (pars.includes('spotClusterMask')) return;
  const spotUniform = 'uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];';
  if (!pars.includes(spotUniform)) throw new Error('Three spot-light uniform layout changed');
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const spotLoop = /(#pragma unroll_loop_start\s+for \( int i = 0; i < NUM_SPOT_LIGHTS; i \+\+ \) \{\s*)(spotLight = spotLights\[ i \];[\s\S]*?(RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);))(\s*\}\s*#pragma unroll_loop_end)/;
  if (!spotLoop.test(chunk) || !chunk.includes('getSpotLightInfo( spotLight, geometryPosition, directLight );')) {
    throw new Error('Three spot-light shader layout changed');
  }
  THREE.ShaderChunk.lights_pars_begin = pars.replace(spotUniform, `${spotUniform}\n${SPOT_CLUSTER_PARS}`);
  const live = (light: string): string => `max3( ${light}.color ) >= ${SPOT_LIGHT_LIVE_MIN.toExponential()}`;
  THREE.ShaderChunk.lights_fragment_begin = chunk.replace(
    spotLoop,
    `#ifndef SPOT_REACH
	#define SPOT_REACH( index ) true
	#endif
	$1#if ( UNROLLED_LOOP_INDEX < SPOT_FIXED_LIGHTS )
		if ( ${live('spotLights[ i ]')} && SPOT_REACH( UNROLLED_LOOP_INDEX ) ) {
		$2
		}
		#endif$4

	#if SPOT_CLUSTER_LIGHTS > 0
	for ( uint spotMask = spotClusterMask( geometryPosition ); spotMask != 0u; spotMask &= spotMask - 1u ) {
		// The lowest set bit's index (GLSL ES 3.00 has no findLSB): the exponent of the
		// float that power of two converts to, exactly.
		int spotIndex = SPOT_FIXED_LIGHTS + int( ( floatBitsToUint( float( spotMask & ( ~ spotMask + 1u ) ) ) >> 23u ) - 127u );
		spotLight = spotLights[ spotIndex ];
		if ( ${live('spotLight')} && SPOT_REACH( spotIndex ) ) {
			getSpotLightInfo( spotLight, geometryPosition, directLight );
			$3
		}
	}
	#endif`,
  );
  for (const id of LIT_SHADER_LIBS) {
    const uniforms = THREE.ShaderLib[id].uniforms as Record<string, THREE.IUniform>;
    uniforms.spotClusterMap = { value: spotClusterMap };
    uniforms.spotClusterGrid = { value: spotClusterGrid };
  }
}

/**
 * The sun's normal bias, turned toward the light and scaled by the slope.
 *
 * Three offsets the shadow lookup by `normal * shadowNormalBias`. Two things go wrong
 * with that here:
 *  - Kit cabins and the cars' shells are DOUBLE-SIDED zero-thickness panels. A door
 *    card or seat lit on its back face is shaded with the flipped normal, but the
 *    vertex normal still points away from the sun, so three's offset pushed the
 *    lookup INTO the surface and the panel banded with its own depth.
 *  - One constant cannot serve both the sand and a wall. Under a high sun the sand's
 *    offset points straight at the light and erases the car's contact shadow
 *    (tools/shadow-bias.ts), so the bias was cut to 2 cm; a wall or a seat back the
 *    sun grazes needs about a shadow texel (7 cm), and at 2 cm it crawled with acne
 *    as the shadow box followed the camera.
 *
 * So the offset is the normal flipped to the light's side, times sin(angle to the
 * light): full on a surface the sun grazes, none on one it faces square, where the
 * depth bias alone suffices. The light's direction is the depth row of the shadow
 * matrix, so no new uniform and no program variant. Directional shadows only: the
 * headlamp spot keeps three's offset.
 */
function installSunShadowSlopeBias(): void {
  const marker = 'shadowLightDir';
  const chunk = THREE.ShaderChunk.shadowmap_vertex;
  if (chunk.includes(marker)) return;
  const line = 'shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );';
  if (!chunk.includes(line)) throw new Error('Three directional shadow vertex layout changed');
  THREE.ShaderChunk.shadowmap_vertex = chunk.replace(
    line,
    `{
				mat4 shadowMatrix = directionalShadowMatrix[ i ];
				// Depth grows away from the light (toward it on the reversed buffer,
				// render/depthconvention.ts): its gradient is the light's direction.
				#ifdef USE_REVERSED_DEPTH_BUFFER
				vec3 ${marker} = normalize( vec3( shadowMatrix[ 0 ][ 2 ], shadowMatrix[ 1 ][ 2 ], shadowMatrix[ 2 ][ 2 ] ) );
				#else
				vec3 ${marker} = -normalize( vec3( shadowMatrix[ 0 ][ 2 ], shadowMatrix[ 1 ][ 2 ], shadowMatrix[ 2 ][ 2 ] ) );
				#endif
				float shadowCos = dot( shadowWorldNormal, ${marker} );
				float shadowSin = sqrt( max( 1.0 - shadowCos * shadowCos, 0.0 ) );
				vec3 shadowFacing = shadowCos < 0.0 ? -shadowWorldNormal : shadowWorldNormal;
				shadowWorldPosition = worldPosition + vec4( shadowFacing * ( shadowSin * directionalLightShadows[ i ].shadowNormalBias ), 0 );
			}`,
  );
}
/**
 * Shadow edges that stay put on screen.
 *
 * Three's PCF takes five hardware-filtered taps on a Vogel disk and turns the disk per
 * PIXEL by interleaved gradient noise (`gl_FragCoord`). The noise is fixed to the screen
 * while the world moves under it, so every shadow edge (a building's on the sand, a car's,
 * the roof's on a seat) was redrawn with a different dither each frame: it flickered and
 * crawled whenever the camera moved, and the sun's box snapping to its texel grid
 * (render/sky.ts) cannot hold that still.
 *
 * Four taps at a fixed half-texel cross instead. Each is the hardware's 2x2 compare,
 * so the sum is a two-texel tent over the shadow map: soft, and anchored to the map,
 * so it moves with the world and not with the pixels. One tap fewer than three's. The
 * chunk changes for every program alike, before any compiles: no variant.
 */
function installStableShadowFilter(): void {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const marker = 'shadowStableTap';
  if (chunk.includes(marker)) return;
  const disk = /float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;\s*shadow = \(\s*texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample\( 0, 5, phi \) \* radius, shadowCoord\.z \) \) \+[\s\S]*?vogelDiskSample\( 4, 5, phi \) \* radius, shadowCoord\.z \) \)\s*\) \* 0\.2;/;
  if (!disk.test(chunk)) throw new Error('Three PCF shadow layout changed');
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(
    disk,
    `vec2 ${marker} = texelSize * ( 0.5 * max( shadowRadius, 1.0 ) );
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vec2( -${marker}.x, -${marker}.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( ${marker}.x, -${marker}.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( -${marker}.x, ${marker}.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( ${marker}.x, ${marker}.y ), shadowCoord.z ) )
				) * 0.25;`,
  );
}

/**
 * The sun's near cascade (render/sky.ts `sunNearLight`): a second shadow-casting
 * directional light, black and dark in every lit program, whose map is a small box
 * around the eye at about a fifth of the sun's texel. Directional light 0 is the sun,
 * 1 the cascade (sky.ts adds them in that order and nothing else in the world scene is
 * a directional light; render/comic.ts reads the sun as light 0 too).
 *
 * When a program has exactly two directional shadows, the sun's shadow is read from
 * the near map wherever the fragment is inside it, from the wide map outside, and
 * mixed across the near box's last 8% of its side so the edge does not show; the
 * cascade's own loop pass is compiled out, so it lights nothing and costs no taps.
 * Any other count (the ending's own sky, galleries) keeps three's loop as it is.
 *
 * The near map is filtered wider than `installStableShadowFilter`'s cross: nine of the
 * hardware's 2x2 compares 1.5 texels apart, weighted 1-2-1 each way, a smooth kernel
 * five texels (8 cm) across. Magnified that close, the cross's two-texel tent still
 * showed every texel of a diagonal edge as a step, and a car's shadow under a low sun
 * wants a penumbra of that order anyway (the sun's half degree over the 3-5 m from a
 * roof to the sand). Nine taps on the fragments within the box only; outside it the
 * wide map's four as before. Fixed to the map like the cross, so edges do not crawl.
 *
 * A single hardware compare here gave a crisp silhouette; the owner read its 1.6 cm
 * steps as a hard, stair-stepped car shadow (2026-10-16), and a soft edge is as still
 * from frame to frame as a crisp one.
 *
 * The chunks change for every program alike, before any compiles: no variant. The
 * `&& receiveShadow )` test stays verbatim for the kit body's gate (render/materials.ts
 * `kitLightsBegin`).
 */
function installSunShadowCascade(): void {
  const marker = 'sunCascadeShadow';
  const lights = THREE.ShaderChunk.lights_fragment_begin;
  if (lights.includes(marker)) return;
  const loop = /(for \( int i = 0; i < NUM_DIR_LIGHTS; i \+\+ \) \{\s*)(directionalLight = directionalLights\[ i \];[\s\S]*?)(directLight\.color \*= \( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap\[ i \],[^;]*;)([\s\S]*?RE_Direct\([^;]*;)(\s*\}\s*#pragma unroll_loop_end)/;
  if (!loop.test(lights)) throw new Error('Three directional-light shader layout changed');
  THREE.ShaderChunk.lights_fragment_begin = lights.replace(
    loop,
    `$1#if !( NUM_DIR_LIGHT_SHADOWS == 2 && UNROLLED_LOOP_INDEX == 1 )
		$2#if NUM_DIR_LIGHT_SHADOWS == 2
		directLight.color *= ( directLight.visible && receiveShadow ) ? ${marker}() : 1.0;
		#else
		$3
		#endif$4
		#endif$5`,
  );
  const tap = (k: number): string =>
    `getShadow( directionalShadowMap[ ${k} ], directionalLightShadows[ ${k} ].shadowMapSize, directionalLightShadows[ ${k} ].shadowIntensity, directionalLightShadows[ ${k} ].shadowBias, directionalLightShadows[ ${k} ].shadowRadius, vDirectionalShadowCoord[ ${k} ] )`;
  THREE.ShaderChunk.shadowmap_pars_fragment += `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS == 2
	#if defined( SHADOWMAP_TYPE_PCF )
	float sunNearShadow() {
		vec4 coord = vDirectionalShadowCoord[ 1 ];
		vec3 uv = coord.xyz / coord.w;
		#ifdef USE_REVERSED_DEPTH_BUFFER
		uv.z -= directionalLightShadows[ 1 ].shadowBias;
		#else
		uv.z += directionalLightShadows[ 1 ].shadowBias;
		#endif
		vec2 texel = 1.5 * max( directionalLightShadows[ 1 ].shadowRadius, 1.0 ) / directionalLightShadows[ 1 ].shadowMapSize;
		float shadow = 0.0;
		for ( int y = -1; y <= 1; y ++ ) {
			for ( int x = -1; x <= 1; x ++ ) {
				float weight = ( x == 0 ? 2.0 : 1.0 ) * ( y == 0 ? 2.0 : 1.0 );
				shadow += weight * texture( directionalShadowMap[ 1 ], vec3( uv.xy + vec2( float( x ), float( y ) ) * texel, uv.z ) );
			}
		}
		return mix( 1.0, shadow / 16.0, directionalLightShadows[ 1 ].shadowIntensity );
	}
	#else
	float sunNearShadow() {
		return ${tap(1)};
	}
	#endif
	float ${marker}() {
		vec3 nearUv = vDirectionalShadowCoord[ 1 ].xyz / vDirectionalShadowCoord[ 1 ].w;
		vec2 nearEdge = min( nearUv.xy, 1.0 - nearUv.xy );
		#ifdef USE_REVERSED_DEPTH_BUFFER
		float nearWeight = smoothstep( 0.0, 0.08, min( nearEdge.x, nearEdge.y ) ) * step( 0.0, nearUv.z );
		#else
		float nearWeight = smoothstep( 0.0, 0.08, min( nearEdge.x, nearEdge.y ) ) * step( nearUv.z, 1.0 );
		#endif
		float nearShadow = 1.0;
		float wideShadow = 1.0;
		if ( nearWeight > 0.0 ) nearShadow = sunNearShadow();
		if ( nearWeight < 1.0 ) wideShadow = ${tap(0)};
		return mix( wideShadow, nearShadow, nearWeight );
	}
#endif
`;
}

/**
 * Unlit colour and emission are authored as SCREEN values.
 *
 * Until the colour pipeline was corrected (core/renderer.ts `drawFrame`) the frame
 * reached the display linear-encoded, so an unlit material's colour and a lit one's
 * emission were shown at their own numbers: every lens glow, mirage card, dust streak
 * and basic-material prop was tuned by the pixel it made. The encoded frame showed them
 * all a gamma brighter than the lit world they were tuned against (the drift streaks in
 * a haboob went from barely there to bright yellow). So MeshBasicMaterial's colour and
 * every material's emission are decoded from sRGB here, in the shared chunks — one
 * program per material as before, no new variants — and reach the screen as authored.
 * A basic material that shows real radiance (a mirror face, render/carmirrors.ts) sets
 * the SCENE_RADIANCE define to keep it.
 */
function installScreenAuthoredUnlit(): void {
  const decode = 'sRGBTransferEOTF( vec4( max( %, vec3( 0.0 ) ), 1.0 ) ).rgb';
  const basicLine = 'vec3 outgoingLight = reflectedLight.indirectDiffuse;';
  const basic = THREE.ShaderLib.basic.fragmentShader;
  if (!basic.includes('SCENE_RADIANCE')) {
    if (!basic.includes(basicLine)) throw new Error('Three basic-material shader layout changed');
    THREE.ShaderLib.basic.fragmentShader = basic.replace(
      basicLine,
      `${basicLine}\n\t#ifndef SCENE_RADIANCE\n\toutgoingLight = ${decode.replace('%', 'outgoingLight')};\n\t#endif`,
    );
  }
  const emissive = THREE.ShaderChunk.emissivemap_fragment;
  if (!emissive.includes('totalEmissiveRadiance = sRGB')) {
    THREE.ShaderChunk.emissivemap_fragment =
      `${emissive}\ntotalEmissiveRadiance = ${decode.replace('%', 'totalEmissiveRadiance')};\n`;
  }
}

/**
 * Three r185's PCF shadow on the reversed depth buffer (render/depthconvention.ts) still
 * ADDS the bias and drops only fragments past z = 1, both written for the ordinary
 * buffer (mrdoob/three.js#34891; its VSM and basic paths already flip). Reversed, a
 * fragment is nearer the light as its z grows, the far plane is z = 0, and the bias
 * (negative, toward the light) must be subtracted, or every receiver is pushed into its
 * own shadow. Every program alike, behind the define three sets for the page: no variant.
 */
function installReversedPcfBias(): void {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const marker = 'reversedPcfBias';
  if (chunk.includes(marker)) return;
  const pcf = /shadowCoord\.xyz \/= shadowCoord\.w;\s*shadowCoord\.z \+= shadowBias;(\s*bool inFrustum = [^;]*;)\s*bool frustumTest = inFrustum && shadowCoord\.z <= 1\.0;/;
  if (!pcf.test(chunk)) throw new Error('Three PCF shadow bias layout changed');
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(
    pcf,
    `shadowCoord.xyz /= shadowCoord.w;
			// ${marker}
			#ifdef USE_REVERSED_DEPTH_BUFFER
			shadowCoord.z -= shadowBias;
			#else
			shadowCoord.z += shadowBias;
			#endif$1
			#ifdef USE_REVERSED_DEPTH_BUFFER
			bool frustumTest = inFrustum && shadowCoord.z >= 0.0;
			#else
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			#endif`,
  );
}

installPointLightZeroGuard();
installClusteredSpotLoop();
installSunShadowSlopeBias();
installStableShadowFilter();
installReversedPcfBias();
installSunShadowCascade();
installScreenAuthoredUnlit();
