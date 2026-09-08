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
import { MATERIALS_CONFIG } from '../config';
import { applyComicShading } from './comic';

/** Per-instance uniforms for condition-shaded materials. */
interface ConditionUniforms {
  readonly dirt: { value: number };
  readonly rust: { value: number };
  /**
   * Offset of the wear noise within the body's own frame, metres. Sampling the
   * field in body space is what nails rust and dirt to the panels; this offset is
   * what stops two cars of the same model from wearing in identical places, which
   * the old world-space sampling got for free.
   */
  readonly fieldOrigin: { value: THREE.Vector3 };
}

interface CarPaletteUniforms extends ConditionUniforms {
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
const carBodyUniforms = new WeakMap<THREE.Material, CarPaletteUniforms>();
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
const CONDITION_PROGRAM_KEY = 'condition-rust-dirt-v2';

/**
 * Driven-car paint keeps independent dirt and palette uniforms without the removed
 * localized dent program.
 */
const CAR_BODY_PROGRAM_KEY = 'condition-rust-dirt-body-v11';
/** Static Soviet cars need atlas recolouring, but no dynamic wear calculations. */
const CAR_PALETTE_PROGRAM_KEY = 'car-palette-paint-v1';

// ---------------------------------------------------------------------------
// GLSL patch
// ---------------------------------------------------------------------------

/**
 * The rust/dirt shader is written once and shared by every condition material. The
 * mottling comes from a 3D hash/value noise — no textures — sampled in the shaded
 * object's own frame, so wear remains attached while a car or part moves.
 */
const VERTEX_VARYING =
  'uniform vec3 uCondFieldOrigin;\n' +
  'varying vec3 vViewPosition;\n' +
  'varying vec3 vCondWorldNormal;\n' +
  // Body-frame metres, already carrying the per-instance offset.
  'varying vec3 vCondBodyPos;\n' +
  'varying mat3 vCondBodyBasis;';

// Parts are placed with rotation + uniform scale only, so mat3(modelMatrix) is an
// exact world transform for the normal (no inverse-transpose required), and its
// column lengths are the model-units-to-metres conversion.
const WORLD_POS_HOOK =
  '#include <worldpos_vertex>\n' +
  '\tvCondWorldNormal = mat3( modelMatrix ) * objectNormal;\n' +
  '\tvec3 condAxX = mat3( modelMatrix ) * vec3( 1.0, 0.0, 0.0 );\n' +
  '\tvec3 condAxY = mat3( modelMatrix ) * vec3( 0.0, 1.0, 0.0 );\n' +
  '\tvec3 condAxZ = mat3( modelMatrix ) * vec3( 0.0, 0.0, 1.0 );\n' +
  '\tvec3 condScale = max( vec3( length( condAxX ), length( condAxY ), length( condAxZ ) ), vec3( 1e-6 ) );\n' +
  '\tvCondBodyPos = transformed * condScale + uCondFieldOrigin;\n' +
  '\tvCondBodyBasis = mat3( condAxX / condScale.x, condAxY / condScale.y, condAxZ / condScale.z );';

const CONDITION_PARS = `
uniform float uDirt;
uniform float uRust;
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
  vec3 condP = vCondBodyPos;
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
  vec3 condNP = vCondBodyPos;
  float condH = condRust( condNP ).x;
  vec3 condGrad = vec3(
    condRust( condNP + vec3( COND_PIT_EPS, 0.0, 0.0 ) ).x - condH,
    condRust( condNP + vec3( 0.0, COND_PIT_EPS, 0.0 ) ).x - condH,
    condRust( condNP + vec3( 0.0, 0.0, COND_PIT_EPS ) ).x - condH
  ) / COND_PIT_EPS;
  // The field is sampled in the body's frame, so its gradient is too: rotate it
  // into world space before it meets the world normal.
  condGrad = vCondBodyBasis * condGrad;
  vec3 condWN = normalize( vCondWorldNormal );
  condGrad -= condWN * dot( condGrad, condWN );
  // The normal is in view space by this point, so the world-space gradient has
  // to be rotated into view space before it can perturb it.
  vec3 condVG = ( viewMatrix * vec4( condGrad, 0.0 ) ).xyz;
  normal = normalize( normal - condVG * uRust * COND_PIT_DEPTH );
}`;


/**
 * Patches one material's shader, binding its own uniform objects. This runs once per
 * material (when it is first compiled); the program itself is shared because every
 * condition material reports the same customProgramCacheKey.
 */
function patchConditionShader(shader: WebGLProgramParametersWithUniforms, uniforms: ConditionUniforms): void {
  shader.uniforms.uDirt = uniforms.dirt;
  shader.uniforms.uRust = uniforms.rust;
  shader.uniforms.uCondFieldOrigin = uniforms.fieldOrigin;

  shader.vertexShader = shader.vertexShader
    .replace('varying vec3 vViewPosition;', VERTEX_VARYING)
    .replace('#include <worldpos_vertex>', WORLD_POS_HOOK);

  shader.fragmentShader = shader.fragmentShader
    .replace('varying vec3 vViewPosition;', VERTEX_VARYING)
    .replace('#include <map_pars_fragment>', CONDITION_PARS)
    .replace('#include <normal_fragment_maps>', CONDITION_NORMAL)
    .replace('#include <metalnessmap_fragment>', CONDITION_BODY);
}

/** Binds driven-car dirt and palette paint without localized collision shading. */
function patchCarBodyShader(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: CarPaletteUniforms,
): void {
  shader.uniforms.uDirt = uniforms.dirt;
  shader.uniforms.uRust = uniforms.rust;
  shader.uniforms.uPalettePaint = uniforms.palettePaint;
  shader.uniforms.uPalettePaintColor = uniforms.paintColor;
  shader.uniforms.uPalettePaintCell = uniforms.paintCell;
  shader.uniforms.uCondFieldOrigin = uniforms.fieldOrigin;

  shader.vertexShader = shader.vertexShader
    .replace('varying vec3 vViewPosition;', VERTEX_VARYING)
    .replace('#include <worldpos_vertex>', WORLD_POS_HOOK);

  shader.fragmentShader = shader.fragmentShader
    .replace('varying vec3 vViewPosition;', VERTEX_VARYING)
    .replace('#include <map_pars_fragment>', CONDITION_PARS)
    .replace('#include <map_fragment>', CAR_PAINT_MAP)
    .replace('#include <normal_fragment_maps>', CONDITION_NORMAL)
    .replace('#include <metalnessmap_fragment>', CONDITION_BODY);
}
/** Cheap atlas recolouring for static cars; deliberately excludes dynamic wear. */
function patchCarPaletteShader(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: CarPaletteUniforms,
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
 * Spreads instances across the noise field. Irrational steps keep successive seeds
 * far apart on all three axes rather than walking a line through the same mottle.
 */
function wearFieldOrigin(seed: number): THREE.Vector3 {
  return new THREE.Vector3(
    ((seed * 0.7548776662) % 1) * 512,
    ((seed * 0.5698402909) % 1) * 512,
    ((seed * 0.8191725134) % 1) * 512,
  );
}

/** Parts carry no id here, so their patterns are spread by creation order. */
let wearFieldSerial = 0;

/**
 * Places one material's wear pattern within the body-space noise field. Cars pass a
 * hash of their id, so a saved car rusts in the same places every time it loads.
 */
export function setConditionFieldOrigin(material: THREE.Material, seed: number): void {
  const uniforms = carBodyUniforms.get(material) ?? conditionUniforms.get(material);
  if (uniforms === undefined) return;
  uniforms.fieldOrigin.value.copy(wearFieldOrigin(seed));
}


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
  const uniforms: ConditionUniforms = {
    dirt: { value: 0 },
    rust: { value: 0 },
    fieldOrigin: { value: wearFieldOrigin(++wearFieldSerial) },
  };
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
// Aged single-stage paint is still a dielectric with a readable sky reflection.
// The former 0.72/0.12 pair made every lee-facing panel absorb both diffuse and
// reflected light, so cars collapsed toward black even under a high desert Sun.
const CAR_PAINT_ROUGHNESS = MATERIALS_CONFIG.paintRoughness;
const CAR_PAINT_METALNESS = MATERIALS_CONFIG.paintMetalness;

/**
 * Clones an authored paint slot with one shared automotive finish.
 * Both model packs now differ only in their colour/texture, not in their BRDF.
 */
export function makeCarPaintFinishMaterial(source: THREE.Material): THREE.Material {
  if (source instanceof THREE.MeshStandardMaterial) {
    const material = source.clone();
    material.roughness = CAR_PAINT_ROUGHNESS;
    material.metalness = CAR_PAINT_METALNESS;
    material.roughnessMap = null;
    material.metalnessMap = null;
    material.envMapIntensity = 1;
    return material;
  }
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
    roughness: CAR_PAINT_ROUGHNESS,
    metalness: CAR_PAINT_METALNESS,
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
  const material = makeCarPaintFinishMaterial(source);
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;

  const uniforms: CarPaletteUniforms = {
    dirt: { value: 0 },
    rust: { value: 0 },
    fieldOrigin: { value: wearFieldOrigin(++wearFieldSerial) },
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
 * scenery never accumulates wear, so running body dirt noise on every parked car
 * wastes fragment work.
 */
export function makeCarPalettePaintMaterial(source: THREE.Material): THREE.Material {
  const material = makeCarPaintFinishMaterial(source);
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;

  const uniforms: CarPaletteUniforms = {
    dirt: { value: 0 },
    rust: { value: 0 },
    // Static bodies never wear, but the field origin is part of the shared shape.
    fieldOrigin: { value: new THREE.Vector3() },
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

/** Writes cosmetic shell dirt for one car; collisions no longer alter its shader. */
export function setCarBodyCondition(carRoot: THREE.Object3D, dirt: number): void {
  carRoot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(material)) {
      for (const m of material) writeCarBodyCondition(m, dirt);
    } else {
      writeCarBodyCondition(material, dirt);
    }
  });
}

function writeCarBodyCondition(material: THREE.Material, dirt: number): void {
  const uniforms = carBodyUniforms.get(material);
  if (uniforms === undefined) return;
  uniforms.dirt.value = dirt;
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
