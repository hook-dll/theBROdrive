import { createWaterMaterial, type WaterMaterial } from './watermaterial';

/**
 * The stream surfaces' material: the lake water, flat-shaded, and one instance of it.
 *
 * WHY THE LAKE'S OWN WATER. A stream and a pond in this country are the same substance
 * seen at different scales, and `watermaterial.ts` already carries everything either of
 * them needs from the scene: the fog, the sky's own environment probe and the sun's
 * specular, with the wave normal map scrolling across both. Two materials would be two
 * wave phases on the same substance, and the seam between a stream and the pond it
 * feeds would show it.
 *
 * WHY THE NORMAL IS A CONSTANT. The stream surface is a sheet of quads built straight
 * out of the tile lattice (world/deserttiledata.ts) and it carries no normals of its
 * own. A lattice of quads all facing up is a surface whose normal IS up, so the shader
 * is told so — and the obvious alternative, flat shading, does not work here: each quad
 * of a stream sits at its own level (the bed slopes), so per-face normals differ by a
 * fraction of a degree between neighbours, and against a sky reflection that is a
 * visible grid of seams across the water. One constant normal costs no vertex array at
 * all, and the wave map still perturbs it, so the sparkle is untouched.
 */
export const STREAM_WATER: WaterMaterial = createWaterMaterial();
STREAM_WATER.material.flatShading = false;
const compileStream = STREAM_WATER.material.onBeforeCompile;
STREAM_WATER.material.onBeforeCompile = (shader, renderer) => {
  compileStream?.call(STREAM_WATER.material, shader, renderer);
  shader.vertexShader = shader.vertexShader.replace(
    '#include <beginnormal_vertex>',
    'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );',
  );
};
STREAM_WATER.material.customProgramCacheKey = () => 'stream-water-v1';
/**
 * Less mirror than a lake, and a rougher one.
 *
 * A lake is open to the sky across hundreds of metres; a stream runs under willows with
 * its banks leaning over it, and at the lake's 0.13 roughness and 1.25 environment gain
 * the surface came back as a silver sheet of sky — which on a 15 m channel reads as
 * polished metal rather than as water.
 */
STREAM_WATER.material.roughness = 0.24;
STREAM_WATER.material.envMapIntensity = 0.85;
STREAM_WATER.material.normalScale.set(0.55, 0.55);

/** Advances the stream surfaces' wave scroll. Called once per rendered frame. */
export function advanceStreamWater(dt: number): void {
  STREAM_WATER.advance(dt);
}

/** Frees the material and its wave map. For a full teardown, not for a tile. */
export function disposeStreamWater(): void {
  STREAM_WATER.dispose();
}
