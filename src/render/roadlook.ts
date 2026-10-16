import * as THREE from 'three';
import { LANE_WIDTH } from '../world/roadprofile';
import { ROAD_DETAIL_ENCODE, ROAD_DETAIL_REPEAT, ROAD_TILE_METRES } from './roadtexture';

/**
 * THE ROAD'S PER-PIXEL LOOK: what the asphalt ribbon draws finer than its vertices.
 *
 * The ribbon's vertices are the collider (world/roadmesh.ts), 0.35-0.45 m apart across
 * the road and 1.33 m along it, and nothing that is only a picture may add one. So the
 * features that need a CRISP edge are not vertex colour. The vertices carry what each
 * feature is (a shade, a strength) in two attributes that interpolate exactly, and the
 * fragment shader draws the edge:
 *
 *  - COURSES. Alternating stretches of fresh, near-black asphalt and bleached old
 *    surface, hundreds of metres long, meeting at a transverse SEAM where a new course
 *    was laid. `aRoadCourse` is (signed metres to the nearest seam, shade before it,
 *    shade after it); the sign picks the shade, so the seam is a line, not a 1.33 m
 *    ramp, and a thin dark joint marks it.
 *  - WHEEL TRACKS. Per lane, two polished wheel paths, lighter on an aged course, and a
 *    dark oil strip between them, 10-20 cm soft at the edges. Their positions are the
 *    lane geometry (`roadprofile.ts`) from the lateral in the UV and the distance to the
 *    edge in `aRoadEdge.x`, so a widening road grows its outer lane's tracks as it opens;
 *    `aRoadEdge.y` is their strength.
 *  - CHIPS. The chip-seal detail (render/roadtexture.ts `paintDetail`): ONE extra
 *    texture sample, on the road surface only, left out where the macro tile is tar.
 *
 * No sand is drawn on the asphalt. A per-pixel drift of sand tongues on the mat's edge
 * was tried (2026-10-16) and the owner rejected it: sand on the road means sand all the
 * way across the verge beside it, and the verge is to stay dark gravel by the asphalt
 * (world/roadmesh.ts SHOULDER_SAND_*).
 *
 * The courses and tracks work in the Clean style (render/cleanstyle.ts): they are shapes
 * with edges, and Clean keeps shapes; only the chips' texture goes.
 *
 * ONE PROGRAM, keyed by a constant: no runtime variant. A geometry without the
 * attributes (lay-bys, the terminus pad, site aprons) reads `ROAD_LOOK_DEFAULTS` through
 * `material.defaultAttributeValues`: no course shade, no tracks.
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

/** Per-vertex values that switch every feature off, for geometries that carry none. */
export const ROAD_LOOK_DEFAULTS: Readonly<Record<string, readonly number[]>> = {
  aRoadCourse: [1, 1, 1],
  aRoadEdge: [100, 0],
};

const detailUniform: THREE.IUniform<THREE.Texture | null> = { value: null };

/** Binds the chip-seal detail map; the program reads it through one shared uniform. */
export function setRoadDetailMap(texture: THREE.Texture): void {
  detailUniform.value = texture;
}

const f = (v: number): string => v.toFixed(4);

const VERTEX_PARS = `
attribute vec2 aRoadEdge;
attribute vec3 aRoadCourse;
varying vec2 vRoadEdge;
varying vec3 vRoadCourse;`;

const VERTEX_HOOK = `#include <begin_vertex>
vRoadEdge = aRoadEdge;
vRoadCourse = aRoadCourse;`;

const FRAGMENT_PARS = `
varying vec2 vRoadEdge;
varying vec3 vRoadCourse;
uniform sampler2D roadDetail;
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
	diffuseColor.rgb *= 1.0 + vRoadEdge.y * ( ${f(TRACK_POLISH)} * roadAged * roadPolish - ${f(TRACK_OIL)} * ( 0.5 + 0.5 * roadAged ) * roadOil );
	if ( cleanStyle.z <= 0.0 ) {
		vec3 roadChips = texture2D( roadDetail, vMapUv * ${f(ROAD_DETAIL_REPEAT)} ).rgb * ${f(ROAD_DETAIL_ENCODE)};
		float roadBare = smoothstep( 0.07, 0.13, dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) );
		diffuseColor.rgb *= mix( vec3( 1.0 ), roadChips, roadBare );
	}
	#endif`;

const patched = new WeakSet<THREE.Material>();

/**
 * Gives the asphalt ribbon's material (and every paved feature sharing it) its per-pixel
 * look. Chains the patches already there; idempotent; one constant key.
 */
export function applyRoadLook<T extends THREE.MeshStandardMaterial>(material: T): T {
  if (patched.has(material)) return material;
  patched.add(material);
  // Three reads this off any material, not only a ShaderMaterial (WebGLBindingStates).
  Object.assign(material, { defaultAttributeValues: ROAD_LOOK_DEFAULTS });
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.roadDetail = detailUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', VERTEX_HOOK);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n{${SURFACE_FRAGMENT}\n}`);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:road-look-v3-surface`;
  return material;
}
