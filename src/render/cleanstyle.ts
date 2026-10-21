import * as THREE from 'three';

/**
 * THE CLEAN STYLE (`Settings.style`): a calm, temporally stable low-poly picture.
 *
 * Standard is the game as it was tuned. Clean is an art direction for eyes that tire
 * of it: large quiet shapes, nothing on screen smaller than a few pixels, and nothing
 * that changes from one frame to the next unless the world did. Its parts:
 *
 *  1. Ground and building finishes lose their painted texture and normal relief: the
 *     road in every surface, the sites' wall and floor patterns read their map's mean
 *     colour (`applyCleanSurface`), and the desert loses its ink stipple
 *     (render/comic.ts). Vertex colours, markings and strata stay.
 *  2. Small scatter shrinks away once it would be under `CLEAN_CULL_GONE_PX` tall, and
 *     the batch pages wholly past that line are not drawn (`applyCleanCull`,
 *     world/props/instancebatch.ts `syncLod`).
 *  3. Lit surfaces take the face normal of their triangle and the sun's light in a few
 *     steps (render/lightshader.ts `installCleanStyle`).
 *  The near shadow cascade is read the same soft way in both styles: Clean once read it
 *  with one hardware tap, and the owner saw a hard, stair-stepped car shadow (2026-10-16).
 *
 * NONE OF IT IS A PROGRAM VARIANT. Every part is GLSL that both styles compile — in
 * the shared chunks, installed before anything compiles, or in a patch a material
 * always carries — behind a branch on a uniform every fragment agrees on. Switching
 * style writes two small vectors; no program is linked, no material key changes, and
 * Standard runs exactly the arithmetic it ran before, plus the untaken branches.
 *
 * The uniform values are PLAIN OBJECTS on purpose, as in render/airfog.ts:
 * `UniformsUtils.clone` copies a three vector per material but passes a plain object
 * through by reference, so every program shares these and one write reaches all of
 * them. A program whose material never received one (a hand-written ShaderMaterial)
 * sees zeros, which is Standard.
 */

/**
 * The lit programs' switches, `uniform vec3 cleanStyle`: x faceted normals and banded
 * sun, z flat surfaces; y is unused since the near shadow is the same in both styles.
 * Each is 0 or 1; they move together today and are separate so a lab can look at one
 * at a time.
 */
export const cleanStyle = { x: 0, y: 0, z: 0 };

/**
 * Where small scatter is gone, and where it is whole, in pixels of projected height.
 * Under six pixels a tuft is a speck that lights and goes out as the frame's sampling
 * slides across it; the band to eight lets it shrink to nothing instead of popping.
 */
export const CLEAN_CULL_GONE_PX = 6;
const CLEAN_CULL_FULL_PX = 8;

/**
 * The small-scatter cull, `uniform vec2 cleanCull`: x half the presented frame height
 * in pixels (0 in Standard, which switches the cull off), y the height in pixels below
 * which a prop is gone. Full size from `CLEAN_CULL_FULL_PX` up.
 */
export const cleanCull = { x: 0, y: CLEAN_CULL_GONE_PX };

let cleanOn = false;
let frameHeightPx = 0;

/** Switches every Clean uniform on or off. Uniform writes only; see the header. */
export function setCleanStyle(on: boolean): void {
  cleanOn = on;
  const value = on ? 1 : 0;
  cleanStyle.x = value;
  cleanStyle.z = value;
  cleanCull.x = on ? frameHeightPx * 0.5 : 0;
}

/** The presented frame's height in device pixels, which the cull's pixel sizes are counted in. */
export function setCleanFrameHeight(heightPx: number): void {
  frameHeightPx = heightPx;
  cleanCull.x = cleanOn ? heightPx * 0.5 : 0;
}

/**
 * Pixels one metre covers at one metre's distance through `projection`, or 0 in
 * Standard: the CPU side of the cull, from the same numbers the shader multiplies.
 * Divided by a distance it is a size on screen.
 */
export function cleanPixelsPerMetre(projection: THREE.Matrix4): number {
  return cleanCull.x * projection.elements[5]!;
}

/**
 * Fragment define for ground that must keep its interpolated normals: the terrain,
 * the road and its markings. Their meshes are fine grids (and the road's normals are
 * authored upward for an even sun), so a face normal would print the triangulation
 * across the desert as a mesh of glints — the opposite of a quiet surface. They take
 * the banded sun all the same.
 */
export const CLEAN_SMOOTH_NORMALS = '#define CLEAN_SMOOTH_NORMALS\n';

// A mip BIAS was not enough: near the camera the computed level is at or below zero, so
// mip 6 of the asphalt still showed the painted aggregate as a blurred mush right behind
// the car. The last mip (`textureLod` past every level) is the texture's mean colour,
// one value for the whole surface: the vertex colour (the road's wear, decay and
// patches) and the markings stay, the painted texture is gone at every distance.
const CLEAN_SURFACE_MAP = /* glsl */ `
#ifdef USE_MAP
	vec4 sampledDiffuseColor;
	if ( cleanStyle.z > 0.0 ) {
		sampledDiffuseColor = textureLod( map, vMapUv, 16.0 );
	} else {
		sampledDiffuseColor = texture2D( map, vMapUv );
	}
	diffuseColor *= sampledDiffuseColor;
#endif`;

// The relief goes with the colour: a low sun raking a flat mat would otherwise draw the
// aggregate back in as light.
const CLEAN_SURFACE_NORMAL = /* glsl */ `
if ( cleanStyle.z <= 0.0 ) {
#include <normal_fragment_maps>
}`;

const SURFACE_KEY = 'clean-surface-v1';
const surfacePatched = new WeakSet<THREE.Material>();

/**
 * Gives a ground or building finish (the road in every surface it is laid in, the
 * sites' plaster, brick, block, board, metal and tile patterns) its Clean branch: the
 * albedo map's mean colour and no normal map. Chains the patches already there;
 * idempotent. The key is the same for every material, so it only joins each one's own.
 */
export function applyCleanSurface<T extends THREE.MeshStandardMaterial>(material: T): T {
  if (surfacePatched.has(material)) return material;
  surfacePatched.add(material);
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', CLEAN_SURFACE_MAP)
      .replace('#include <normal_fragment_maps>', CLEAN_SURFACE_NORMAL);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:${SURFACE_KEY}`;
  return material;
}

const cleanCullUniform = { value: cleanCull };
const cullPatched = new WeakSet<THREE.Material>();

/**
 * Gives a small-scatter material the Clean cull: each instance shrinks to its base
 * as its projected height falls from `CLEAN_CULL_FULL_PX` to `CLEAN_CULL_GONE_PX`.
 * `sizeM` is the material's largest form at scale 1, in metres; the instance's own
 * scale multiplies it.
 *
 * Measured by DISTANCE from the eye, not view depth, so turning the camera never
 * grows or shrinks a prop at the edge of the screen, and so the batch pages can be
 * dropped on the CPU from a ground distance that is never more than it.
 */
export function applyCleanCull<T extends THREE.MeshStandardMaterial>(material: T, sizeM: number): T {
  if (cullPatched.has(material)) return material;
  cullPatched.add(material);
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.cleanCull = cleanCullUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 cleanCull;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
if ( cleanCull.x > 0.0 ) {
	#ifdef USE_INSTANCING
	mat4 cleanCullModel = modelMatrix * instanceMatrix;
	#else
	mat4 cleanCullModel = modelMatrix;
	#endif
	vec3 cleanCullOrigin = ( cleanCullModel * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	float cleanCullPx = ${sizeM.toFixed(3)} * length( cleanCullModel[ 0 ].xyz ) * projectionMatrix[ 1 ][ 1 ] * cleanCull.x
		/ max( distance( cleanCullOrigin, cameraPosition ), 1e-3 );
	transformed *= smoothstep( cleanCull.y, cleanCull.y * ${(CLEAN_CULL_FULL_PX / CLEAN_CULL_GONE_PX).toFixed(4)}, cleanCullPx );
}`,
      );
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:clean-cull-v1`;
  return material;
}
