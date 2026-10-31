import * as THREE from 'three';

/**
 * Keep every light slot and its program variant, but skip exactly black uniforms.
 * Install globally before compilation so ordinary, comic and loaded car materials
 * agree. The condition is uniform across fragments; all active-light/shadow operations
 * remain untouched. (The spot loop has its own guard, `installSpotLightDormantGuard`.)
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

/** Three's uniforms for one spot slot (WebGLLights `state.spot[i]`), the fields read here. */
interface SpotSlotUniforms {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  readonly color: THREE.Color;
}

/**
 * The spot slots in three's per-material properties (`renderer.properties.get(material)`:
 * `uniforms.spotLights.value`, shared by every lit material of a render state), or null
 * for a material without lights.
 */
export function spotSlotsOf(materialProperties: unknown): SpotSlotUniforms[] | null {
  if (typeof materialProperties !== 'object' || materialProperties === null || !('uniforms' in materialProperties)) return null;
  const uniforms = materialProperties.uniforms;
  if (typeof uniforms !== 'object' || uniforms === null || !('spotLights' in uniforms)) return null;
  const spot = uniforms.spotLights;
  if (typeof spot !== 'object' || spot === null || !('value' in spot) || !Array.isArray(spot.value)) return null;
  return spot.value;
}

/**
 * A spot slot's view-space position or direction that stays put while the slot is
 * dormant. Three writes both from the camera in every pass (WebGLLights `setupView`:
 * `position.applyMatrix4( viewMatrix )`, `direction.transformDirection( viewMatrix )`),
 * and a program re-sends a uniform whose value moved. So every program re-sent every
 * slot in every pass: the frame and each live mirror each have their own camera, and at
 * noon, with every lamp dark, that was ~1400 `uniform3f` a frame from the mirrors
 * alone. The spot loop never reads a dormant slot's position or direction
 * (`installSpotLightDormantGuard`), so they are held at one value and nothing is sent.
 */
class DormantSpotVector extends THREE.Vector3 {
  constructor(
    private readonly slot: SpotSlotUniforms,
    private readonly held: THREE.Vector3,
  ) {
    super();
  }

  private dormant(): boolean {
    const c = this.slot.color;
    return Math.max(c.r, c.g, c.b) < SPOT_LIGHT_LIVE_MIN;
  }

  override applyMatrix4(m: THREE.Matrix4): this {
    return this.dormant() ? this.copy(this.held) : super.applyMatrix4(m);
  }

  override transformDirection(m: THREE.Matrix4): this {
    return this.dormant() ? this.copy(this.held) : super.transformDirection(m);
  }
}

const HELD_SPOT_POSITION = new THREE.Vector3(0, 0, -1);
const HELD_SPOT_DIRECTION = new THREE.Vector3(0, 0, 1);

/**
 * Gives each of three's spot slots (`spotLights` uniform value: one object per light,
 * kept for the light's life) the held vectors of `DormantSpotVector`. Idempotent.
 */
export function holdDormantSpots(slots: readonly SpotSlotUniforms[]): void {
  for (const slot of slots) {
    if (slot.position instanceof DormantSpotVector) continue;
    slot.position = new DormantSpotVector(slot, HELD_SPOT_POSITION).copy(slot.position);
    slot.direction = new DormantSpotVector(slot, HELD_SPOT_DIRECTION).copy(slot.direction);
  }
}

/**
 * The spot loop skips every slot that cannot light this fragment's material, by a branch
 * on uniforms alone, the same for every fragment of the draw:
 *
 *  - DORMANT slots (`SPOT_LIGHT_LIVE_MIN`). At noon every slot is dormant, and the loop
 *    still ran the whole physical light for each: on the driven car seen from the cabin,
 *    8.4 ms of its 8.65 ms at 1440 lines on the M2 Pro (11 slots; 0.25 ms with none).
 *  - Slots out of reach (`SPOT_REACH`, a macro a material defines before this chunk:
 *    render/materials.ts gives a kit car's body a per-car mask, which main.ts
 *    fills for the occupied car from render/vehiclelights.ts `spotReachMask`, a test of
 *    each lit beam's cone against the car). Everyone else's is `true`.
 *
 * The slot count, the shadowed slot (index 0 while `NUM_SPOT_LIGHT_SHADOWS` is 1) and the
 * program are unchanged: the shadow lookup and the light map sit inside the branch exactly
 * as three wrote them, so a skipped slot contributes what a dormant one did (nothing
 * visible) and a live one exactly what it did before.
 *
 * Inside a live slot the light itself is skipped per fragment where three's
 * `getSpotLightInfo` found none (`directLight.visible` false: outside the outer cone, past
 * the range, colour exactly zero), where `RE_Direct` would add zero. Measured on blessing
 * at 2560x1440 with 10 lit traffic beams, one page and pose: 9.37 -> 9.01 ms, the frame
 * identical to the pixel. That branch differs between neighbouring fragments, so nothing
 * in `RE_Direct` may take screen derivatives: the ground's slope normal (render/comic.ts)
 * takes them before the loop.
 *
 * DRIVER RISK, stated plainly. The dormant intensity is nonzero because some drivers
 * specialized the first executed program around an exactly-zero light contribution and
 * stalled for seconds when a slot first lit (vehiclelights.ts). That rule still holds:
 * no slot's uniforms ever reach exactly zero, and the guarded body is still in the
 * program. What is new is a branch that is never taken until the first lamp lights. A
 * driver that specializes on uniform VALUES could in principle fold that branch away the
 * way it folded the zero light; nothing here can rule that out. The first headlamp of a
 * session on Windows/ANGLE is the moment to watch for a hitch.
 */
function installSpotLightDormantGuard(): void {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (chunk.includes('SPOT_REACH(')) return;

  const spotLoop = /(#pragma unroll_loop_start\s+for \( int i = 0; i < NUM_SPOT_LIGHTS; i \+\+ \) \{\s*)(spotLight = spotLights\[ i \];[\s\S]*?)(RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);)(\s*\}\s*#pragma unroll_loop_end)/;
  if (!spotLoop.test(chunk)) throw new Error('Three spot-light shader layout changed');
  const live = `max3( spotLights[ i ].color ) >= ${SPOT_LIGHT_LIVE_MIN.toExponential()}`;
  THREE.ShaderChunk.lights_fragment_begin = chunk.replace(
    spotLoop,
    `#ifndef SPOT_REACH
	#define SPOT_REACH( index ) true
	#endif
	$1if ( ${live} && SPOT_REACH( UNROLLED_LOOP_INDEX ) ) {\n\t\t$2if ( directLight.visible ) $3\n\t\t}$4`,
  );
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
 * Three's PCF shadow on the reversed depth buffer (render/depthconvention.ts) drops only
 * fragments past z = 1, a test written for the ordinary buffer. Reversed, the shadow
 * camera's far plane is z = 0, so a fragment past it must be dropped below 0. Three r187
 * flips the BIAS itself (mrdoob/three.js#34892; r185 still added it, and this patch
 * subtracted it) but not this test. Every program alike, behind the define three sets
 * for the page: no variant.
 */
function installReversedPcfFarTest(): void {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const marker = 'reversedPcfFarTest';
  if (chunk.includes(marker)) return;
  const upstreamBias = /#ifdef USE_REVERSED_DEPTH_BUFFER\s*shadowCoord\.z -= shadowBias;/;
  const pcf = /(#if defined\( SHADOWMAP_TYPE_PCF \)[\s\S]*?bool inFrustum = [^;]*;)\s*bool frustumTest = inFrustum && shadowCoord\.z <= 1\.0;/;
  if (!upstreamBias.test(chunk) || !pcf.test(chunk)) throw new Error('Three PCF shadow layout changed');
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(
    pcf,
    `$1
			// ${marker}
			#ifdef USE_REVERSED_DEPTH_BUFFER
			bool frustumTest = inFrustum && shadowCoord.z >= 0.0;
			#else
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			#endif`,
  );
}

installPointLightZeroGuard();
installSpotLightDormantGuard();
installSunShadowSlopeBias();
installStableShadowFilter();
installReversedPcfFarTest();
installSunShadowCascade();
installScreenAuthoredUnlit();
