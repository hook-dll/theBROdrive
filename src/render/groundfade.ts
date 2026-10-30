import * as THREE from 'three';
import { DESERT_TILE_SIZE } from '../world/deserttiledata';

/**
 * DISSOLVE WHAT STANDS BEYOND THE TRUE GROUND.
 *
 * The ground is drawn by two systems: the fine player-centred desert tiles, which are
 * the height field itself, and past them the vista, a polar mesh that follows the camera
 * in 15.6 m steps and whose heights are interpolated from samples up to a cell away
 * (render/vista.ts). Measured against `Terrain.heightAt`, the vista is off by 3-5 m at
 * the 90th percentile and by 10 m and more over dunes. A prop placed on the true field
 * past the tiles therefore hovers over — or sinks into — the ground the eye actually
 * sees there, and on the skyline a hovering cactus is the most visible thing in the
 * frame.
 *
 * So a prop dissolves as it nears the edge of the tile WINDOW — the 5x5 square of
 * tiles round the player's own (world/deserttiles.ts) — and is gone before it would
 * stand on vista. The window, not a radius: a radius small enough to be safe in the
 * window's nearest direction threw away props the tiles still carry in its corners.
 * The dissolve keeps the shader opaque (no sorting, no transparency pass) by
 * discarding a growing share of the prop's surface. Which share is decided by a hashed
 * alpha test (Wyman & McGuire, "Hashed Alpha Testing", 2017): a hash of the prop's
 * own position on a lattice about one pixel across, so the pattern is fixed to the prop
 * rather than to the screen. The old screen-space dither stood still while the world
 * slid under it, so the half-dissolved props on the skyline crawled whenever the car
 * moved. The lattice size comes from the position's own screen derivatives, rounded to
 * a power of two, with the hashes of the two neighbouring sizes blended (and the blend
 * remapped back to a uniform threshold) so that approaching a prop changes its pattern
 * gradually rather than in a jump at each size. Its coordinates are the ones the
 * mesh's own group holds (the tile's, for the tiles' props), which a rebase moves as a
 * whole, so a rebase changes nothing either.
 */

/** Tiles each side of the player's own that the visual window holds. */
const WINDOW_TILES = 2;
/** Metres inside the window edge over which a prop dissolves. */
const FADE_M = 60;

const FADE_KEY = 'ground-fade-v3';
const patched = new WeakSet<THREE.Material>();

/** The window in SCENE coordinates: (minX, minZ, maxX, maxZ). */
const uGroundWindow = { value: new THREE.Vector4(-1e9, -1e9, 1e9, 1e9) };
/** The same window in ABSOLUTE metres, for CPU callers. */
const absWindow = { minX: -1e9, minZ: -1e9, maxX: 1e9, maxZ: 1e9 };
/** Bumped whenever the window moves (`groundWindowRevision`). */
let windowRevision = 0;

/**
 * Metres by which an absolute point lies OUTSIDE the fine tile window (negative when
 * inside). The vista asks this before it lifts its ground to the road.
 */
export function outsideGroundWindow(absX: number, absZ: number): number {
  const dx = Math.max(absWindow.minX - absX, absX - absWindow.maxX);
  const dz = Math.max(absWindow.minZ - absZ, absZ - absWindow.maxZ);
  return Math.max(dx, dz);
}

/**
 * A number that changes whenever the window moves: the vista rewrites its road raise
 * (render/vista.ts `roadRaiseAt`) only then, not every frame.
 */
export function groundWindowRevision(): number {
  return windowRevision;
}

/**
 * Moves the window to the one around the absolute point the tiles are streamed for.
 * `originX/Z` is the rebase origin: props render in scene coordinates.
 */
export function setGroundFadeWindow(absX: number, absZ: number, originX: number, originZ: number): void {
  const tx = Math.floor(absX / DESERT_TILE_SIZE);
  const tz = Math.floor(absZ / DESERT_TILE_SIZE);
  const minX = (tx - WINDOW_TILES) * DESERT_TILE_SIZE;
  const minZ = (tz - WINDOW_TILES) * DESERT_TILE_SIZE;
  if (minX !== absWindow.minX || minZ !== absWindow.minZ) windowRevision++;
  absWindow.minX = minX;
  absWindow.minZ = minZ;
  absWindow.maxX = (tx + WINDOW_TILES + 1) * DESERT_TILE_SIZE;
  absWindow.maxZ = (tz + WINDOW_TILES + 1) * DESERT_TILE_SIZE;
  uGroundWindow.value.set(
    (tx - WINDOW_TILES) * DESERT_TILE_SIZE - originX,
    (tz - WINDOW_TILES) * DESERT_TILE_SIZE - originZ,
    (tx + WINDOW_TILES + 1) * DESERT_TILE_SIZE - originX,
    (tz + WINDOW_TILES + 1) * DESERT_TILE_SIZE - originZ,
  );
}

/** Gives one prop material the window dissolve. Idempotent; chains any existing patch. */
export function applyGroundFade<T extends THREE.MeshStandardMaterial>(material: T): T {
  if (patched.has(material)) return material;
  patched.add(material);
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.uGroundWindow = uGroundWindow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundFadeXZ;\nvarying vec3 vGroundFadeLocal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
	{
		vec4 groundFadeWorld = vec4( transformed, 1.0 );
		#ifdef USE_INSTANCING
		groundFadeWorld = instanceMatrix * groundFadeWorld;
		#endif
		#ifdef USE_BATCHING
		groundFadeWorld = batchingMatrix * groundFadeWorld;
		#endif
		vGroundFadeLocal = groundFadeWorld.xyz;
		vGroundFadeXZ = ( modelMatrix * groundFadeWorld ).xz;
	}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vGroundFadeXZ;
varying vec3 vGroundFadeLocal;
uniform vec4 uGroundWindow;
float groundFadeHash( vec3 p ) {
	p = fract( p * 0.1031 );
	p += dot( p, p.zyx + 31.32 );
	return fract( ( p.x + p.y ) * p.z );
}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
	{
		vec2 groundFadeIn = min( vGroundFadeXZ - uGroundWindow.xy, uGroundWindow.zw - vGroundFadeXZ );
		float groundFade = 1.0 - smoothstep( 0.0, ${FADE_M.toFixed(1)}, min( groundFadeIn.x, groundFadeIn.y ) );
		// Derivatives before the branch: they are undefined in non-uniform control flow.
		float groundFadeStep = max( length( dFdx( vGroundFadeLocal ) ), length( dFdy( vGroundFadeLocal ) ) );
		if ( groundFade > 0.0 ) {
			// Lattice cells per metre so that one cell is about one pixel, as a power of two
			// and the next one up, blended by where the true size falls between them.
			float level = log2( 1.0 / max( groundFadeStep, 1e-6 ) );
			float levelLow = floor( level );
			float blend = level - levelLow;
			float x = mix(
				groundFadeHash( floor( exp2( levelLow ) * vGroundFadeLocal ) ),
				groundFadeHash( floor( exp2( levelLow + 1.0 ) * vGroundFadeLocal ) ),
				blend
			);
			// The blend of two uniform hashes is not uniform; its CDF makes it so again,
			// so the share discarded stays exactly groundFade at every blend.
			float a = clamp( min( blend, 1.0 - blend ), 1e-4, 0.5 );
			float threshold = x < a
				? x * x / ( 2.0 * a * ( 1.0 - a ) )
				: x < 1.0 - a
					? ( x - 0.5 * a ) / ( 1.0 - a )
					: 1.0 - ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) );
			if ( threshold < groundFade ) discard;
		}
	}`,
      );
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:${FADE_KEY}`;
  return material;
}
