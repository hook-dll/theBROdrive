import * as THREE from 'three';
import { DESERT_TILE_SIZE } from '../world/deserttiledata';

/**
 * DISSOLVE WHAT STANDS BEYOND THE TRUE GROUND.
 *
 * The ground is drawn by two systems: the fine player-centred desert tiles, which are
 * the height field itself, and past them the vista, a camera-centred polar mesh whose
 * heights are interpolated from samples up to a cell away (render/vista.ts). Measured
 * against `Terrain.heightAt`, the vista is off by 3-5 m at the 90th percentile and by
 * 10 m and more over dunes. A prop placed on the true field past the tiles therefore
 * hovers over — or sinks into — the ground the eye actually sees there, and on the
 * skyline a hovering cactus is the most visible thing in the frame.
 *
 * So a prop dissolves as it nears the edge of the tile WINDOW — the 5x5 square of
 * tiles round the player's own (world/deserttiles.ts) — and is gone before it would
 * stand on vista. The window, not a radius: a radius small enough to be safe in the
 * window's nearest direction threw away props the tiles still carry in its corners.
 * A screen-space dither keeps the shader opaque (no sorting, no transparency pass);
 * at that range a saguaro is a few pixels tall and the pattern cannot be seen.
 */

/** Tiles each side of the player's own that the visual window holds. */
const WINDOW_TILES = 2;
/** Metres inside the window edge over which a prop dissolves. */
const FADE_M = 60;

const FADE_KEY = 'ground-fade-v2';
const patched = new WeakSet<THREE.Material>();

/** The window in SCENE coordinates: (minX, minZ, maxX, maxZ). */
const uGroundWindow = { value: new THREE.Vector4(-1e9, -1e9, 1e9, 1e9) };
/** The same window in ABSOLUTE metres, for CPU callers. */
const absWindow = { minX: -1e9, minZ: -1e9, maxX: 1e9, maxZ: 1e9 };

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
 * Moves the window to the one around the absolute point the tiles are streamed for.
 * `originX/Z` is the rebase origin: props render in scene coordinates.
 */
export function setGroundFadeWindow(absX: number, absZ: number, originX: number, originZ: number): void {
  const tx = Math.floor(absX / DESERT_TILE_SIZE);
  const tz = Math.floor(absZ / DESERT_TILE_SIZE);
  absWindow.minX = (tx - WINDOW_TILES) * DESERT_TILE_SIZE;
  absWindow.minZ = (tz - WINDOW_TILES) * DESERT_TILE_SIZE;
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
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundFadeXZ;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
	{
		vec4 groundFadeWorld = vec4( transformed, 1.0 );
		#ifdef USE_INSTANCING
		groundFadeWorld = instanceMatrix * groundFadeWorld;
		#endif
		vGroundFadeXZ = ( modelMatrix * groundFadeWorld ).xz;
	}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundFadeXZ;\nuniform vec4 uGroundWindow;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
	{
		vec2 groundFadeIn = min( vGroundFadeXZ - uGroundWindow.xy, uGroundWindow.zw - vGroundFadeXZ );
		float groundFade = 1.0 - smoothstep( 0.0, ${FADE_M.toFixed(1)}, min( groundFadeIn.x, groundFadeIn.y ) );
		if ( groundFade > 0.0 ) {
			float dither = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
			if ( dither < groundFade ) discard;
		}
	}`,
      );
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:${FADE_KEY}`;
  return material;
}
