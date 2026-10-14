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
				// Depth grows away from the light: its gradient is the light's direction.
				vec3 ${marker} = -normalize( vec3( shadowMatrix[ 0 ][ 2 ], shadowMatrix[ 1 ][ 2 ], shadowMatrix[ 2 ][ 2 ] ) );
				float shadowCos = dot( shadowWorldNormal, ${marker} );
				float shadowSin = sqrt( max( 1.0 - shadowCos * shadowCos, 0.0 ) );
				vec3 shadowFacing = shadowCos < 0.0 ? -shadowWorldNormal : shadowWorldNormal;
				shadowWorldPosition = worldPosition + vec4( shadowFacing * ( shadowSin * directionalLightShadows[ i ].shadowNormalBias ), 0 );
			}`,
  );
}

installPointLightZeroGuard();
installSunShadowSlopeBias();
