import * as THREE from 'three';
import { compileAsyncSafe } from './compileasync';
import type { GraphicsQuality } from '../game/settings';
import { weather } from '../world/weather';
import { airDusk, airFog, airSky, airSun } from './airfog';
import {
  BLOB_FLOATS,
  CLOUD_CEILING_M,
  CLOUD_FLOOR_M,
  CLOUD_SHADE_SIGMA_M,
  CLOUD_BIG_SLOTS,
  CLOUD_COMPACT_BIG,
  CLOUD_COMPACT_SMALL,
  CLOUD_SLOTS,
  cloudGrow,
  cloudSet,
  wrapDelta,
  type CloudSet,
} from './cloudfield';
import { cloudDeckShiftLive, cloudPanUniform, cloudShadowLive, setCloudShadowMap } from './cloudshadow';
import { SCENE_EXPOSURE } from './displaytransform';

/**
 * LOW-POLY CUMULUS: the sky's clouds as faceted meshes in the game's own style, and the
 * map their shadows are read from.
 *
 * WHAT IS DRAWN. Every cloud of render/cloudfield.ts's list within `ringRadius` of the eye,
 * each one body of up to six big lobes (detail-2 icospheres, 320 faces) with up to twelve
 * small ones sunk into its upper surface (detail 1, 80 faces), squashed into its blobs'
 * ellipsoids and cut flat at its base (render/cloudfield.ts has the shape). Two instanced
 * draws do all of them: a compact mesh (four big lobes, six small) for the humilis and the
 * high deck's altocumulus, a full
 * one for the rest. The blobs themselves live in a float texture (`blobTexture`, one row
 * of texels per 96 clouds), so every cloud in
 * the sky is its own shape while the GPU sees two draws; a vertex fetches its blob,
 * places its own corner and the face's other two, and takes the face's normal from them,
 * so the shading is flat per facet like a mesa or a car body.
 *
 * HOW IT IS LIT. Lambert from the sun on each facet, ambient from the sky's own colours by
 * which way the facet faces (the zenith's blue overhead, the horizon's paler sky mixed
 * with the sand's warm bounce underneath), a little darker low in the cloud, and the sun
 * scattered through the body onto the facets that turn under, most on the flanks toward
 * it, so a base shades round into a darker core; at sunset the sun reaches only the
 * upper half, so a sunset cloud is a lit crown over a blue-grey body. Clean
 * bands the sun like every lit surface in that style. Far clouds take the land's own
 * aerial perspective (render/airfog.ts: extinction, haboob, fog colour by elevation,
 * the anti-solar pull) along the slant path, the air thinning upward
 * (`AIR_SCALE_HEIGHT_M`), so no cloud reads clearer than a mesa in front of it.
 *
 * WHERE IT IS IN THE FRAME. Drawn in the opaque pass straight after the dome (with its sun
 * disc and glow), the stars and the planets (`renderOrder` -6), and OPAQUE: a cloud hides
 * the sun and the stars behind it. Only the night fade is alpha (`uCloudAmount`, the
 * bodies' own: haze and dust veil them through the aerial perspective instead), and while
 * it runs a depth prepass (-6.5) keeps the fading cloud one surface deep. The clouds are kilometres beyond
 * the far plane, so their depth is their own (`DEPTH_NEAR_M`..`DEPTH_FAR_M`, written as a
 * projection row so clipping stays linear), which sorts the facets of a cloud and the
 * clouds among themselves; a depth-only triangle (`depthReset`, -5) then puts the far
 * plane back everywhere, so the land draws over the clouds as over the dome, and the
 * finishing pass still reads cloud pixels as sky. Every cloud is behind all land: a cloud
 * base is a kilometre over the eye and nothing on the ground is.
 *
 * THE SHADOWS. Each frame the clouds whose shadow can fall near the eye are drawn once
 * more, flattened along the sun's ray onto a `MAP_SIZE` square map `MAP_WIDTH_M` across
 * (the coverage pass), and blurred twice into a soft penumbra; every ground material
 * reads it per vertex (render/cloudshadow.ts). render/cloudfield.ts's `cloudShadeAlong`
 * is its CPU twin.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Clouds per row of the blob texture, and texels per cloud: a header and two a blob. */
const CLOUDS_PER_ROW = 96;
const CLOUD_TEXELS = 1 + 2 * CLOUD_SLOTS;
/** Instances a list can hold; a seed has at most 3600 clouds in all (two candidates a cell a deck). */
const LIST_CAPACITY = 16384;
/**
 * How far out clouds are drawn, metres. A cloud at the floor's height 26 km out stands two
 * degrees over the horizon, where the haze has it almost gone; the last fifth fades.
 */
const RING_DESKTOP_M = 26_000;
const RING_LOW_M = 16_000;
const RING_FADE_SHARE = 0.8;
/** The clouds' own depth range, metres from the eye. */
const DEPTH_NEAR_M = 50;
const DEPTH_FAR_M = 120_000;
/** Height each lobe's flat cut stands over the previous slot's, metres; see `blobPoint`. */
const BASE_SLOT_STEP_M = 0.1;
/**
 * Scale height of the air's haze, metres: its density falls by e every this far up.
 * Desert haze and dust sit in the boundary layer, so a cloud overhead looks through a
 * fraction of what a cloud at the horizon does. The land's fog ignores the fall-off,
 * which over a sight line that never climbs more than a few hundred metres changes
 * nothing, and errs toward fogging the land MORE: a cloud behind a mesa is always at
 * least as veiled as the mesa.
 */
const AIR_SCALE_HEIGHT_M = 1800;
/** The shadow map: texels a side, and metres across. 32 m texels. */
const MAP_SIZE = 512;
const MAP_WIDTH_M = 16_384;
const MAP_TEXEL_M = MAP_WIDTH_M / MAP_SIZE;
/** Gaussian taps each side of the centre, in the blur's one dimension. */
const BLUR_TAPS = 4;
/**
 * How far a blob's corners stray from its ellipsoid, as a fraction of its radius: enough
 * that a lobe reads as a faceted lump rather than a geodesic ball, little enough that no
 * corner stands out as a point. The CPU twin of the shadow (render/cloudfield.ts) keeps
 * the true ellipsoid, which is inside the penumbra's blur everywhere but the very edge.
 */
const LUMP = 0.08;

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

/**
 * Shared by the sky's draw and the coverage pass: the blob a vertex belongs to, and its
 * corner placed in the cloud's frame (the base point at the origin), flattened below it.
 */
const BLOB_GLSL = /* glsl */ `
attribute vec3 aNext;
attribute vec3 aPrev;
attribute float aSlot;
/** x, z: the cloud's centre from the mesh's origin; y: its index; w: its size (cloudGrow). */
attribute vec4 aCloud;
uniform highp sampler2D uBlobs;

/** base height, tint, shadow opacity, top above the base. */
vec4 cloudHead;
vec4 blobA;
vec4 blobB;

bool fetchBlob() {
	int cloud = int( aCloud.z + 0.5 );
	ivec2 at = ivec2( ( cloud % ${CLOUDS_PER_ROW} ) * ${CLOUD_TEXELS}, cloud / ${CLOUDS_PER_ROW} );
	int slot = int( aSlot + 0.5 );
	cloudHead = texelFetch( uBlobs, at, 0 );
	blobA = texelFetch( uBlobs, at + ivec2( 1 + 2 * slot, 0 ), 0 );
	blobB = texelFetch( uBlobs, at + ivec2( 2 + 2 * slot, 0 ), 0 );
	return blobA.w > 0.0 && aCloud.w > 0.0;
}

/**
 * Each corner's radius pushed in or out by up to LUMP: a hash of the corner, rounded so
 * every face sharing it agrees (the mesh stays closed), and of the cloud and the slot, so
 * no two blobs in the sky are the same ball.
 */
float lump( vec3 unit ) {
	vec3 p3 = fract( floor( unit * 512.0 + 0.5 ) * 0.1031 + vec3( aCloud.z * 0.0137, aSlot * 0.211, 0.37 ) );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}

/** A unit-sphere corner on the blob: lumped, squashed, turned, placed, cut at the base, grown. */
vec3 blobPoint( vec3 unit ) {
	vec3 s = unit * ( 1.0 + ${(2 * LUMP).toFixed(2)} * ( lump( unit ) - 0.5 ) ) * vec3( blobA.w, blobB.x, blobB.y );
	vec3 p = vec3( blobB.z * s.x - blobB.w * s.z, s.y, blobB.w * s.x + blobB.z * s.z ) + blobA.xyz;
	// Each lobe's cut a hand's breadth over the last slot's, not all in one plane. While the
	// bodies fade at dusk the colour pass blends every surface at the prepass's depth
	// (LessEqual), and the overlapping cuts of a cloud's lobes were all at it: each pixel
	// there was blended once or twice by which triangle rounded nearer, a speckled "dirt"
	// under every sunset cloud (owner, 2026-10-18). Ten centimetres a slot is ~14 depth
	// steps (CLIP_GLSL), so the prepass keeps one cut and the colour pass draws only it;
	// a metre's spread over a cloud's lobes is invisible from the ground.
	p.y = max( p.y, ${BASE_SLOT_STEP_M.toFixed(2)} * aSlot );
	return p * aCloud.w;
}
`;

/**
 * Where a cloud corner lands on the screen, shared by the colour pass and its depth
 * prepass, and `invariant` so the two programs agree on its depth to the bit: the colour
 * pass then draws, at LessEqual, exactly the front-most surface the prepass left. The
 * depth is the clouds' own (`DEPTH_NEAR_M`..`DEPTH_FAR_M`), written as a projection row
 * so clipping stays linear: at 2 km a 24-bit step is about 5 mm, far below any crossing
 * of two lobes.
 */
const CLIP_GLSL = /* glsl */ `
invariant gl_Position;

vec4 cloudView( vec3 p ) {
	return viewMatrix * ( modelMatrix * vec4( aCloud.x + p.x, cloudHead.x + p.y, aCloud.y + p.z, 1.0 ) );
}

vec4 cloudClip( vec4 view ) {
	vec4 clip = projectionMatrix * view;
	clip.z = ( -${(DEPTH_FAR_M + DEPTH_NEAR_M).toFixed(1)} * view.z - ${(2 * DEPTH_FAR_M * DEPTH_NEAR_M).toFixed(1)} )
		/ ${(DEPTH_FAR_M - DEPTH_NEAR_M).toFixed(1)};
	return clip;
}
`;

/** The depth prepass: only drawn while the bodies are fading (dusk), see `CloudLayer`. */
const PREPASS_VERTEX = /* glsl */ `
${BLOB_GLSL}
${CLIP_GLSL}
void main() {
	if ( !fetchBlob() ) {
		gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
		return;
	}
	gl_Position = cloudClip( cloudView( blobPoint( position ) ) );
}
`;

const CLOUD_VERTEX = /* glsl */ `
${BLOB_GLSL}
${CLIP_GLSL}
uniform vec3 uSunDir;
uniform vec3 uSunLin;
uniform vec3 uZenithLin;
uniform vec3 uHorizonLin;
uniform float uStorm;
uniform float uCloudAmount;
uniform float uFlash;
uniform vec2 uRing;
// The land's aerial perspective (render/airfog.ts): fog colour at the horizon, the colour
// its gradient climbs to, clear-air extinction per metre (airFog.x), the anti-solar pull,
// and the haboob's FogExp2 density.
uniform vec3 uFogColor;
uniform float uDustFog;
uniform vec3 airFog;
uniform vec3 airSky;
uniform vec3 airSun;
uniform vec3 airDusk;
varying vec4 vColor;

void main() {
	if ( !fetchBlob() ) {
		gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
		vColor = vec4( 0.0 );
		return;
	}
	vec3 p0 = blobPoint( position );
	vec3 n = cross( blobPoint( aNext ) - p0, blobPoint( aPrev ) - p0 );
	float area = length( n );
	n = area > 1e-6 ? n / area : vec3( 0.0, -1.0, 0.0 );
	vec4 world = modelMatrix * vec4( aCloud.x + p0.x, cloudHead.x + p0.y, aCloud.y + p0.z, 1.0 );
	gl_Position = cloudClip( cloudView( p0 ) );

	vec3 toward = world.xyz - cameraPosition;
	float dist = length( toward );
	vec3 dir = toward / dist;

	// 1 with the sun on the horizon, 0 from 20 degrees up.
	float lowSun = 1.0 - smoothstep( 0.05, 0.35, uSunDir.y );
	float lambert = max( dot( n, uSunDir ), 0.0 );
	// Height within the cloud: the top sees the sky, the base the ground.
	float hc = clamp( p0.y / max( cloudHead.w * aCloud.w, 40.0 ), 0.0, 1.0 );
	// A low sun reaches a cloud's lower half through more air and past its neighbours.
	float sunAt = mix( 1.0, 0.3 + 0.7 * smoothstep( 0.1, 0.85, hc ), lowSun );
	// Sky light on the tops comes mostly from overhead, and at sunset only from overhead.
	// The underside sees the horizon's paler sky and the sand's warm bounce of a high sun,
	// close to neutral: the old base (half the zenith's blue, a third of this bounce) read
	// in the owner's screenshot as a blue-grey slab under a white top. At sunset it sees
	// the dim blue of the sky opposite, greyed: a sunset cloud's base is slate, not violet.
	vec3 skyAmbient = mix( uZenithLin, uHorizonLin, 0.35 * ( 1.0 - lowSun ) ) * 0.55;
	float sunUp = max( uSunDir.y, 0.0 );
	vec3 groundAmbient = mix( uZenithLin, uHorizonLin, 0.6 - 0.25 * lowSun ) * 0.3 + vec3( 0.69, 0.37, 0.12 ) * sunUp * 0.22;
	float grey = 0.45 * lowSun;
	skyAmbient = mix( skyAmbient, vec3( dot( skyAmbient, vec3( 0.2126, 0.7152, 0.0722 ) ) ), grey );
	groundAmbient = mix( groundAmbient, vec3( dot( groundAmbient, vec3( 0.2126, 0.7152, 0.0722 ) ) ), grey );
	vec3 ambient = mix( groundAmbient, skyAmbient, n.y * 0.5 + 0.5 ) * ( 0.8 + 0.2 * hc );
	// Sunlight scattered through the body to the facets that turn under: most on the
	// flanks toward the sun, least on the flat base, so the underside shades round from
	// its flanks into a darker core instead of being one face of one grey. A function of
	// the facet's normal alone, so every lobe's cut, coplanar in the base, takes the same
	// colour. The upper facets are left to the Lambert above, and at sunset it fades,
	// keeping the lit crown over a slate body.
	float through = 0.5 + 0.5 * dot( n, uSunDir );
	float scatter = 0.3 * through * through * clamp( 0.3 - n.y, 0.0, 1.0 ) * ( 1.0 - lowSun );
	float albedo = cloudHead.y * ( 1.0 - 0.55 * uStorm );
	vec3 col = albedo * ( uSunLin * ( lambert * sunAt + scatter ) + ambient );
	// Seen toward the sun, the light coming through lights the THIN parts: the facets on a
	// lobe's silhouette, where the eye grazes the cloud, are a bright edge (the silver
	// lining) round a grey body, not a body washed pale all over.
	float toSun = pow( max( dot( dir, uSunDir ), 0.0 ), 8.0 ) * ( 1.0 - uStorm );
	float rim = 1.0 - abs( dot( n, dir ) );
	col += uSunLin * toSun * ( 0.9 * rim * rim * rim + 0.05 );
	col += vec3( 0.78, 0.8, 1.0 ) * uFlash * 0.45 * uStorm;

	// AERIAL PERSPECTIVE, THE LAND'S OWN, along the slant path with the air thinning upward.
	float rise = dist * dir.y / ${AIR_SCALE_HEIGHT_M.toFixed(1)};
	float slant = dist * ( rise > 1e-4 ? ( 1.0 - exp( -rise ) ) / rise : 1.0 );
	float dustDepth = uDustFog * slant;
	float airClear = exp( -airFog.x * slant - dustDepth * dustDepth );
	vec3 fogTint = mix( uFogColor, airSky, pow( clamp( dir.y, 0.0, 1.0 ), 0.62 ) );
	float antiSolar = length( airSun );
	if ( antiSolar > 0.0 ) {
		float away = pow( max( -dot( dir, airSun / antiSolar ), 0.0 ), 1.5 );
		fogTint = mix( fogTint, airDusk, antiSolar * away * ( 1.0 - smoothstep( 0.0, 0.45, dir.y ) ) );
	}
	col = col * airClear + fogTint * ( 1.0 - airClear );

	// The ring's edge and the horizon band take the air's colour rather than going
	// transparent: a half-transparent cloud showed its back facets through its front and
	// the sun through both. The band must stay pure gradient (the fog colour is copied
	// from it), and the air's colour there is that gradient. Only the night fade is alpha.
	float ring = 1.0 - smoothstep( uRing.x, uRing.y, length( toward.xz ) );
	col = mix( fogTint, col, ring * smoothstep( 0.005, 0.06, dir.y ) );
	vColor = vec4( col / ${SCENE_EXPOSURE.toFixed(4)}, uCloudAmount );
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
varying vec4 vColor;
void main() {
	gl_FragColor = vColor;
}
`;

/** The coverage pass: each cloud slid along the sun's ray onto the map's plane. */
const COVERAGE_VERTEX = /* glsl */ `
${BLOB_GLSL}
uniform vec2 uSlope;
/** xy: the map's centre in scene metres; z: half its width. */
uniform vec3 uMap;
varying float vOpacity;

void main() {
	if ( !fetchBlob() ) {
		gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
		vOpacity = 0.0;
		return;
	}
	vec3 p = blobPoint( position );
	vec3 world = ( modelMatrix * vec4( aCloud.x + p.x, cloudHead.x + p.y, aCloud.y + p.z, 1.0 ) ).xyz;
	vec2 slid = world.xz - world.y * uSlope;
	gl_Position = vec4( ( slid - uMap.xy ) / uMap.z, 0.0, 1.0 );
	// A cloud still growing casts a lighter shadow.
	vOpacity = cloudHead.z * min( aCloud.w, 1.0 );
}
`;

const COVERAGE_FRAGMENT = /* glsl */ `
varying float vOpacity;
void main() {
	gl_FragColor = vec4( vOpacity, 0.0, 0.0, 1.0 );
}
`;

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = position.xy * 0.5 + 0.5;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/** One dimension of the shadow's penumbra: a Gaussian of `CLOUD_SHADE_SIGMA_M`. */
function blurFragment(): string {
  const sigma = CLOUD_SHADE_SIGMA_M / MAP_TEXEL_M;
  const weights = Array.from({ length: BLUR_TAPS + 1 }, (_, i) => Math.exp(-0.5 * (i / sigma) ** 2));
  const total = weights[0]! + 2 * weights.slice(1).reduce((sum, w) => sum + w, 0);
  const taps = weights
    .slice(1)
    .map(
      (w, i) =>
        `\tsum += ( texture2D( uSource, vUv + uStep * ${(i + 1).toFixed(1)} ).r + texture2D( uSource, vUv - uStep * ${(i + 1).toFixed(1)} ).r ) * ${(w / total).toFixed(6)};`,
    )
    .join('\n');
  return /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
	float sum = texture2D( uSource, vUv ).r * ${(weights[0]! / total).toFixed(6)};
${taps}
	gl_FragColor = vec4( sum, 0.0, 0.0, 1.0 );
}
`;
}

/** Depth only, at the far plane, everywhere: the land then draws over the clouds. */
const RESET_VERTEX = /* glsl */ `
void main() {
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}
`;

const RESET_FRAGMENT = /* glsl */ `
void main() {
	gl_FragColor = vec4( 0.0 );
}
`;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Unit icospheres in one non-indexed buffer, one per slot in `slots`: detail 2 (320 faces)
 * for the big lobes (slots under `CLOUD_BIG_SLOTS`), detail 1 (80 faces) for the small
 * ones, which are a quarter of a big lobe's size and need no more. Per vertex: its own
 * corner, the face's next and previous corners (in winding order, so every vertex of a
 * face computes the same outward normal), and which blob slot it belongs to.
 */
function blobAttributes(slots: readonly number[]): Record<string, THREE.BufferAttribute> {
  const spheres = [new THREE.IcosahedronGeometry(1, 1), new THREE.IcosahedronGeometry(1, 2)];
  const sources = spheres.map((sphere) => sphere.getAttribute('position') as THREE.BufferAttribute);
  const total = slots.reduce((sum, s) => sum + sources[s < CLOUD_BIG_SLOTS ? 1 : 0]!.count, 0);
  const own = new Float32Array(total * 3);
  const next = new Float32Array(own.length);
  const prev = new Float32Array(own.length);
  const slot = new Float32Array(total);
  let v = 0;
  for (const s of slots) {
    const source = sources[s < CLOUD_BIG_SLOTS ? 1 : 0]!;
    for (let f = 0; f < source.count / 3; f++) {
      for (let k = 0; k < 3; k++) {
        const a = f * 3 + k;
        const b = f * 3 + ((k + 1) % 3);
        const c = f * 3 + ((k + 2) % 3);
        for (let axis = 0; axis < 3; axis++) {
          own[v * 3 + axis] = source.getComponent(a, axis);
          next[v * 3 + axis] = source.getComponent(b, axis);
          prev[v * 3 + axis] = source.getComponent(c, axis);
        }
        slot[v] = s;
        v++;
      }
    }
  }
  for (const sphere of spheres) sphere.dispose();
  return {
    position: new THREE.BufferAttribute(own, 3),
    aNext: new THREE.BufferAttribute(next, 3),
    aPrev: new THREE.BufferAttribute(prev, 3),
    aSlot: new THREE.BufferAttribute(slot, 1),
  };
}

/**
 * An instanced geometry over shared blob attributes, with its own cloud list. `all` is
 * the frame's whole list; the attribute holds what is drawn: all of it for the shadow
 * map (`commitList`), only what a camera can see for the sky (`cullList`).
 */
interface CloudList {
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly cloud: THREE.InstancedBufferAttribute;
  /** Per cloud: x, z from the mesh's origin, index, grow (the attribute's layout). */
  readonly all: Float32Array;
  /** Per cloud: its bounding sphere's centre height and radius, metres. */
  readonly bounds: Float32Array;
  count: number;
}

function cloudList(attributes: Record<string, THREE.BufferAttribute>): CloudList {
  const geometry = new THREE.InstancedBufferGeometry();
  for (const [name, attribute] of Object.entries(attributes)) geometry.setAttribute(name, attribute);
  const cloud = new THREE.InstancedBufferAttribute(new Float32Array(LIST_CAPACITY * 4), 4);
  cloud.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aCloud', cloud);
  geometry.instanceCount = 0;
  // Never culled (the meshes are), and never measured: a bounding sphere here would be one
  // icosphere's, which says nothing about where the clouds are.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return { geometry, cloud, all: new Float32Array(LIST_CAPACITY * 4), bounds: new Float32Array(LIST_CAPACITY * 2), count: 0 };
}

function pushCloud(list: CloudList, set: CloudSet, x: number, z: number, index: number, grow: number): void {
  const o = list.count * 4;
  const all = list.all;
  all[o] = x;
  all[o + 1] = z;
  all[o + 2] = index;
  all[o + 3] = grow;
  // The body stands from its base up `top`, and reaches `reach` across; the corners'
  // lumps push out by up to LUMP of a lobe.
  const halfTop = set.top[index]! * grow * 0.5;
  list.bounds[list.count * 2] = set.base[index]! + halfTop;
  list.bounds[list.count * 2 + 1] = Math.hypot(set.reach[index]! * grow, halfTop) * (1 + LUMP);
  list.count++;
}

function upload(list: CloudList, count: number): void {
  list.geometry.instanceCount = count;
  if (count === 0) return;
  list.cloud.clearUpdateRanges();
  list.cloud.addUpdateRange(0, count * 4);
  list.cloud.needsUpdate = true;
}

/** The whole list drawn: the shadow map's lists. */
function commitList(list: CloudList): void {
  (list.cloud.array as Float32Array).set(list.all.subarray(0, list.count * 4));
  upload(list, list.count);
}

/**
 * Only the clouds inside the side planes of `frustum` drawn, for a mesh at (`ox`, `oz`).
 * Near and far are not tested: the clouds stand kilometres past the far plane and write
 * a depth of their own (`CLIP_GLSL`).
 */
function cullList(list: CloudList, frustum: THREE.Frustum, ox: number, oz: number): void {
  const target = list.cloud.array as Float32Array;
  const planes = frustum.planes;
  let drawn = 0;
  for (let i = 0; i < list.count; i++) {
    const o = i * 4;
    _centre.set(list.all[o]! + ox, list.bounds[i * 2]!, list.all[o + 1]! + oz);
    const radius = list.bounds[i * 2 + 1]!;
    if (
      planes[0]!.distanceToPoint(_centre) < -radius || planes[1]!.distanceToPoint(_centre) < -radius ||
      planes[2]!.distanceToPoint(_centre) < -radius || planes[3]!.distanceToPoint(_centre) < -radius
    ) continue;
    target.set(list.all.subarray(o, o + 4), drawn * 4);
    drawn++;
  }
  upload(list, drawn);
}

const _centre = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _viewProjection = new THREE.Matrix4();

function fullscreenTriangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return geometry;
}

/** The blob texture of a seed's sky: a header and the blobs of every cloud. */
function blobTexture(set: CloudSet): THREE.DataTexture {
  const width = CLOUDS_PER_ROW * CLOUD_TEXELS;
  const height = Math.max(1, Math.ceil(set.count / CLOUDS_PER_ROW));
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < set.count; i++) {
    let o = ((Math.floor(i / CLOUDS_PER_ROW) * width) + (i % CLOUDS_PER_ROW) * CLOUD_TEXELS) * 4;
    data[o] = set.base[i]!;
    data[o + 1] = set.tint[i]!;
    data[o + 2] = set.opacity[i]!;
    data[o + 3] = set.top[i]!;
    o += 4;
    const b = i * CLOUD_SLOTS * BLOB_FLOATS;
    for (let j = 0; j < CLOUD_SLOTS * BLOB_FLOATS; j++) data[o + j] = set.blobs[b + j]!;
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------

/** The sky's live uniform objects the clouds read (render/sky.ts owns them). */
export interface CloudSkyUniforms {
  readonly uSunDir: { value: THREE.Vector3 };
  readonly uZenith: { value: THREE.Color };
  readonly uHorizon: { value: THREE.Color };
  readonly uSunColor: { value: THREE.Color };
  readonly uStorm: { value: number };
  readonly uCloudAmount: { value: number };
  readonly uFlash: { value: number };
  /**
   * The scene's fog: its colour is the land's fog colour at the horizon, its density
   * the haboob's FogExp2 (render/airfog.ts). The clouds take the same air the land does.
   */
  readonly fog: THREE.FogExp2;
}

export class CloudLayer {
  /** In the scene: the two cloud draws and the depth reset after them. */
  readonly root = new THREE.Group();

  private readonly webgl: THREE.WebGLRenderer;
  private readonly sky: CloudSkyUniforms;
  private readonly smallSky: CloudList;
  private readonly bigSky: CloudList;
  private readonly smallShadow: CloudList;
  private readonly bigShadow: CloudList;
  private readonly material: THREE.ShaderMaterial;
  private readonly coverageMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly resetMaterial: THREE.ShaderMaterial;
  private readonly prepassMaterial: THREE.ShaderMaterial;
  private readonly skyMeshes: THREE.Mesh[];
  /** Depth only, before `skyMeshes`; shown only while the bodies fade (`update`). */
  private readonly prepassMeshes: THREE.Mesh[];
  private readonly coverageMeshes: THREE.Mesh[];
  private readonly coverageScene = new THREE.Scene();
  private readonly blurScene = new THREE.Scene();
  private readonly passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fullscreen = fullscreenTriangle();
  /** The coverage, then its blur back into it; the ground reads `map`. */
  private readonly map: THREE.WebGLRenderTarget;
  private readonly mapBlur: THREE.WebGLRenderTarget;
  private set: CloudSet | null = null;
  private blobs: THREE.DataTexture | null = null;
  private ringRadius = RING_DESKTOP_M;
  /** Whether this frame's coverage pass has anything to do (`draw`). */
  private shadowPass = false;
  private readonly zenithLin = new THREE.Color();
  private readonly horizonLin = new THREE.Color();
  private readonly sunLin = new THREE.Color();

  constructor(webgl: THREE.WebGLRenderer, sky: CloudSkyUniforms) {
    this.webgl = webgl;
    this.sky = sky;
    // The compact mesh: the first four big lobes and the first six small ones (humilis):
    // 1760 faces, against 2880 for the full mesh's six big and twelve small lobes. Clouds
    // are few and wide, so the sky's total stays about what the old many small ones cost.
    const small = blobAttributes([
      ...Array.from({ length: CLOUD_COMPACT_BIG }, (_, i) => i),
      ...Array.from({ length: CLOUD_COMPACT_SMALL }, (_, i) => CLOUD_BIG_SLOTS + i),
    ]);
    const big = blobAttributes(Array.from({ length: CLOUD_SLOTS }, (_, i) => i));
    this.smallSky = cloudList(small);
    this.bigSky = cloudList(big);
    this.smallShadow = cloudList(small);
    this.bigShadow = cloudList(big);

    const blobs = { value: null as THREE.Texture | null };
    this.material = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      uniforms: {
        uBlobs: blobs,
        uSunDir: sky.uSunDir,
        uSunLin: { value: this.sunLin },
        uZenithLin: { value: this.zenithLin },
        uHorizonLin: { value: this.horizonLin },
        uStorm: sky.uStorm,
        uCloudAmount: sky.uCloudAmount,
        uFlash: sky.uFlash,
        uRing: { value: new THREE.Vector2() },
        uFogColor: { value: sky.fog.color },
        uDustFog: { value: 0 },
        airFog: { value: airFog },
        airSky: { value: airSky },
        airSun: { value: airSun },
        airDusk: { value: airDusk },
      },
      // Over the dome, the sun, the stars by alpha (the night fade); kept in the opaque pass
      // so it draws before the land.
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.skyMeshes = [this.smallSky, this.bigSky].map((list) => {
      const mesh = new THREE.Mesh(list.geometry, this.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = -6;
      this.root.add(mesh);
      return mesh;
    });
    // While the bodies fade at dusk they are drawn part-transparent, and without this the
    // back and inner facets of every lobe showed through the front ones. The prepass lays
    // down the front-most depth first, so the colour pass (at LessEqual) blends one
    // surface per pixel. In the scene from boot, so its program is linked with the rest.
    this.prepassMaterial = new THREE.ShaderMaterial({
      vertexShader: PREPASS_VERTEX,
      fragmentShader: RESET_FRAGMENT,
      uniforms: { uBlobs: blobs },
      colorWrite: false,
    });
    this.prepassMeshes = [this.smallSky, this.bigSky].map((list) => {
      const mesh = new THREE.Mesh(list.geometry, this.prepassMaterial);
      mesh.frustumCulled = false;
      mesh.renderOrder = -6.5;
      mesh.visible = false;
      this.root.add(mesh);
      return mesh;
    });

    this.resetMaterial = new THREE.ShaderMaterial({
      vertexShader: RESET_VERTEX,
      fragmentShader: RESET_FRAGMENT,
      depthFunc: THREE.AlwaysDepth,
      colorWrite: false,
    });
    const reset = new THREE.Mesh(this.fullscreen, this.resetMaterial);
    reset.frustumCulled = false;
    reset.renderOrder = -5;
    this.root.add(reset);

    this.map = new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, {
      format: THREE.RedFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.mapBlur = this.map.clone();
    this.coverageMaterial = new THREE.ShaderMaterial({
      vertexShader: COVERAGE_VERTEX,
      fragmentShader: COVERAGE_FRAGMENT,
      uniforms: {
        uBlobs: blobs,
        uSlope: cloudShadowLive.slope,
        uMap: { value: new THREE.Vector3(0, 0, MAP_WIDTH_M / 2) },
      },
      // The densest cloud over a texel wins; the slide along the sun can mirror a facet.
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.coverageScene.background = new THREE.Color(0);
    this.coverageMeshes = [this.smallShadow, this.bigShadow].map((list) => {
      const mesh = new THREE.Mesh(list.geometry, this.coverageMaterial);
      mesh.frustumCulled = false;
      this.coverageScene.add(mesh);
      return mesh;
    });
    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: blurFragment(),
      uniforms: { uSource: { value: this.map.texture }, uStep: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    const blur = new THREE.Mesh(this.fullscreen, this.blurMaterial);
    blur.frustumCulled = false;
    this.blurScene.add(blur);
  }

  /** The tier's reach: phones and the two lower rungs draw the nearer clouds only. */
  setQuality(quality: GraphicsQuality, mobilePresentation: boolean): void {
    const near = mobilePresentation || quality === 'retro' || quality === 'acceptable';
    this.ringRadius = near ? RING_LOW_M : RING_DESKTOP_M;
    (this.material.uniforms.uRing!.value as THREE.Vector2).set(this.ringRadius * RING_FADE_SHARE, this.ringRadius);
  }

  /**
   * Places this frame's clouds round `camera` and points the coverage pass at the ground
   * round it. After `advanceCloudShadows` (the pan) and the sky's compose (the sun, the
   * colours, the amount), before the frame is drawn.
   */
  update(seed: number, camera: THREE.Camera): void {
    if (this.set === null || this.set.seed !== seed) {
      this.set = cloudSet(seed);
      this.blobs?.dispose();
      this.blobs = blobTexture(this.set);
      this.material.uniforms.uBlobs!.value = this.blobs;
    }
    const set = this.set;
    const sky = this.sky;
    this.root.visible = sky.uCloudAmount.value > 0.003;
    const fading = sky.uCloudAmount.value < 0.999;
    for (const mesh of this.prepassMeshes) mesh.visible = fading;
    const strength = cloudShadowLive.strength.value;
    this.shadowPass = strength > 0;
    if (!this.root.visible && !this.shadowPass) return;

    this.sunLin.copy(sky.uSunColor.value).convertSRGBToLinear();
    this.zenithLin.copy(sky.uZenith.value).convertSRGBToLinear();
    this.horizonLin.copy(sky.uHorizon.value).convertSRGBToLinear();
    this.material.uniforms.uDustFog!.value = sky.fog.density;

    const eye = camera.position;
    const pan = cloudPanUniform.value;
    const eyeX = eye.x + pan.x;
    const eyeZ = eye.z + pan.y;
    const storm = weather.cloud;
    const shift = cloudDeckShiftLive;
    for (const mesh of [...this.skyMeshes, ...this.prepassMeshes, ...this.coverageMeshes]) mesh.position.set(eye.x, 0, eye.z);

    // The sky: every cloud whose nearest edge is inside the ring, each where its deck's
    // wind has carried it. The whole list (a few thousand candidates at most) rather than a
    // search by cell: the ring reaches over most of the period anyway, and each deck stands
    // somewhere else in it.
    this.smallSky.count = 0;
    this.bigSky.count = 0;
    if (this.root.visible) {
      for (let i = 0; i < set.count; i++) {
        const grow = cloudGrow(set, i, storm);
        if (grow <= 0) continue;
        const deck = set.deck[i]!;
        const dx = wrapDelta(set.x[i]! + shift[2 * deck]!, eyeX);
        const dz = wrapDelta(set.z[i]! + shift[2 * deck + 1]!, eyeZ);
        if (Math.hypot(dx, dz) - set.reach[i]! * grow > this.ringRadius) continue;
        pushCloud(set.compact[i] === 1 ? this.smallSky : this.bigSky, set, dx, dz, i, grow);
      }
    }

    // The shadows: every cloud whose slide along the sun can reach the map. The map's
    // centre is snapped to its texels in the FIELD, where the clouds stand still, so a
    // shadow's edge does not crawl as the eye moves.
    this.smallShadow.count = 0;
    this.bigShadow.count = 0;
    if (this.shadowPass) {
      const slope = cloudShadowLive.slope.value;
      const mapX = Math.round((eyeX - eye.y * slope.x) / MAP_TEXEL_M) * MAP_TEXEL_M;
      const mapZ = Math.round((eyeZ - eye.y * slope.y) / MAP_TEXEL_M) * MAP_TEXEL_M;
      const half = MAP_WIDTH_M / 2;
      // Where a cloud must stand for its shadow to land on the map: the map slid up the
      // sun between the lowest base and the highest top.
      const lowX = mapX + slope.x * CLOUD_FLOOR_M;
      const lowZ = mapZ + slope.y * CLOUD_FLOOR_M;
      const highX = mapX + slope.x * CLOUD_CEILING_M;
      const highZ = mapZ + slope.y * CLOUD_CEILING_M;
      const midX = (lowX + highX) / 2;
      const midZ = (lowZ + highZ) / 2;
      for (let i = 0; i < set.count; i++) {
        const grow = cloudGrow(set, i, storm);
        if (grow <= 0) continue;
        const deck = set.deck[i]!;
        // The copy nearest the middle of the strip, as an offset from the eye.
        const x = midX + wrapDelta(set.x[i]! + shift[2 * deck]!, midX);
        const z = midZ + wrapDelta(set.z[i]! + shift[2 * deck + 1]!, midZ);
        const lift = set.base[i]! + set.top[i]! * grow * 0.5;
        const pad = half + set.reach[i]! * grow + set.top[i]! * grow * 0.5 * Math.max(Math.abs(slope.x), Math.abs(slope.y));
        if (Math.abs(x - lift * slope.x - mapX) > pad || Math.abs(z - lift * slope.y - mapZ) > pad) continue;
        pushCloud(set.compact[i] === 1 ? this.smallShadow : this.bigShadow, set, x - eyeX, z - eyeZ, i, grow);
      }
      // The map's centre in scene metres, where the ground and the pass both read it.
      const centreX = mapX - pan.x;
      const centreZ = mapZ - pan.y;
      (this.coverageMaterial.uniforms.uMap!.value as THREE.Vector3).set(centreX, centreZ, half);
      setCloudShadowMap(this.map.texture, centreX, centreZ, MAP_WIDTH_M);
    }
    commitList(this.smallShadow);
    commitList(this.bigShadow);
  }

  /**
   * Before every render of the scene the clouds are in (`Scene.onBeforeRender`, render/
   * sky.ts), with that render's camera: the sky lists down to the clouds the camera can
   * see. The list held every cloud round the eye, so the scene pass drew the whole ring
   * of them behind and beside the view, about 300 000 triangles, and so did each live
   * mirror (render/carmirrors.ts), whose view is a few degrees of it. Here, before the
   * render projects its objects, so the attribute uploads in the same render.
   */
  cullFor(camera: THREE.Camera): void {
    if (!this.root.visible) return;
    _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProjection, camera.coordinateSystem);
    const origin = this.skyMeshes[0]!.position;
    cullList(this.smallSky, _frustum, origin.x, origin.z);
    cullList(this.bigSky, _frustum, origin.x, origin.z);
  }

  /**
   * The coverage pass and its blur, before the scene pass (`Renderer.setCloudShadowPass`),
   * inside the frame's GPU timing. Nothing at night: the ground reads no shade then.
   */
  draw(): void {
    if (!this.shadowPass) return;
    const webgl = this.webgl;
    const previous = webgl.getRenderTarget();
    webgl.setRenderTarget(this.map);
    webgl.render(this.coverageScene, this.passCamera);
    const blur = this.blurMaterial.uniforms;
    blur.uSource!.value = this.map.texture;
    (blur.uStep!.value as THREE.Vector2).set(1 / MAP_SIZE, 0);
    webgl.setRenderTarget(this.mapBlur);
    webgl.render(this.blurScene, this.passCamera);
    blur.uSource!.value = this.mapBlur.texture;
    (blur.uStep!.value as THREE.Vector2).set(0, 1 / MAP_SIZE);
    webgl.setRenderTarget(this.map);
    webgl.render(this.blurScene, this.passCamera);
    webgl.setRenderTarget(previous);
  }

  /** Links the coverage and blur programs behind the loading cover (`waitForFrameShaders`). */
  compile(): Promise<unknown> {
    const previous = this.webgl.getRenderTarget();
    try {
      this.webgl.setRenderTarget(this.map);
      return Promise.all([
        compileAsyncSafe(this.webgl, this.coverageScene, this.passCamera),
        compileAsyncSafe(this.webgl, this.blurScene, this.passCamera),
      ]);
    } finally {
      this.webgl.setRenderTarget(previous);
    }
  }

  dispose(): void {
    for (const list of [this.smallSky, this.bigSky, this.smallShadow, this.bigShadow]) list.geometry.dispose();
    this.blobs?.dispose();
    this.map.dispose();
    this.mapBlur.dispose();
    this.fullscreen.dispose();
    this.material.dispose();
    this.coverageMaterial.dispose();
    this.blurMaterial.dispose();
    this.resetMaterial.dispose();
    this.prepassMaterial.dispose();
  }
}
