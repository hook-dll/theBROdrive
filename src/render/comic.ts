import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';

/**
 * Comic-book shading for the ground: banded light, strata contours, ink stipple.
 *
 * The desert was geometrically right and visually empty — a correct dune, filled
 * with one flat colour, because a smooth Lambert term over a 240 m dune wavelength
 * produces a gradient so gentle the eye reads it as paint. What a hand-drawn desert
 * (Mars First Logistics, Moebius, any BD landscape) uses instead is three things,
 * and none of them is more polygons:
 *
 *  1. BANDED LIGHT. Lambert quantised into a few steps, so the terminator between
 *     lit and shaded ground is a hard line that traces the shape of the land. This
 *     is what makes a dune read as a dune from a kilometre away.
 *  2. STRATA CONTOURS. Thin dark lines at fixed elevations, so slopes carry the
 *     horizontal banding of sedimentary rock and the eye gets a scale reference.
 *     They are drawn with a screen-space width, so they stay hairlines at any
 *     distance instead of turning into wide stripes underfoot.
 *  3. STIPPLE. Scattered ink dots on flat ground — the pen-and-ink way of saying
 *     "this is a surface", and the specific thing missing when a plain field of
 *     colour looks like nothing at all. Denser close up, faded out before the dots
 *     alias into noise.
 *
 * All three are per-pixel and cost nothing in geometry. The silhouette outlines that
 * complete the look are a separate matter, drawn in the post pass (core/renderer.ts)
 * because they need neighbouring pixels rather than surface parameters.
 *
 * Everything here is applied through `onBeforeCompile` on top of the stock
 * MeshStandardMaterial, following the same pattern as the rust/dirt patch in
 * materials.ts: the lighting stays physical (fog, shadows and the sun's own colour
 * all keep working) and only the final colour is stylised.
 */

export interface ComicOptions {
  /** Quantisation steps in the diffuse term. 3-5 reads as ink, 12 as smooth. */
  readonly bands: number;
  /** Amount of diffuse-light quantisation, 0..1. */
  readonly lightingStrength: number;
  /** Amount of warm shadow tint, 0..1. */
  readonly shadowWarmth: number;
  /** Vertical spacing of the strata contours, metres. */
  readonly contourSpacing: number;
  /** How dark a contour line is, 0..1. */
  readonly contourStrength: number;
  /** How dark the stipple dots are, 0..1. */
  readonly stippleStrength: number;
  /** Stipple cell size in metres: one dot per cell at most. */
  readonly stippleCell: number;
  /** Distance (m) by which stipple has faded out entirely. */
  readonly stippleRange: number;
}

/**
 * Tuned by looking, and every value here was too strong on the first pass:
 *
 *  - 2.6 m contours turned a dune face into corrugated iron, because a steep slope
 *    packs many iso-heights into a few metres of screen. 7 m plus the merge fade in
 *    the shader (lines vanish once they would sit closer than a couple of pixels)
 *    leaves strata you read rather than a hatch you squint at.
 *  - Stipple at 0.36 with a 0.13-0.25 cell radius drew 25 cm pebbles. Dots want to
 *    be barely-there: small, sparse, and gone by 60 m.
 *  - Full banding (mix 1.0) flattened shadowed sand into grey plates. 0.55 keeps
 *    the hard terminator while the sun's falloff still lives inside each band.
 */
export const DEFAULT_COMIC: ComicOptions = {
  bands: 5,
  lightingStrength: 0.55,
  shadowWarmth: 1,
  contourSpacing: 7,
  contourStrength: 0.22,
  stippleStrength: 0.28,
  stippleCell: 0.5,
  stippleRange: 80,
};

/** One program for every comic material, so they all share a compile. */
const COMIC_PROGRAM_KEY = 'comic-ground-v2';
const GROUND_SPOT_PROGRAM_KEY = 'ground-slope-spot-v1';
const LIGHTS_FRAGMENT_BEGIN = '#include <lights_fragment_begin>';
const DIRECT_CALL =
  'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const SLOPE_SPOT_HELPER = /* glsl */ `
vec3 groundSlopeNormal( vec3 position, vec3 flatNormal ) {
	vec3 slope = normalize( cross( dFdx( position ), dFdy( position ) ) );
	return dot( slope, flatNormal ) < 0.0 ? -slope : slope;
}
`;
const SLOPE_SPOT_CALL =
  'RE_Direct( directLight, geometryPosition, groundSlopeNormal( geometryPosition, geometryNormal ), geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

/**
 * Ground uses authored upward normals for uniform sun colour. Spotlights need the
 * real geometric slope, however: on an uphill face the car is below a world-up
 * normal's horizon and Lambert rejects the beam completely. Replace only the spot
 * loop's direct-light call with a derivative normal; sun and hemisphere stay flat.
 *
 * `onBeforeCompile` receives the shader before Three expands ShaderChunk includes,
 * so patch the stock lighting chunk and splice it in at its include site.
 */
function patchGroundSpotNormal(fragmentShader: string): string {
  const lightsChunk = THREE.ShaderChunk.lights_fragment_begin;
  const spotLoop = lightsChunk.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )');
  const spotLoopEnd = lightsChunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 )', spotLoop);
  const directCall = spotLoop >= 0 ? lightsChunk.indexOf(DIRECT_CALL, spotLoop) : -1;
  if (directCall < 0 || spotLoopEnd < 0 || directCall >= spotLoopEnd) {
    throw new Error('Three spotlight shader layout changed');
  }
  const patchedLightsChunk =
    lightsChunk.slice(0, directCall) +
    SLOPE_SPOT_CALL +
    lightsChunk.slice(directCall + DIRECT_CALL.length);
  const include = fragmentShader.indexOf(LIGHTS_FRAGMENT_BEGIN);
  if (include < 0) throw new Error('Three lighting include layout changed');
  let patched =
    fragmentShader.slice(0, include) +
    patchedLightsChunk +
    fragmentShader.slice(include + LIGHTS_FRAGMENT_BEGIN.length);
  const main = patched.indexOf('void main() {');
  if (main < 0) throw new Error('Three fragment main layout changed');
  patched = patched.slice(0, main) + SLOPE_SPOT_HELPER + patched.slice(main);
  return patched;
}
const VERTEX_PARS = /* glsl */ `
varying vec3 vViewPosition;
varying vec3 vComicWorld;
varying vec3 vComicNormal;`;

const VERTEX_HOOK = /* glsl */ `
#include <worldpos_vertex>
  vComicWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vComicNormal = normalize( mat3( modelMatrix ) * objectNormal );`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vViewPosition;
varying vec3 vComicWorld;
varying vec3 vComicNormal;
uniform float uComicBands;
uniform float uComicLightingStrength;
uniform float uComicShadowWarmth;
uniform float uContourSpacing;
uniform float uContourStrength;
uniform float uStippleStrength;
uniform float uStippleCell;
uniform float uStippleRange;

float comicHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}

/**
 * Ink dots on a jittered lattice. The dot radius is compared against the pixel
 * footprint of a cell, so a dot that would land inside one pixel is faded out
 * instead of flickering — the usual death of procedural stipple.
 */
float comicStipple( vec2 world, float footprint ) {
  vec2 cell = floor( world );
  vec2 local = fract( world ) - 0.5;
  float keep = comicHash( cell );
  if ( keep > 0.22 ) return 0.0;
  vec2 jitter = vec2( comicHash( cell + 11.3 ), comicHash( cell + 27.7 ) ) - 0.5;
  float radius = 0.05 + comicHash( cell + 3.1 ) * 0.055;
  float d = length( local - jitter * 0.55 );
  float edge = max( footprint, 0.015 );
  return 1.0 - smoothstep( radius - edge, radius + edge, d );
}
`;

/**
 * Applied where the lit colour exists but tone mapping has not yet run, so the
 * banding is quantised in linear light and the sun's own colour still tints it.
 */
const FRAGMENT_HOOK = /* glsl */ `
{
  // --- banded light -------------------------------------------------------
  // Quantise brightness, not colour: scaling the RGB by a stepped luminance keeps
  // the surface's own hue (sand, rock, gravel) and only posterises the shading.
  float lum = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  if ( lum > 0.0001 ) {
    float stepped = floor( lum * uComicBands + 0.5 ) / uComicBands;
    // Part-way to fully banded: the hard terminator reads as ink, but a completely
    // flat band loses the sun's falloff across a long dune face and shadowed sand
    // collapses into grey plates.
    gl_FragColor.rgb *= mix( 1.0, stepped / lum, uComicLightingStrength );
  }

  // Shaded ground is warmer, not greyer. This can be disabled for a surface that
  // wants comic contours and stipple while retaining its physical shadow colour.
  float shade = 1.0 - smoothstep( 0.12, 0.45, lum );
  gl_FragColor.rgb *= mix( vec3( 1.0 ), vec3( 1.07, 0.97, 0.86 ), shade * uComicShadowWarmth );

  float viewDist = length( vViewPosition );

  // --- strata contours ----------------------------------------------------
  // Iso-height lines, widened to a constant number of pixels by dividing the
  // distance to the nearest line by the height's own screen-space derivative.
  float h = vComicWorld.y / uContourSpacing;
  float dh = max( fwidth( h ), 1e-5 );
  float band = abs( fract( h ) - 0.5 ) / dh;
  float line = 1.0 - smoothstep( 0.35, 1.35, band );
  // Fade the lines out once consecutive iso-heights would land within a couple of
  // pixels of each other. Without this a steep face packs dozens of them into a few
  // pixels and draws corrugated iron.
  line *= 1.0 - smoothstep( 0.12, 0.4, dh );
  // Only on slopes: on flat ground a contour line has no width in plan view and
  // would flood whole areas as the surface grazes an iso-height.
  float slope = 1.0 - abs( vComicNormal.y );
  line *= smoothstep( 0.06, 0.3, slope );
  gl_FragColor.rgb *= 1.0 - line * uContourStrength;

  // --- stipple ------------------------------------------------------------
  vec2 stippleUv = vComicWorld.xz / uStippleCell;
  float footprint = max( fwidth( stippleUv.x ), fwidth( stippleUv.y ) );
  float fade = 1.0 - smoothstep( uStippleRange * 0.35, uStippleRange, viewDist );
  fade *= 1.0 - smoothstep( 0.35, 0.9, footprint );
  if ( fade > 0.001 ) {
    float dots = comicStipple( stippleUv, footprint ) * fade;
    // Dots gather on flatter ground, where a pen would use them; slopes get the
    // contour lines instead, so the two never fight over the same pixels.
    dots *= mix( 0.35, 1.0, abs( vComicNormal.y ) );
    gl_FragColor.rgb *= 1.0 - dots * uStippleStrength;
  }
}
#include <tonemapping_fragment>`;

function patch(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: Record<string, THREE.IUniform>,
): void {
  for (const [name, uniform] of Object.entries(uniforms)) shader.uniforms[name] = uniform;

  shader.vertexShader = shader.vertexShader
    .replace('varying vec3 vViewPosition;', VERTEX_PARS)
    .replace('#include <worldpos_vertex>', VERTEX_HOOK);

  shader.fragmentShader = patchGroundSpotNormal(
    shader.fragmentShader
      .replace('varying vec3 vViewPosition;', FRAGMENT_PARS)
      .replace('#include <tonemapping_fragment>', FRAGMENT_HOOK),
  );
}

/**
 * Stylises one material in place. Safe to call on a shared material at module load;
 * the patch only runs when the program is first compiled.
 */
export function applyComicShading(
  material: THREE.MeshStandardMaterial,
  options: Partial<ComicOptions> = {},
): THREE.MeshStandardMaterial {
  const o = { ...DEFAULT_COMIC, ...options };
  const uniforms: Record<string, THREE.IUniform> = {
    uComicBands: { value: o.bands },
    uComicLightingStrength: { value: o.lightingStrength },
    uComicShadowWarmth: { value: o.shadowWarmth },
    uContourSpacing: { value: o.contourSpacing },
    uContourStrength: { value: o.contourStrength },
    uStippleStrength: { value: o.stippleStrength },
    uStippleCell: { value: o.stippleCell },
    uStippleRange: { value: o.stippleRange },
  };
  material.onBeforeCompile = (shader) => patch(shader, uniforms);
  material.customProgramCacheKey = () => COMIC_PROGRAM_KEY;
  return material;
}

/** Applies slope-correct spotlight response without the comic surface treatment. */
export function applyGroundSpotlightNormals(
  material: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = patchGroundSpotNormal(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => GROUND_SPOT_PROGRAM_KEY;
  return material;
}
