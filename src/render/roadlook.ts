import * as THREE from 'three';
import { LANE_WIDTH } from '../world/roadprofile';
import { ROAD_DETAIL_ENCODE, ROAD_DETAIL_REPEAT, ROAD_TILE_METRES } from './roadtexture';

/**
 * THE ROAD'S PER-PIXEL LOOK: what the asphalt ribbon draws finer than its vertices.
 *
 * The ribbon's vertices are the collider (world/roadmesh.ts), 0.35-0.45 m apart across
 * the road and 1.33 m along it, and nothing that is only a picture may add one. So the
 * features that need a CRISP edge are not vertex colour. The vertices carry what each
 * feature is (a shade, a strength, a reach) in three attributes that interpolate
 * exactly, and the fragment shader draws the edge:
 *
 *  - COURSES. Alternating stretches of fresh, near-black asphalt and bleached old
 *    surface, hundreds of metres long, meeting at a transverse SEAM where a new course
 *    was laid. `aRoadCourse` is (signed metres to the nearest seam, shade before it,
 *    shade after it); the sign picks the shade, so the seam is a line, not a 1.33 m
 *    ramp, and a thin dark joint marks it.
 *  - WHEEL TRACKS. Per lane, two polished wheel paths, lighter on an aged course, and a
 *    dark oil strip between them, 10-20 cm soft at the edges. Their positions are the
 *    lane geometry (`roadprofile.ts`) from the lateral in the UV and the distance to the
 *    edge in `aRoadEdge.x`, so a widening road grows its outer lane's tracks as it opens.
 *  - SAND DRIFT. Wind-blown sand lying 0-40 cm onto the asphalt's edge with a ragged,
 *    crisp boundary, in the palette's sand (`aRoadSand`). Drawn on the edge line's paint
 *    too (the `paint` part), because a drift lies over the paint, not under it.
 *  - CHIPS. The chip-seal detail (render/roadtexture.ts `paintDetail`): ONE extra
 *    texture sample, on the road surface only, left out where the macro tile is tar.
 *
 * Everything but the chips works in the Clean style (render/cleanstyle.ts): the courses,
 * tracks and drift are shapes with edges, and Clean keeps shapes; only texture goes.
 *
 * ONE PROGRAM per part, keyed by a constant: no runtime variant. A geometry without the
 * attributes (lay-bys, the terminus pad, site aprons) reads `ROAD_LOOK_DEFAULTS` through
 * `material.defaultAttributeValues`: no course shade, no tracks, no drift.
 */

/**
 * The polished pair is centred 0.2 m outward of each nominal lane centre, the camber
 * bias real traffic shows, with the wheels 0.8 m either side: the narrow road's tracks
 * at ±0.85 and ±2.45 m.
 */
export const WHEEL_TRACK_LANE_BIAS = 0.2;
export const WHEEL_TRACK_HALF = 0.8;
/** Half-width of a polished wheel path, metres: a tyre plus the lane's wander. */
const WHEEL_PATH_HALF = 0.3;
/** Half-width of the oil strip down the middle of a lane, metres. */
const OIL_STRIP_HALF = 0.32;
/** Width of the soft edge of a path or strip, metres. */
const TRACK_SOFT = 0.15;
/** Lift of a polished path on a fully aged course, and darkening of the oil strip. */
const TRACK_POLISH = 0.6;
const TRACK_OIL = 0.4;
/** Half-width of a seam's dark joint, metres, and how dark it goes. */
const SEAM_JOINT_HALF = 0.03;
const SEAM_JOINT_DARKEN = 0.35;
/** Farthest a drift reaches onto the asphalt, metres. */
export const ROAD_DRIFT_MAX_M = 0.4;
/** The drift level's gain on its shape and its floor (`ROAD_DRIFT_GLSL`). */
const DRIFT_LEVEL_GAIN = 2.2;
const DRIFT_LEVEL_FLOOR = 1.6;
/**
 * Drift level the road's verge gains across its crushed-stone band, from the asphalt's
 * edge to the band's outer edge (world/roadmesh.ts, THE EVERYDAY DRIFT ON THE VERGE).
 */
export const SHOULDER_DRIFT_FAN = 0.4;

/** Per-vertex values that switch every feature off, for geometries that carry none. */
export const ROAD_LOOK_DEFAULTS: Readonly<Record<string, readonly number[]>> = {
  aRoadCourse: [1, 1, 1],
  aRoadEdge: [100, 0, 0, 0],
  aRoadSand: [0, 0, 0],
};

const detailUniform: THREE.IUniform<THREE.Texture | null> = { value: null };

/** Binds the chip-seal detail map; the program reads it through one shared uniform. */
export function setRoadDetailMap(texture: THREE.Texture): void {
  detailUniform.value = texture;
}

/** Which part of the road a material draws. */
export type RoadLookPart = 'surface' | 'paint';

const f = (v: number): string => v.toFixed(4);

/**
 * The drift's ragged edge along the road, `roadDriftLevel( along, phase, rough )`: sand
 * lies on the asphalt's edge where it is above zero, reaching in by up to its value (to
 * 1) of the row's drift reach. The road's verge (world/terrainmesh.ts) reads the same
 * function at the same `along` (`s` less the chunk's tile start), so the sand on both is
 * one drift.
 *
 * Every term repeats in ${ROAD_TILE_METRES} m, the tile, because 'along' is only
 * continuous inside a chunk and differs between two chunks by whole tiles: three waves
 * for the drift's body and two value noises, 25 and 8 cm, for its lip. `rough` scales
 * the lip's terms (the fastest wave and both noises): 1 on the asphalt, less out on the
 * verge, where the same drift lies in broader fans. The floor cuts it into tongues with
 * bare edge between, not a sand-coloured kerb line: about a quarter of the edge carries
 * one. It was -0.65 of a 1.8 gain, sand on some 70% of every edge, and the verge beside
 * all of that has to be sand too (2026-10-16).
 */
export const ROAD_DRIFT_GLSL = /* glsl */ `
float roadHash( float i ) {
	return fract( sin( i * 127.1 ) * 43758.5453 );
}
float roadDriftNoise( float along, float perMetre, float phase ) {
	float c = along * perMetre;
	float i = floor( c );
	float t = c - i;
	t = t * t * ( 3.0 - 2.0 * t );
	float cells = ${f(ROAD_TILE_METRES)} * perMetre;
	return mix( roadHash( mod( i, cells ) + phase * 31.0 ), roadHash( mod( i + 1.0, cells ) + phase * 31.0 ), t );
}
float roadDriftLevel( float along, float phase, float rough ) {
	float k = ${f((2 * Math.PI) / ROAD_TILE_METRES)};
	float shape = 0.5 + 0.26 * sin( along * k * 3.0 + phase ) + 0.18 * sin( along * k * 8.0 + 2.3 * phase )
		+ rough * ( 0.14 * sin( along * k * 19.0 + 4.1 * phase )
		+ 0.36 * ( roadDriftNoise( along, 4.0, phase ) - 0.5 ) + 0.16 * ( roadDriftNoise( along, 12.0, phase + 0.5 ) - 0.5 ) );
	return shape * ${f(DRIFT_LEVEL_GAIN)} - ${f(DRIFT_LEVEL_FLOOR)};
}`;

const VERTEX_PARS = (surface: boolean): string => `
attribute vec4 aRoadEdge;
attribute vec3 aRoadSand;
varying vec4 vRoadEdge;
varying vec3 vRoadSand;
${surface ? 'attribute vec3 aRoadCourse;\nvarying vec3 vRoadCourse;' : ''}`;

const VERTEX_HOOK = (surface: boolean): string => `#include <begin_vertex>
vRoadEdge = aRoadEdge;
vRoadSand = aRoadSand;
${surface ? 'vRoadCourse = aRoadCourse;' : ''}`;

const FRAGMENT_PARS = (surface: boolean): string => `
varying vec4 vRoadEdge;
varying vec3 vRoadSand;
${surface ? 'varying vec3 vRoadCourse;\nuniform sampler2D roadDetail;' : ''}
${ROAD_DRIFT_GLSL}
float roadBand( float d, float halfWidth, float aa ) {
	return 1.0 - smoothstep( halfWidth - ${f(TRACK_SOFT * 0.5)} - aa, halfWidth + ${f(TRACK_SOFT * 0.5)} + aa, abs( d ) );
}`;

const SURFACE_FRAGMENT = `
	float roadSeamAa = fwidth( vRoadCourse.x ) + 1e-4;
	float roadCourse = mix( vRoadCourse.y, vRoadCourse.z, smoothstep( -roadSeamAa, roadSeamAa, vRoadCourse.x ) );
	float roadJoint = ( 1.0 - smoothstep( ${f(SEAM_JOINT_HALF)}, ${f(SEAM_JOINT_HALF)} + 2.0 * roadSeamAa, abs( vRoadCourse.x ) ) )
		* min( 1.0, abs( vRoadCourse.y - vRoadCourse.z ) * 4.0 );
	diffuseColor.rgb *= roadCourse * ( 1.0 - ${f(SEAM_JOINT_DARKEN)} * roadJoint );
	#ifdef USE_MAP
	float roadLat = abs( vMapUv.x * ${f(ROAD_TILE_METRES)} );
	float roadLatAa = fwidth( roadLat );
	float roadHalf = roadLat + vRoadEdge.x;
	float roadInner = ${f(LANE_WIDTH * 0.5 + WHEEL_TRACK_LANE_BIAS)};
	float roadOuter = ${f(LANE_WIDTH)} + ( roadHalf - ${f(LANE_WIDTH)} ) * 0.5 + ${f(WHEEL_TRACK_LANE_BIAS)};
	float roadOuterOn = clamp( ( roadHalf - ${f(LANE_WIDTH)} - 1.2 ) / 1.2, 0.0, 1.0 );
	float roadPolish = max(
		max( roadBand( roadLat - ( roadInner - ${f(WHEEL_TRACK_HALF)} ), ${f(WHEEL_PATH_HALF)}, roadLatAa ),
			roadBand( roadLat - ( roadInner + ${f(WHEEL_TRACK_HALF)} ), ${f(WHEEL_PATH_HALF)}, roadLatAa ) ),
		roadOuterOn * max( roadBand( roadLat - ( roadOuter - ${f(WHEEL_TRACK_HALF)} ), ${f(WHEEL_PATH_HALF)}, roadLatAa ),
			roadBand( roadLat - ( roadOuter + ${f(WHEEL_TRACK_HALF)} ), ${f(WHEEL_PATH_HALF)}, roadLatAa ) ) );
	float roadOil = max( roadBand( roadLat - roadInner, ${f(OIL_STRIP_HALF)}, roadLatAa ),
		roadOuterOn * roadBand( roadLat - roadOuter, ${f(OIL_STRIP_HALF)}, roadLatAa ) );
	float roadAged = smoothstep( 0.6, 0.9, roadCourse );
	diffuseColor.rgb *= 1.0 + vRoadEdge.z * ( ${f(TRACK_POLISH)} * roadAged * roadPolish - ${f(TRACK_OIL)} * ( 0.5 + 0.5 * roadAged ) * roadOil );
	if ( cleanStyle.z <= 0.0 ) {
		vec3 roadChips = texture2D( roadDetail, vMapUv * ${f(ROAD_DETAIL_REPEAT)} ).rgb * ${f(ROAD_DETAIL_ENCODE)};
		float roadBare = smoothstep( 0.07, 0.13, dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) );
		diffuseColor.rgb *= mix( vec3( 1.0 ), roadChips, roadBare );
	}
	#endif`;

const DRIFT_FRAGMENT = `
	float roadDriftPhase = vRoadEdge.y < 0.0 ? 1.7 : 4.3;
	float roadReach = abs( vRoadEdge.y ) * clamp( roadDriftLevel( vRoadEdge.w, roadDriftPhase, 1.0 ), 0.0, 1.0 );
	float roadEdgeAa = fwidth( vRoadEdge.x ) + 0.012;
	float roadSand = ( 1.0 - smoothstep( roadReach - roadEdgeAa, roadReach + roadEdgeAa, vRoadEdge.x ) ) * step( 0.005, roadReach );
	diffuseColor.rgb = mix( diffuseColor.rgb, vRoadSand, roadSand );`;

const patched = new WeakSet<THREE.Material>();

/**
 * Gives a road material its per-pixel look: `surface` for the asphalt ribbon (and every
 * paved feature sharing its material), `paint` for the markings, which only take the
 * drift. Chains the patches already there; idempotent; one constant key per part.
 */
export function applyRoadLook<T extends THREE.MeshStandardMaterial>(material: T, part: RoadLookPart): T {
  if (patched.has(material)) return material;
  patched.add(material);
  const surface = part === 'surface';
  // Three reads this off any material, not only a ShaderMaterial (WebGLBindingStates).
  Object.assign(material, { defaultAttributeValues: ROAD_LOOK_DEFAULTS });
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    if (surface) shader.uniforms.roadDetail = detailUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS(surface)}`)
      .replace('#include <begin_vertex>', VERTEX_HOOK(surface));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS(surface)}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n{${surface ? SURFACE_FRAGMENT : ''}${DRIFT_FRAGMENT}\n}`,
      );
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:road-look-v2-${part}`;
  return material;
}
