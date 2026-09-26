import * as THREE from 'three';
import type { LookPalette } from '../../world/look/palette';

/**
 * THE AIR, FOR EVERY MATERIAL IN THE WORLD, AS ONE MODEL.
 *
 * The desert had three separate atmospheres that did not know about each other: an
 * exponential `FogExp2`, a height haze spliced into three's fog chunk
 * (render/lightshader.ts) and an "aerial veil" painted over the whole frame by the post
 * pass (render/hazeshader.ts). Nothing made them agree, and the frame showed it: the
 * ground dissolved into one colour, the sky was painted in another, and the veil sat on
 * top of both.
 *
 * This replaces all three with the one model the whole technique comes down to, after
 * the slowroads notes (docs/slowroads-steam/notes/SrSkyLight.md §1):
 *
 * 1. CYLINDRICAL DISTANCE — the distance from the eye to the fragment in world space,
 *    not view-space depth. Turning the camera does not change the air, and a point
 *    overhead is as far away as a point on the ground at the same range.
 * 2. THREE COLOUR STEPS, in this order: desaturate by d/far; tint toward the haze
 *    colour C by (d/far)^2; then dissolve into the sky's own gradient, which is A at
 *    the horizon and B at the zenith mixed by 2*sin(elevation) — so distant geometry
 *    melts into the sky that is actually behind it, at the height it actually is.
 * 3. A CLEAR DAY HAS ALMOST NO FOG until `near` of the way to the far plane, and then
 *    an EXP2 ramp. `near` at 0.9 of a long view is what gives the crisp middle ground
 *    and the hazy band along the horizon; a rain squall sets it to 0.05 and brings the
 *    same air in to a few hundred metres.
 * 4. A NOISY FOG HEIGHT. A positive `hazeHeight` pools fog in whatever lies below the
 *    height (valley mist on a September morning); a negative one is the deck itself,
 *    putting the hilltops in cloud. The noise is in world space, so the mist stays
 *    where it is while the car drives through it.
 *
 * The colours come from world/look/palette.ts, once per frame, through `writeFog`. The
 * sky dome paints itself with the same gradient (`FOG_SKY_GRADIENT_GLSL`) and the cloud
 * plane sits on it, so there is exactly one atmosphere in the frame.
 *
 * HOW THE UNIFORMS REACH EVERY MATERIAL. Three clones a material's uniform values when
 * it builds the program (`cloneUniforms`), which is why a uniform written after the
 * first compile is invisible to that material — but `cloneUniforms` only deep-copies
 * three's own colour/matrix/vector/texture classes and slices arrays. A PLAIN OBJECT
 * placed in `UniformsLib.fog` is therefore shared BY REFERENCE with every material's
 * uniform set, and one write per frame updates the whole world. That is the whole
 * reason `fogColorB`, `fogColorC` and `fogParams` below are `{ x, y, z }` objects
 * rather than `THREE.Color`s. The horizon colour A rides three's own `fogColor`
 * uniform, which the renderer refreshes from `scene.fog` for every fogged material.
 */

/** Uniform values, shared by reference with every material that is fogged. */
export const FOG_UNIFORMS: Record<string, THREE.IUniform> = {
  fogColorB: { value: { x: 0.6, y: 0.7, z: 0.85 } },
  fogColorC: { value: { x: 0.6, y: 0.7, z: 0.85 } },
  /** x near metres, y far metres, z noisy fog height metres, w haze intensity. */
  fogParams: { value: { x: 1000, y: 4000, z: 0, w: 0 } },
};

/**
 * The distance at which the air has taken most of a colour out of what is behind it,
 * metres: where the desaturation and the haze tint saturate.
 *
 * The fog's RAMP is scaled to the presentation's own far plane, because the horizon has
 * to dissolve where the world actually ends. The two colour steps are not: they are
 * aerial perspective, which in the reference frames is set by a 4 km draw distance, and
 * tying them to a 25 km one would leave a kilometre of forest with two per cent of haze
 * on it.
 */
const HAZE_REFERENCE_M = 4200;

const fogColorB = FOG_UNIFORMS.fogColorB!.value as { x: number; y: number; z: number };
const fogColorC = FOG_UNIFORMS.fogColorC!.value as { x: number; y: number; z: number };
const fogParams = FOG_UNIFORMS.fogParams!.value as { x: number; y: number; z: number; w: number };

/**
 * The uniform set a hand-written material needs to read the air.
 *
 * `fogColor` and `fogDensity` are three's own uniforms, refreshed by the renderer for any
 * material with `fog: true`; the rest are the shared objects above. A ShaderMaterial
 * keeps its uniforms by reference (three clones none of them), so spreading this into one
 * is enough for it to see the same air as the world.
 */
export function fogMaterialUniforms(): Record<string, THREE.IUniform> {
  return {
    fogColor: { value: new THREE.Color(1, 1, 1) },
    fogDensity: { value: 0 },
    ...FOG_UNIFORMS,
  };
}

/**
 * The sky's own gradient, shared by the dome and the cloud deck.
 *
 * `up` is the view direction's height: 0 at the horizon, 1 straight up, and the mix is
 * deliberately NOT clamped, so above 30 degrees the zenith deepens past B — which is
 * what a real clear noon does, and what slowroads' unclamped mix does too.
 */
export const FOG_SKY_GRADIENT_GLSL = /* glsl */ `
vec3 fogSkyColour( vec3 horizon, vec3 zenith, float up ) {
	return mix( horizon, zenith, 2.0 * up );
}
`;

/**
 * The declarations a hand-written material needs to read the air.
 *
 * `fogColor` (the horizon) and `fogDensity` (the single-scalar form of the ramp) are
 * three's own uniforms, refreshed by the renderer for any material with `fog: true`; the
 * rest are the shared objects above, which arrive through `fogMaterialUniforms`.
 */
export const FOG_PARS_GLSL = /* glsl */ `
uniform vec3 fogColor;
uniform vec3 fogColorB;
uniform vec4 fogParams;
uniform float fogDensity;
`;

/**
 * World-space fog, computed per vertex: distance, the noisy fog height, and the two
 * weights the fragment needs (desaturation and haze tint).
 *
 * A vertex of a tile, an instanced tree trunk or a grass blade all carry the same
 * fields; the fragment then does the mixing. The hashes are four multiplies each, and
 * the noise is sampled only when there is a haze height at all, so a clear noon pays
 * almost nothing.
 */
const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogPos;
	varying float vFogBlend;
	varying float vHazeTint;
	varying float vDesat;
	varying float vFogHaze;
	uniform vec4 fogParams;

	float fogHash( vec2 p ) {
		return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
	}

	float fogNoise( vec2 p ) {
		vec2 i = floor( p );
		vec2 f = fract( p );
		vec2 u = f * f * ( 3.0 - 2.0 * f );
		return mix(
			mix( fogHash( i ), fogHash( i + vec2( 1.0, 0.0 ) ), u.x ),
			mix( fogHash( i + vec2( 0.0, 1.0 ) ), fogHash( i + vec2( 1.0, 1.0 ) ), u.x ),
			u.y
		);
	}
#endif
`;

const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
	vec3 fogWorld = position;
	#ifdef USE_INSTANCING
		fogWorld = ( instanceMatrix * vec4( fogWorld, 1.0 ) ).xyz;
	#endif
	fogWorld = ( modelMatrix * vec4( fogWorld, 1.0 ) ).xyz;
	vFogPos = fogWorld;

	// Cylindrical: the same air in every direction, so turning the camera changes
	// nothing and a ridge is as hazy as the valley beside it.
	float fogDist = distance( fogWorld, cameraPosition );
	vFogDepth = fogDist;

	float fogNearM = fogParams.x;
	float fogFarM = max( fogParams.y, fogNearM + 1.0 );
	vDesat = min( 1.0, fogDist / min( fogFarM, ${HAZE_REFERENCE_M.toFixed(1)} ) );
	vHazeTint = vDesat * vDesat;
	// A negative haze intensity means "no haze" rather than "inverted haze".
	float hazeScale = 1.0 + min( 0.0, fogParams.w );
	vDesat *= hazeScale;
	vHazeTint *= hazeScale;

	// The haze settles at a height that wanders with the terrain by 200 m or so; both
	// signs of that height use the same field, so no two places pool mist alike.
	float fogHeight = fogWorld.y;
	if ( fogParams.z != 0.0 ) {
		float n = fogNoise( fogWorld.xz / 210.0 );
		fogHeight += n * n * fogParams.z * min( 1.0, fogDist / 1000.0 );
	}
	float fogHaze = 0.0;
	if ( fogParams.z > 0.0 ) {
		// Valley mist: it fills whatever is below the height, and the eye sees as much
		// of it as it is itself inside.
		float low = min( cameraPosition.y, fogHeight );
		if ( low < fogParams.z ) {
			fogHaze = ( 1.0 - low / fogParams.z ) * fogParams.w;
			// Faded out at the eye: the mist the player is standing in must not become a
			// white screen in front of the road.
			float near = 1.0 - max( 0.0, 1.0 - fogDist / 60.0 );
			fogHaze *= 1.0 - near * near;
		}
	} else if ( fogParams.z < 0.0 ) {
		// The deck: what stands above the height is in cloud.
		float high = max( cameraPosition.y, fogHeight );
		fogHaze = min( 1.0, high / -fogParams.z ) * fogParams.w;
		float reach = max( 1.0, fogHaze * 100.0 );
		if ( fogDist < reach ) {
			float near = 1.0 - fogDist / reach;
			fogHaze *= 1.0 - near * near;
		}
	}
	vFogHaze = min( 1.0, fogHaze );

	// The sky's gradient, held still while the fog is short: a world fogged in to 200 m
	// must not paint its own distance as a band of sky colour.
	float fogAvg = 0.5 * ( fogNearM + fogFarM );
	vFogBlend = fogAvg >= 500.0 ? 1.0 : max( 0.0, ( fogAvg - 50.0 ) / 450.0 );
#endif
`;

/**
 * The fragment end of the model: the EXP2 ramp, the height haze, and the three colour
 * steps. Runs where three's own fog runs — after tone mapping and the colour space
 * conversion — so the air is mixed into the value that is actually shown.
 */
const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	float fogNearM = fogParams.x;
	float fogFarM = max( fogParams.y, fogNearM + 1.0 );
	float fogRamp = max( 0.0, ( vFogDepth - fogNearM ) * ( fogFarM / ( fogFarM - fogNearM ) ) );
	float fogAmount = 1.0 - exp( - fogDensity * fogDensity * fogRamp * fogRamp );
	fogAmount = min( 1.0, fogAmount + vFogHaze );

	vec3 air = gl_FragColor.rgb;
	air = mix( air, vec3( dot( air, vec3( 0.299, 0.587, 0.114 ) ) ), vDesat );
	air = mix( air, fogColorC, vHazeTint );
	float fogBlend = max( 2.0 * ( vFogPos.y - cameraPosition.y ) / max( vFogDepth, 1.0 ), 0.0 ) * vFogBlend;
	gl_FragColor.rgb = mix( air, fogSkyColour( fogColor, fogColorB, fogBlend ), fogAmount );
#endif
`;

/**
 * Replaces three's fog chunks and installs the extra uniforms into every shader three
 * ships. Module evaluation is once, before the first program is built; the guards keep
 * a re-evaluation (HMR, a lab importing this twice) from stacking a second copy.
 */
function installFogChunks(): void {
  const marker = '/* three-colour-fog */';
  if (THREE.ShaderChunk.fog_pars_vertex.includes(marker)) return;

  THREE.ShaderChunk.fog_pars_vertex = `${marker}
${FOG_PARS_VERTEX}`;
  THREE.ShaderChunk.fog_vertex = `${marker}
${FOG_VERTEX}`;
  THREE.ShaderChunk.fog_pars_fragment = `${marker}
#ifdef USE_FOG
	uniform vec3 fogColor;
	// The single-scalar form of the ramp, kept for the materials that express their own
	// fade through it (render/contactpatches.ts, render/tyretracks.ts, landmarks).
	uniform float fogDensity;
	varying float vFogDepth;
	varying vec3 vFogPos;
	varying float vFogBlend;
	varying float vHazeTint;
	varying float vDesat;
	varying float vFogHaze;
	uniform vec3 fogColorB;
	uniform vec3 fogColorC;
	uniform vec4 fogParams;
	${FOG_SKY_GRADIENT_GLSL}
#endif`;
  THREE.ShaderChunk.fog_fragment = `${marker}
${FOG_FRAGMENT}`;

  // The extras must exist in every material's uniform set: three clones a material's
  // values when it compiles, and an undeclared-in-uniforms name is skipped rather than
  // bound, so a missing entry would silently read zero (black air).
  for (const key of Object.keys(THREE.ShaderLib)) {
    const uniforms = (THREE.ShaderLib as Record<string, { uniforms: Record<string, THREE.IUniform> }>)[key]?.uniforms;
    if (uniforms === undefined) continue;
    for (const [name, uniform] of Object.entries(FOG_UNIFORMS)) {
      if (uniforms[name] === undefined) uniforms[name] = uniform;
    }
  }
}

installFogChunks();

/**
 * Writes this frame's air.
 *
 * `farMetres` is the presentation's own far plane (`farPlaneForViewDistance`): the
 * model's whole scale is that number, so a 1.5 km draw distance fogs a 1.5 km world
 * and a 25 km one fogs a 25 km world, and the sky is 100% fogged at the same distance
 * the ground runs out at. `fog.density` keeps the single-scalar form of the same curve
 * for the materials that read it directly (contact patches, tyre tracks, wet glints).
 */
export function writeFog(palette: LookPalette, farMetres: number, fog: THREE.FogExp2): void {
  // The air's own far plane: the smaller of what the camera draws and what the weather
  // lets you see. Everything past it is the sky, which is exactly what a fog spell is.
  const far = Math.min(Math.max(256, farMetres), Math.max(120, palette.visibilityM));
  fog.color.setRGB(palette.fogA.r, palette.fogA.g, palette.fogA.b);
  fogColorB.x = palette.fogB.r;
  fogColorB.y = palette.fogB.g;
  fogColorB.z = palette.fogB.b;
  fogColorC.x = palette.fogC.r;
  fogColorC.y = palette.fogC.g;
  fogColorC.z = palette.fogC.b;
  fogParams.x = Math.min(0.95, Math.max(0.004, palette.fogNear)) * far;
  fogParams.y = far;
  fogParams.z = palette.hazeHeight;
  fogParams.w = palette.hazeIntensity;
  fog.density = Math.sqrt(5) / far;
}
