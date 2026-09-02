/**
 * Shared materials for every procedural mesh in the game.
 *
 * Metal parts rust and gather dirt; scenery does not. Both needs are served by two
 * factories backed by caches, so a colour that appears on a thousand wheels is
 * configured once, and the GPU program behind it is compiled once regardless of how
 * many part instances carry it.
 */

import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { applyComicShading } from './comic';

/** Per-instance uniforms for condition-shaded materials. */
interface ConditionUniforms {
  readonly dirt: { value: number };
  readonly rust: { value: number };
  readonly scratches?: { value: number };
}

interface CarBodyUniforms extends ConditionUniforms {
  readonly palettePaint: { value: number };
  readonly paintColor: { value: THREE.Color };
  readonly paintCell: { value: THREE.Vector2 };
}

/**
 * Eager per-instance uniform objects. Kept OUT of material.userData because
 * Material.copy() JSON-round-trips userData, which would sever the references the
 * compiled program is holding. A WeakMap keeps the objects alive for exactly as long
 * as the material, and lets setCondition write values even before first render.
 */
const carBodyUniforms = new WeakMap<THREE.Material, CarBodyUniforms>();
const conditionUniforms = new WeakMap<THREE.Material, ConditionUniforms>();

/** Templates keyed by parameter tuple. They are only ever cloned, never rendered. */
const conditionTemplates = new Map<string, THREE.MeshStandardMaterial>();

/** Flat materials are shared outright: they carry no per-instance state. */
const flatCache = new Map<string, THREE.MeshStandardMaterial>();

function conditionKey(baseColor: number, metalness: number, roughness: number): string {
  return `${baseColor}:${metalness}:${roughness}`;
}

function flatKey(color: number, roughness: number): string {
  return `${color}:${roughness}`;
}

/** Stable program cache key for every condition material. */
const CONDITION_PROGRAM_KEY = 'condition-rust-dirt-v1';

/**
 * Body paint adds mesh-local dent relief in the same single shader permutation.
 * Version v5 widens the dent field; cached v4 programs retain the old lobe scale.
 */
const CAR_BODY_PROGRAM_KEY = 'condition-rust-dirt-body-v5';
/** Static Soviet cars need atlas recolouring, but no dynamic wear calculations. */
const CAR_PALETTE_PROGRAM_KEY = 'car-palette-paint-v1';

// ---------------------------------------------------------------------------
// GLSL patch
// ---------------------------------------------------------------------------

/**
 * The rust/dirt shader is written once and shared by every condition material. The
 * mottling comes from a 3D hash/value noise on world position — no textures — and the
 * dirt is weighted by the world-space normal's Y so it settles on upward faces and in
 * the pits of the rust mottle.
 *
 * The world position/normal arrive as varyings we inject into the vertex shader; we
 * cannot use the stock `normal` (it is view-space) and `worldPosition` is only
 * emitted under transmission, so the varyings are self-contained.
 */
const VERTEX_VARYING =
  'varying vec3 vViewPosition;\n' +
  'varying vec3 vCondWorldPos;\n' +
  'varying vec3 vCondWorldNormal;\n' +
  'varying vec3 vCondLocalPos;\n' +
  'varying vec3 vCondLocalNormal;\n' +
  // The mesh's own X and Y axes in world space. A mesh-local gradient (the dent
  // relief) has to be rotated into world space to perturb a normal, and
  // `modelMatrix` is declared by three.js in the VERTEX stage only — using it in the
  // fragment shader silently fails to compile, which drops the whole body mesh from
  // the frame. Two axes are enough: the third is their cross product.
  'varying vec3 vCondAxisX;\n' +
  'varying vec3 vCondAxisY;';

// Parts are placed with rotation + uniform scale only, so mat3(modelMatrix) is an
// exact world transform for the normal (no inverse-transpose required).
const WORLD_POS_HOOK =
  '#include <worldpos_vertex>\n' +
  '\tvCondWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n' +
  '\tvCondWorldNormal = mat3( modelMatrix ) * objectNormal;\n' +
  '\tvCondLocalPos = transformed;\n' +
  '\tvCondLocalNormal = objectNormal;\n' +
  '\tvCondAxisX = normalize( mat3( modelMatrix ) * vec3( 1.0, 0.0, 0.0 ) );\n' +
  '\tvCondAxisY = normalize( mat3( modelMatrix ) * vec3( 0.0, 1.0, 0.0 ) );';

const CONDITION_PARS = `
uniform float uDirt;
uniform float uRust;
uniform float uScratches;
uniform float uPalettePaint;
uniform vec3 uPalettePaintColor;
uniform vec2 uPalettePaintCell;



float condHash( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.1, 0.2, 0.3 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

float condNoise( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix(
      mix( condHash( i + vec3( 0.0, 0.0, 0.0 ) ), condHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
      mix( condHash( i + vec3( 0.0, 1.0, 0.0 ) ), condHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ),
      f.y ),
    mix(
      mix( condHash( i + vec3( 0.0, 0.0, 1.0 ) ), condHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
      mix( condHash( i + vec3( 0.0, 1.0, 1.0 ) ), condHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ),
      f.y ),
    f.z );
}

float condFbm( vec3 p ) {
  return condNoise( p ) * 0.55
    + condNoise( p * 2.7 + 11.0 ) * 0.3
    + condNoise( p * 7.3 + 29.0 ) * 0.15;
}

/**
 * Rust distribution, sampled once and shared by the shading hook and the normal
 * hook so the pitting and the colour can never disagree.
 *   x = rust coverage, 0..1, before the uRust scale
 *   y = the coarse mottle, which the dirt term also needs for its pits
 */
vec2 condRust( vec3 p ) {
  float mottle = condFbm( p * 1.5 ) * 0.5 + 0.5;
  float fine = condNoise( p * 9.0 + 7.0 ) * 0.5 + 0.5;
  return vec2( smoothstep( 0.28, 0.82, mottle ) * ( 0.4 + 0.6 * fine ), mottle );
}

// Finite-difference step for the rust height field, metres: the scale of a pit.
#define COND_PIT_EPS 0.035
// How hard the pits tilt the normal. Above ~0.03 the relief reads as noise.
#define COND_PIT_DEPTH 0.015

/**
 * DENT DEPTH FIELD, in mesh-local metres, shared by the paint hook and the normal
 * hook so a dent's shading and its dulled paint can never disagree.
 *
 * Six cells per metre puts the value-noise lobes at roughly 17 cm — large enough
 * to read across a door or bumper without turning into broad panel warping. The
 * position-only shear breaks the lattice without a second sample. The damage argument
 * moves the threshold rather than the amplitude, so light damage is a few isolated lobes
 * and full damage lets neighbours meet into crumpled panels.
 *
 * Weighting: lower flanks and the extremities of the shell, because that is where a
 * car collects damage and because a dent blanket over a roof reads as a texture.
 */
float condDent( vec3 localP, float damage ) {
  vec3 p = localP * 6.0;
  p += vec3( p.z * 0.31, p.x * 0.19, p.y * 0.11 );
  float lobes = condNoise( p + 19.0 );
  float core = smoothstep( 0.82 - 0.32 * damage, 0.94 - 0.31 * damage, lobes );
  float lower = 1.0 - smoothstep( 0.35, 1.25, localP.y );
  float extremity = smoothstep( 0.55, 1.55, max( abs( localP.x ), abs( localP.z ) ) );
  return damage * core * ( 0.2 + 0.8 * max( lower, extremity ) );
}

/**
 * Finite-difference step for the dent field, metres, and how deep a full-strength
 * lobe presses in.
 *
 * THE GRADIENT IS ANALYTIC, NOT a screen derivative. Screen-space derivatives of a
 * smooth mask shrink with the pixel footprint, so a dent that tilted the normal
 * convincingly with
 * the camera at the door vanished entirely at chase distance — measured on the
 * shipped chase camera, where a fully damaged car read as undamaged. Three extra taps
 * in mesh space cost the same at every zoom.
 *
 * 14 mm over a 17 cm lobe preserves the existing 8% relief slope while making each
 * impact read a little larger. Twice that slope looked rippled rather than dented.
 */
#define COND_DENT_EPS 0.052
#define COND_DENT_DEPTH 0.014

#include <map_pars_fragment>`;
const PALETTE_PAINT_PARS = `
uniform float uPalettePaint;
uniform vec3 uPalettePaintColor;
uniform vec2 uPalettePaintCell;

#include <map_pars_fragment>`;

/**
 * The Soviet atlas is a 9x2 sheet of flat colour swatches. Only the main body mesh
 * receives this material, and only its authored paint cell is replaced; glass,
 * chrome, lamps, wheels and rally decals keep their original cells.
 */
const CAR_PAINT_MAP = `
#include <map_fragment>
#ifdef USE_MAP
if ( uPalettePaint > 0.5 ) {
  vec2 carPaintCell = floor( vMapUv * vec2( 9.0, 2.0 ) );
  if ( all( equal( carPaintCell, uPalettePaintCell ) ) ) {
    diffuseColor.rgb = uPalettePaintColor;
  }
}
#endif`;

// Injected after the stock roughness/metalness factors are computed but before the
// BRDF consumes them, so we modify the *inputs* (diffuseColor, roughnessFactor,
// metalnessFactor) rather than the material struct the lights code has not built yet.
const CONDITION_BODY = `
#include <metalnessmap_fragment>

{
  vec3 condP = vCondWorldPos;
  vec3 condN = normalize( vCondWorldNormal );
  vec2 condR = condRust( condP );

  // Rust eats into the base colour in mottled patches, kills shine and metalness.
  float rustMask = uRust * condR.x;
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.46, 0.21, 0.09 ), rustMask );
  // Deep pits darken further. Colour alone cannot fake depth, but paired with the
  // relief from the normal hook it is what makes scale look like scale.
  diffuseColor.rgb *= 1.0 - 0.35 * rustMask * ( 1.0 - smoothstep( 0.35, 0.95, condR.y ) );
  roughnessFactor = mix( roughnessFactor, 0.97, rustMask );
  metalnessFactor = mix( metalnessFactor, 0.0, rustMask );

  // Dirt settles on upward faces and pools in the pits of the rust mottle.
  float condUp = saturate( condN.y );
  float condPit = 1.0 - smoothstep( 0.2, 0.9, condR.y );
  float dustMask = uDirt * ( 0.3 + 0.7 * condUp ) * ( 0.45 + 0.55 * condPit );
  float condLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
  vec3 dustColor = mix( vec3( condLum ), vec3( 0.72, 0.66, 0.55 ), 0.5 );
  diffuseColor.rgb = mix( diffuseColor.rgb, dustColor, dustMask * 0.75 );
  roughnessFactor = mix( roughnessFactor, 0.92, dustMask );
}`;

/**
 * Painted shells share the part dust distribution, with lower-flank road spray and
 * dent relief. The dent field stays mesh-local so a moving/floating-origin car does
 * not make collision damage crawl across its paint.
 *
 * The body colour hook evaluates the shared dent field once; the normal hook
 * evaluates it four times (the value plus three finite differences), so the pair
 * costs five base noise samples against the four the old line-based scratch hook
 * spent on one `condNoise` plus a three-sample `condFbm`. The extra sample buys a
 * gradient that does not change with the camera distance, which is what makes the
 * damage visible at all from the chase seat.
 */
const CAR_BODY_CONDITION_BODY = `
#include <metalnessmap_fragment>

{
  vec3 condP = vCondWorldPos;
  vec3 condN = normalize( vCondWorldNormal );
  vec2 condR = condRust( condP );
  float condUp = saturate( condN.y );
  float condPit = 1.0 - smoothstep( 0.2, 0.9, condR.y );
  float condLower = 1.0 - smoothstep( 0.25, 1.15, vCondLocalPos.y );
  float dustMask = uDirt * max(
    ( 0.3 + 0.7 * condUp ) * ( 0.45 + 0.55 * condPit ),
    condLower * ( 0.45 + 0.35 * condPit )
  );
  float condLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
  vec3 dustColor = mix( vec3( condLum ), vec3( 0.72, 0.66, 0.55 ), 0.5 );
  diffuseColor.rgb = mix( diffuseColor.rgb, dustColor, dustMask * 0.75 );
  roughnessFactor = mix( roughnessFactor, 0.92, dustMask );

  float dentMask = condDent( vCondLocalPos, uScratches );
  // Paint response is now almost nothing, and that is the fix for "it looks like
  // camouflage": a mask that tints or dulls reads as a PATTERN on the paint, however
  // weak the tint, because the eye groups patches of colour long before it reads
  // shading. All the damage is carried by the relief in the normal hook; the paint
  // only loses a little gloss where the metal is stretched.
  roughnessFactor = mix( roughnessFactor, 0.86, dentMask * 0.16 );
  // Bare primer only at high damage and only on the sharpest lobes, where folded
  // sheet actually loses its paint. The cap keeps it a hint, not a stripe.
  float dentCrease = smoothstep( 0.7, 1.0, dentMask ) * smoothstep( 0.8, 1.0, uScratches );
  vec3 dentPrimer = condLum > 0.42 ? vec3( 0.18 ) : vec3( 0.58 );
  diffuseColor.rgb = mix( diffuseColor.rgb, dentPrimer, dentCrease * 0.025 );
}`;

/**
 * Rust relief.
 *
 * Injected at the normal stage — before the BRDF consumes the normal — so pitted
 * steel catches the light unevenly instead of reading as a flat brown decal.
 * Tinting alone was the whole reason rust looked painted on rather than eaten in.
 *
 * The height field is the same `condRust` coverage the colour uses, differenced
 * in world space. The gradient is projected onto the surface first, so a height
 * field can only tilt the normal, never flip it through the geometry.
 *
 * Cost is three extra `condRust` evaluations, gated on a uniform: the branch is
 * coherent across a whole draw call, so a pristine part pays nothing for it.
 */
const CONDITION_NORMAL = `
#include <normal_fragment_maps>

if ( uRust > 0.001 ) {
  vec3 condNP = vCondWorldPos;
  float condH = condRust( condNP ).x;
  vec3 condGrad = vec3(
    condRust( condNP + vec3( COND_PIT_EPS, 0.0, 0.0 ) ).x - condH,
    condRust( condNP + vec3( 0.0, COND_PIT_EPS, 0.0 ) ).x - condH,
    condRust( condNP + vec3( 0.0, 0.0, COND_PIT_EPS ) ).x - condH
  ) / COND_PIT_EPS;
  vec3 condWN = normalize( vCondWorldNormal );
  condGrad -= condWN * dot( condGrad, condWN );
  // The normal is in view space by this point, so the world-space gradient has
  // to be rotated into view space before it can perturb it.
  vec3 condVG = ( viewMatrix * vec4( condGrad, 0.0 ) ).xyz;
  normal = normalize( normal - condVG * uRust * COND_PIT_DEPTH );
}`;

/**
 * Rust and dent relief.
 *
 * Both fields perturb the view-space normal before the BRDF, so their dominant cue is
 * a shifted highlight rather than a paint mark. Both gradients are finite differences
 * in the field's own space — world for rust, mesh-local for dents — and both then
 * rotate into view space, because that is the space the normal is in by this point.
 */
const CAR_BODY_NORMAL = `
#include <normal_fragment_maps>

if ( uRust > 0.001 ) {
  vec3 condNP = vCondWorldPos;
  float condH = condRust( condNP ).x;
  vec3 condGrad = vec3(
    condRust( condNP + vec3( COND_PIT_EPS, 0.0, 0.0 ) ).x - condH,
    condRust( condNP + vec3( 0.0, COND_PIT_EPS, 0.0 ) ).x - condH,
    condRust( condNP + vec3( 0.0, 0.0, COND_PIT_EPS ) ).x - condH
  ) / COND_PIT_EPS;
  vec3 condWN = normalize( vCondWorldNormal );
  condGrad -= condWN * dot( condGrad, condWN );
  // The normal is in view space by this point, so the world-space gradient has
  // to be rotated into view space before it can perturb it.
  vec3 condVG = ( viewMatrix * vec4( condGrad, 0.0 ) ).xyz;
  normal = normalize( normal - condVG * uRust * COND_PIT_DEPTH );
}

if ( uScratches > 0.001 ) {
  float dentH = condDent( vCondLocalPos, uScratches );
  vec3 dentGrad = vec3(
    condDent( vCondLocalPos + vec3( COND_DENT_EPS, 0.0, 0.0 ), uScratches ) - dentH,
    condDent( vCondLocalPos + vec3( 0.0, COND_DENT_EPS, 0.0 ), uScratches ) - dentH,
    condDent( vCondLocalPos + vec3( 0.0, 0.0, COND_DENT_EPS ), uScratches ) - dentH
  ) / COND_DENT_EPS;
  // Only the part of the gradient that lies IN the surface tilts a normal; the
  // component along it is the field getting deeper, not the panel sloping.
  vec3 dentLN = normalize( vCondLocalNormal );
  dentGrad -= dentLN * dot( dentGrad, dentLN );
  // Local -> world through the mesh's own axes (see VERTEX_VARYING for why this is
  // not the model matrix), then world -> view, the space this normal is in.
  vec3 dentWG =
    vCondAxisX * dentGrad.x +
    vCondAxisY * dentGrad.y +
    cross( vCondAxisX, vCondAxisY ) * dentGrad.z;
  vec3 dentVG = ( viewMatrix * vec4( dentWG, 0.0 ) ).xyz;
  // PLUS, not minus. The field is a DEPTH: the panel is pressed IN where the mask is
  // high, so the surface falls away along the gradient and the normal leans with it.
  // Subtracting made every dent a blister — convex lobes standing off the bodywork,
  // which is what a plus sign costs you here.
  normal = normalize( normal + dentVG * COND_DENT_DEPTH );
}`;

/**
 * Patches one material's shader, binding its own uniform objects. This runs once per
 * material (when it is first compiled); the program itself is shared because every
 * condition material reports the same customProgramCacheKey.
 */
function patchConditionShader(shader: WebGLProgramParametersWithUniforms, uniforms: ConditionUniforms): void {
  shader.uniforms.uDirt = uniforms.dirt;
  shader.uniforms.uRust = uniforms.rust;
  shader.uniforms.uScratches = uniforms.scratches ?? { value: 0 };

  shader.vertexShader = shader.vertexShader
    .replace('varying vec3 vViewPosition;', VERTEX_VARYING)
    .replace('#include <worldpos_vertex>', WORLD_POS_HOOK);

  shader.fragmentShader = shader.fragmentShader
    .replace('varying vec3 vViewPosition;', VERTEX_VARYING)
    .replace('#include <map_pars_fragment>', CONDITION_PARS)
    .replace('#include <normal_fragment_maps>', CONDITION_NORMAL)
    .replace('#include <metalnessmap_fragment>', CONDITION_BODY);
}

/** Binds the shell-only dent hook without changing any shared source material. */
function patchCarBodyShader(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: CarBodyUniforms,
): void {
  shader.uniforms.uDirt = uniforms.dirt;
  shader.uniforms.uRust = uniforms.rust;
  shader.uniforms.uScratches = uniforms.scratches!;
  shader.uniforms.uPalettePaint = uniforms.palettePaint;
  shader.uniforms.uPalettePaintColor = uniforms.paintColor;
  shader.uniforms.uPalettePaintCell = uniforms.paintCell;

  shader.vertexShader = shader.vertexShader
    .replace('varying vec3 vViewPosition;', VERTEX_VARYING)
    .replace('#include <worldpos_vertex>', WORLD_POS_HOOK);

  shader.fragmentShader = shader.fragmentShader
    .replace('varying vec3 vViewPosition;', VERTEX_VARYING)
    .replace('#include <map_pars_fragment>', CONDITION_PARS)
    .replace('#include <map_fragment>', CAR_PAINT_MAP)
    .replace('#include <normal_fragment_maps>', CAR_BODY_NORMAL)
    .replace('#include <metalnessmap_fragment>', CAR_BODY_CONDITION_BODY);
}
/** Cheap atlas recolouring for static cars; deliberately excludes dynamic wear. */
function patchCarPaletteShader(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: CarBodyUniforms,
): void {
  shader.uniforms.uPalettePaint = uniforms.palettePaint;
  shader.uniforms.uPalettePaintColor = uniforms.paintColor;
  shader.uniforms.uPalettePaintCell = uniforms.paintCell;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <map_pars_fragment>', PALETTE_PAINT_PARS)
    .replace('#include <map_fragment>', CAR_PAINT_MAP);
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * A MeshStandardMaterial that rusts and dirties. Returns a fresh instance every call
 * (so each part can hold independent dirt/rust) but shares one compiled program with
 * every other condition material via a fixed customProgramCacheKey.
 */
export function makeConditionMaterial(
  baseColor: number,
  metalness: number,
  roughness: number,
): THREE.MeshStandardMaterial {
  const key = conditionKey(baseColor, metalness, roughness);
  let template = conditionTemplates.get(key);
  if (template === undefined) {
    template = new THREE.MeshStandardMaterial({ color: baseColor, metalness, roughness });
    conditionTemplates.set(key, template);
  }

  const material = template.clone();
  const uniforms: ConditionUniforms = { dirt: { value: 0 }, rust: { value: 0 } };
  conditionUniforms.set(material, uniforms);
  material.onBeforeCompile = (shader) => patchConditionShader(shader, uniforms);
  material.customProgramCacheKey = () => CONDITION_PROGRAM_KEY;
  return material;
}

/**
 * Plain MeshStandardMaterial for scenery and non-condition surfaces. Shared + cached.
 *
 * Banded like the ground (render/comic.ts), with the ground's contours and stipple
 * turned off: a rock or a pole wants the same hard terminator as the dune behind it,
 * or it reads as a smooth object pasted onto a drawn landscape. The post pass inks
 * its silhouette either way.
 */
export function makeFlatMaterial(color: number, roughness = 0.6): THREE.MeshStandardMaterial {
  const key = flatKey(color, roughness);
  let material = flatCache.get(key);
  if (material === undefined) {
    material = applyComicShading(
      new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }),

      { contourStrength: 0, stippleStrength: 0 },
    );
    flatCache.set(key, material);
  }
  return material;
}
/**
 * FBXLoader still produces MeshPhongMaterial for the Soviet pack. The body shaders
 * patch MeshStandardMaterial chunks, so merely cloning that legacy material leaves
 * both palette paint and body wear inert. Convert only the selected paint slot;
 * glass, lamps and trim keep their authored materials.
 */
function cloneCarPaintMaterial(source: THREE.Material): THREE.Material {
  if (source instanceof THREE.MeshStandardMaterial) return source.clone();
  if (!(source instanceof THREE.MeshPhongMaterial)) return source.clone();

  const material = new THREE.MeshStandardMaterial({
    color: source.color,
    map: source.map,
    emissive: source.emissive,
    emissiveMap: source.emissiveMap,
    normalMap: source.normalMap,
    normalScale: source.normalScale,
    aoMap: source.aoMap,
    aoMapIntensity: source.aoMapIntensity,
    alphaMap: source.alphaMap,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
    vertexColors: source.vertexColors,
    roughness: 0.62,
    metalness: 0.18,
  });
  material.name = source.name;
  material.depthTest = source.depthTest;
  material.depthWrite = source.depthWrite;
  material.colorWrite = source.colorWrite;
  material.blending = source.blending;
  material.blendSrc = source.blendSrc;
  material.blendDst = source.blendDst;
  material.blendEquation = source.blendEquation;
  return material;
}

/**
 * Clones one eligible paint slot for a car instance and gives it independent body
 * condition uniforms. The source remains untouched for every other car sharing it.
 */
export function makeCarBodyConditionMaterial(source: THREE.Material): THREE.Material {
  const material = cloneCarPaintMaterial(source);
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;

  const uniforms: CarBodyUniforms = {
    dirt: { value: 0 },
    rust: { value: 0 },
    scratches: { value: 0 },
    palettePaint: { value: 0 },
    paintColor: { value: new THREE.Color() },
    paintCell: { value: new THREE.Vector2() },
  };
  carBodyUniforms.set(material, uniforms);
  material.onBeforeCompile = (shader) => patchCarBodyShader(shader, uniforms);
  material.customProgramCacheKey = () => CAR_BODY_PROGRAM_KEY;
  return material;
}
/**
 * Clones a static Soviet paint slot with only its atlas-colour replacement. Static
 * scenery never accumulates wear, so running the body dirt/dent noise on every
 * parked car wastes fragment work and can force the fixed-step loop into slow motion.
 */
export function makeCarPalettePaintMaterial(source: THREE.Material): THREE.Material {
  const material = cloneCarPaintMaterial(source);
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;

  const uniforms: CarBodyUniforms = {
    dirt: { value: 0 },
    rust: { value: 0 },
    scratches: { value: 0 },
    palettePaint: { value: 0 },
    paintColor: { value: new THREE.Color() },
    paintCell: { value: new THREE.Vector2() },
  };
  carBodyUniforms.set(material, uniforms);
  material.onBeforeCompile = (shader) => patchCarPaletteShader(shader, uniforms);
  material.customProgramCacheKey = () => CAR_PALETTE_PROGRAM_KEY;
  return material;
}


/** Selects one Soviet atlas paint cell and its per-car replacement colour. */
export function setCarBodyPalettePaint(
  material: THREE.Material,
  color: THREE.Color,
  cell: readonly [number, number],
): void {
  const uniforms = carBodyUniforms.get(material);
  if (uniforms === undefined) return;
  uniforms.palettePaint.value = 1;
  uniforms.paintColor.value.copy(color);
  uniforms.paintCell.value.set(cell[0], cell[1]);
}

/**
 * Writes cosmetic shell condition for one car. Only paint materials made by
 * makeCarBodyConditionMaterial are in the weak map, so trim in the same subtree is
 * skipped without relying on names or material colours.
 */
export function setCarBodyCondition(
  carRoot: THREE.Object3D,
  dirt: number,
  scratches: number,
): void {
  carRoot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(material)) {
      for (const m of material) writeCarBodyCondition(m, dirt, scratches);
    } else {
      writeCarBodyCondition(material, dirt, scratches);
    }
  });
}

function writeCarBodyCondition(material: THREE.Material, dirt: number, scratches: number): void {
  const uniforms = carBodyUniforms.get(material);
  if (uniforms === undefined) return;
  uniforms.dirt.value = dirt;
  uniforms.scratches!.value = scratches;
}

/** Applies cosmetic wear, with irreversible engine destruction forced visibly burnt. */
export function setPartCondition(
  root: THREE.Object3D,
  part: { readonly dirt: number; readonly rust: number; readonly destroyed?: boolean },
): void {
  setCondition(
    root,
    part.destroyed ? 1 : part.dirt,
    part.destroyed ? 0.82 : part.rust,
  );
}

/**
 * Writes dirt/rust onto every condition material in a subtree. Uniform writes only —
 * no shader rebuild — so it is safe to call every tick while the player scrubs a part.
 */
export function setCondition(root: THREE.Object3D, dirt: number, rust: number): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(material)) {
      for (const m of material) writeCondition(m, dirt, rust);
    } else {
      writeCondition(material, dirt, rust);
    }
  });
}

function writeCondition(material: THREE.Material, dirt: number, rust: number): void {
  const uniforms = conditionUniforms.get(material);
  if (uniforms === undefined) return;
  uniforms.dirt.value = dirt;
  uniforms.rust.value = rust;
}

/** Releases the cached template and flat materials. Call on teardown. */
export function disposeMaterialCache(): void {
  for (const material of conditionTemplates.values()) material.dispose();
  for (const material of flatCache.values()) material.dispose();
  conditionTemplates.clear();
  flatCache.clear();
}
