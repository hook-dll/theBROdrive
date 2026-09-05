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
import {
  MAX_BODY_DAMAGE_IMPACTS,
  type BodyDamageImpact,
  type BodyDamageType,
} from '../game/state';

/** Per-instance uniforms for condition-shaded materials. */
interface ConditionUniforms {
  readonly dirt: { value: number };
  readonly rust: { value: number };
  readonly scratches?: { value: number };
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

interface CarBodyUniforms extends CarPaletteUniforms {
  readonly damageCount: { value: number };
  readonly damagePosRadius: { value: THREE.Vector4[] };
  readonly damageNormalStrength: { value: THREE.Vector4[] };
  readonly damageMeta: { value: THREE.Vector4[] };
}

function hasDamageUniforms(uniforms: CarPaletteUniforms): uniforms is CarBodyUniforms {
  return 'damageCount' in uniforms;
}

/**
 * Eager per-instance uniform objects. Kept OUT of material.userData because
 * Material.copy() JSON-round-trips userData, which would sever the references the
 * compiled program is holding. A WeakMap keeps the objects alive for exactly as long
 * as the material, and lets setCondition write values even before first render.
 */
const carBodyUniforms = new WeakMap<THREE.Material, CarPaletteUniforms>();
const conditionUniforms = new WeakMap<THREE.Material, ConditionUniforms>();

const DAMAGE_TYPE_CODE: Readonly<Record<BodyDamageType, number>> = {
  dent: 0,
  scratch: 1,
  chip: 2,
  heavy: 3,
};
const damagePositionScratch = Array.from(
  { length: MAX_BODY_DAMAGE_IMPACTS },
  () => new THREE.Vector4(),
);
const damageNormalScratch = Array.from(
  { length: MAX_BODY_DAMAGE_IMPACTS },
  () => new THREE.Vector4(),
);
const damageMetaScratch = Array.from(
  { length: MAX_BODY_DAMAGE_IMPACTS },
  () => new THREE.Vector4(),
);
const damageVectorScratch = new THREE.Vector3();

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
 * Body paint layers a bounded set of localized dents, scratches and chips in one
 * shader permutation. Bump this whenever its GLSL layout changes.
 */
const CAR_BODY_PROGRAM_KEY = 'condition-rust-dirt-body-v9';
/** Static Soviet cars need atlas recolouring, but no dynamic wear calculations. */
const CAR_PALETTE_PROGRAM_KEY = 'car-palette-paint-v1';

// ---------------------------------------------------------------------------
// GLSL patch
// ---------------------------------------------------------------------------

/**
 * The rust/dirt shader is written once and shared by every condition material. The
 * mottling comes from a 3D hash/value noise — no textures — sampled in the SHADED
 * OBJECT'S OWN frame, so a patch of rust belongs to the panel it sits on.
 *
 * Sampling it in world space, as this did, meant the field stood still in the world
 * while the car drove through it: dirt and rust crawled across the shell, and the
 * shading around a dent slid off the dent whenever the body rocked.
 *
 * Impact records stay world-space (they are rebuilt from the car's live pose every
 * frame), so the world position and normal are still needed alongside the body-frame
 * position. `vCondBodyBasis` rotates a body-frame gradient back into world space for
 * the normal hooks.
 */
const VERTEX_VARYING =
  'uniform vec3 uCondFieldOrigin;\n' +
  'varying vec3 vViewPosition;\n' +
  'varying vec3 vCondWorldPos;\n' +
  'varying vec3 vCondWorldNormal;\n' +
  // Body-frame metres, already carrying the per-instance offset.
  'varying vec3 vCondBodyPos;\n' +
  'varying mat3 vCondBodyBasis;';

// Parts are placed with rotation + uniform scale only, so mat3(modelMatrix) is an
// exact world transform for the normal (no inverse-transpose required), and its
// column lengths are the model-units-to-metres conversion.
const WORLD_POS_HOOK =
  '#include <worldpos_vertex>\n' +
  '\tvCondWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n' +
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
uniform float uScratches;
uniform float uPalettePaint;
uniform vec3 uPalettePaintColor;
uniform vec2 uPalettePaintCell;
uniform int uDamageCount;
uniform vec4 uDamagePosRadius[${MAX_BODY_DAMAGE_IMPACTS}];
uniform vec4 uDamageNormalStrength[${MAX_BODY_DAMAGE_IMPACTS}];
uniform vec4 uDamageMeta[${MAX_BODY_DAMAGE_IMPACTS}];



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
 * LOCALIZED IMPACT FIELD.
 *
 * Each record is a real collision point and direction transformed into world space
 * by setCarBodyCondition. The fixed loop is the real-time budget: eight marks,
 * two evaluations per painted fragment (material + normal), and one value-noise
 * lookup per mark. Four seed bands alter aspect, rotation and mask breakup, giving
 * the reference's 3–5 variations without texture fetches or shader permutations.
 *
 * x/y/z/w of masks are dent centre, bright folded rim, scratch and exposed-paint
 * chip. heavyMask adds localized grime/cracking only to severe impacts.
 * dentGradient is analytic radial/scratch relief in world units; noise breaks the
 * silhouette but is deliberately omitted from the gradient so it cannot turn a
 * low-poly panel into sparkling normal noise.
 */
void condDamage(
  vec3 worldP,
  vec3 worldN,
  out vec4 masks,
  out float heavyMask,
  out vec3 dentGradient
) {
  masks = vec4( 0.0 );
  heavyMask = 0.0;
  dentGradient = vec3( 0.0 );

  for ( int i = 0; i < ${MAX_BODY_DAMAGE_IMPACTS}; i ++ ) {
    if ( i >= uDamageCount ) break;
    vec3 centre = uDamagePosRadius[i].xyz;
    float radius = max( 0.05, uDamagePosRadius[i].w ) * 1.15;
    vec3 hitNormal = normalize( uDamageNormalStrength[i].xyz );
    float strength = saturate( uDamageNormalStrength[i].w );
    float type = uDamageMeta[i].x;
    float seed = uDamageMeta[i].y;

    vec3 delta = worldP - centre;
    float normalDistance = dot( delta, hitNormal );
    vec3 tangentDelta = delta - hitNormal * normalDistance;
    vec3 referenceAxis =
      abs( hitNormal.y ) < 0.85 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
    vec3 tangentX = normalize( cross( referenceAxis, hitNormal ) );
    vec3 tangentY = normalize( cross( hitNormal, tangentX ) );
    float u = dot( tangentDelta, tangentX );
    float v = dot( tangentDelta, tangentY );

    float angle = seed * 6.2831853 + type * 0.47;
    float ca = cos( angle );
    float sa = sin( angle );
    float ru = ca * u - sa * v;
    float rv = sa * u + ca * v;
    float variation = floor( seed * 4.0 );
    float aspect = mix( 0.78, 1.28, mod( variation, 2.0 ) );
    vec2 shaped = vec2( ru * aspect, rv / aspect );
    float breakup = condNoise(
      vec3( shaped / radius * 2.4, seed * 31.0 + float( i ) * 7.0 )
    );
    float radial = length( shaped ) / radius * mix( 0.86, 1.14, breakup );
    // A collision folds the bordering panel too: allow the bonnet/wing tangent to
    // a frontal blow, but reject the opposite side of the shell.
    float panel = ( 1.0 - smoothstep( radius * 0.25, radius * 0.82, abs( normalDistance ) ) )
      * smoothstep( -0.35, 0.35, dot( normalize( worldN ), hitNormal ) );
    float envelope = ( 1.0 - smoothstep( 0.80, 1.05, radial ) ) * panel;

    float isDent = 1.0 - step( 0.25, abs( type - 0.0 ) );
    float isScratch = 1.0 - step( 0.25, abs( type - 1.0 ) );
    float isChip = 1.0 - step( 0.25, abs( type - 2.0 ) );
    float isHeavy = 1.0 - step( 0.25, abs( type - 3.0 ) );

    // Every impact combines damage kinds; the enum controls their balance rather
    // than selecting one sterile decal.
    float dentWeight = 0.22 * isScratch + 0.38 * isChip + isDent + isHeavy;
    float core = ( 1.0 - smoothstep( 0.06, 0.72, radial ) ) * envelope;
    float rim = smoothstep( 0.34, 0.56, radial )
      * ( 1.0 - smoothstep( 0.72, 0.96, radial ) ) * panel;

    float wave = sin( ru / radius * 11.0 + seed * 19.0 ) * radius * 0.028;
    float scratchLength = 1.0 - smoothstep( 0.55, 1.05, abs( ru ) / ( radius * 1.35 ) );
    float scratchLine = ( 1.0 - smoothstep(
      radius * 0.012,
      radius * mix( 0.035, 0.058, mod( variation, 2.0 ) ),
      abs( rv - wave )
    ) ) * scratchLength * panel;
    float secondScratch = ( 1.0 - smoothstep(
      radius * 0.014,
      radius * 0.045,
      abs( rv + radius * 0.16 + wave * 0.7 )
    ) ) * scratchLength * panel * isHeavy;
    float scratch = max( scratchLine, secondScratch )
      * ( isScratch + 0.28 * isChip + 0.18 * isDent + isHeavy );

    float chipNoise = condNoise(
      vec3( shaped / radius * 7.0 + vec2( seed * 5.0 ), seed * 53.0 )
    );
    float chip = ( 1.0 - smoothstep( 0.08, 0.76, radial ) )
      * smoothstep( 0.48, 0.72, chipNoise ) * panel
      * ( 0.18 * isScratch + isChip + 0.42 * isDent + isHeavy );
    // Heavy impacts split paint along several irregular radial crack paths.
    float crackAngle = atan( rv, ru );
    float crackWave = abs( sin( crackAngle * 3.0 + seed * 23.0 + radial * 2.1 ) );
    float crack = ( 1.0 - smoothstep( 0.025, 0.16, crackWave ) )
      * smoothstep( 0.18, 0.34, radial )
      * ( 1.0 - smoothstep( 0.72, 0.98, radial ) )
      * panel * isHeavy;
    scratch = max( scratch, crack );

    float weightedStrength = strength * strength * ( 3.0 - 2.0 * strength );
    core *= dentWeight * weightedStrength;
    rim *= dentWeight * weightedStrength;
    scratch *= weightedStrength;
    chip *= weightedStrength;
    masks = max( masks, vec4( core, rim, scratch, chip ) );
    heavyMask = max( heavyMask, envelope * isHeavy * weightedStrength );

    float tangentLength = length( tangentDelta );
    vec3 radialDirection = tangentDelta / max( tangentLength, 1e-4 );
    float flank = smoothstep( 0.16, 0.42, radial )
      * ( 1.0 - smoothstep( 0.72, 0.98, radial ) );
    dentGradient -= radialDirection * flank * dentWeight * weightedStrength / radius;
    vec3 scratchAcross = -sa * tangentX + ca * tangentY;
    dentGradient += scratchAcross * sign( rv - wave ) * scratch * 0.8 / radius;
  }
}
/** Full-strength panel depression in metres. */
#define COND_DENT_DEPTH ${MATERIALS_CONFIG.dentNormalDepth}

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
  roughnessFactor = mix( roughnessFactor, ${MATERIALS_CONFIG.rustRoughness}, rustMask );
  metalnessFactor = mix( metalnessFactor, ${MATERIALS_CONFIG.rustMetalness}, rustMask );

  // Dirt settles on upward faces and pools in the pits of the rust mottle.
  float condUp = saturate( condN.y );
  float condPit = 1.0 - smoothstep( 0.2, 0.9, condR.y );
  float dustMask = uDirt * ( 0.3 + 0.7 * condUp ) * ( 0.45 + 0.55 * condPit );
  float condLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
  vec3 dustColor = mix( vec3( condLum ), vec3( 0.72, 0.66, 0.55 ), 0.5 );
  diffuseColor.rgb = mix( diffuseColor.rgb, dustColor, dustMask * 0.75 );
  roughnessFactor = mix( roughnessFactor, ${MATERIALS_CONFIG.dirtRoughness}, dustMask );
}`;

/**
 * Painted shells keep road dirt and then layer damage at the exact impact points.
 * Colour, roughness, metalness and normal relief consume the same masks: no detached
 * camouflage patch can appear where the panel itself is still flat.
 */
const CAR_BODY_CONDITION_BODY = `
#include <metalnessmap_fragment>

{
  vec3 condP = vCondBodyPos;
  vec3 condN = normalize( vCondWorldNormal );
  vec2 condR = condRust( condP );
  float condUp = saturate( condN.y );
  float condPit = 1.0 - smoothstep( 0.2, 0.9, condR.y );
  vec3 condMetreP = vCondBodyPos - uCondFieldOrigin;
  float condLower = 1.0 - smoothstep( 0.25, 1.15, condMetreP.y );
  float dustMask = uDirt * max(
    ( 0.3 + 0.7 * condUp ) * ( 0.45 + 0.55 * condPit ),
    condLower * ( 0.45 + 0.35 * condPit )
  );
  float condLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
  vec3 dustColor = mix( vec3( condLum ), vec3( 0.72, 0.66, 0.55 ), 0.5 );
  diffuseColor.rgb = mix( diffuseColor.rgb, dustColor, dustMask * 0.75 );
  roughnessFactor = mix( roughnessFactor, ${MATERIALS_CONFIG.dirtRoughness}, dustMask );

  if ( uDamageCount > 0 ) {
    vec4 damageMasks;
    float heavyMask;
    vec3 unusedGradient;
    condDamage( vCondWorldPos, condN, damageMasks, heavyMask, unusedGradient );
    float damagePaintSurface = 1.0;
    #ifdef USE_MAP
      if ( uPalettePaint > 0.5 ) {
        vec2 damageCell = floor( vMapUv * vec2( 9.0, 2.0 ) );
        damagePaintSurface = all( equal( damageCell, uPalettePaintCell ) ) ? 1.0 : 0.0;
      }
    #endif
    damageMasks *= damagePaintSurface;
    heavyMask *= damagePaintSurface;
    float dentCore = damageMasks.x;
    float dentRim = damageMasks.y;
    float scratchMask = damageMasks.z;
    float chipMask = damageMasks.w;

    // A dent reads as a dark pressed centre and a narrow light folded rim even
    // under flat light; the normal hook moves the real specular highlight.
    diffuseColor.rgb *= 1.0 - 0.68 * dentCore * dentCore;
    diffuseColor.rgb = mix(
      diffuseColor.rgb,
      min( vec3( 1.0 ), diffuseColor.rgb * 1.75 + vec3( 0.09 ) ),
      dentRim * 0.88
    );
    roughnessFactor = mix(
      roughnessFactor,
      ${MATERIALS_CONFIG.dentRoughness},
      max( dentCore, dentRim ) * ${MATERIALS_CONFIG.dentRoughnessStrength}
    );

    // A crushed panel is not a mirror. Paint over a dent is stretched and its clear
    // coat crazed, so the reflection goes with the shine: without this the pressed
    // centre kept the coachwork's full metalness and read as a bright smear moving
    // with the camera rather than as a hole in the panel. The folded rim keeps more
    // of it, which is what still catches the sun along the crease. Bare steel below
    // puts metalness back where the paint has actually gone.
    metalnessFactor = mix(
      metalnessFactor,
      ${MATERIALS_CONFIG.dentCoreMetalness},
      dentCore * ${MATERIALS_CONFIG.dentCoreMetalnessStrength}
    );
    metalnessFactor = mix(
      metalnessFactor,
      ${MATERIALS_CONFIG.dentRimMetalness},
      dentRim * ${MATERIALS_CONFIG.dentRimMetalnessStrength}
    );

    // Thin scratches and broken chip islands remove paint to dull bare steel.
    // Metalness changes with colour and roughness; gray albedo alone is paint.
    float exposedMetal = max(
      max( chipMask, scratchMask * 0.86 ),
      smoothstep( 0.58, 0.92, dentCore ) * 0.62
    );
    vec3 bareSteel = vec3( 0.24, 0.255, 0.27 );
    diffuseColor.rgb = mix( diffuseColor.rgb, bareSteel, exposedMetal * 0.92 );
    roughnessFactor = mix(
      roughnessFactor,
      ${MATERIALS_CONFIG.exposedMetalRoughness},
      exposedMetal * ${MATERIALS_CONFIG.exposedMetalRoughnessStrength}
    );
    metalnessFactor = mix(
      metalnessFactor,
      ${MATERIALS_CONFIG.exposedMetalness},
      exposedMetal * ${MATERIALS_CONFIG.exposedMetalnessStrength}
    );

    // Heavy strikes hold dirt in the crushed pocket and crack paths. It remains
    // local to that strike instead of becoming a full-body brown filter.
    vec3 impactGrime = vec3( 0.16, 0.12, 0.085 );
    diffuseColor.rgb = mix( diffuseColor.rgb, impactGrime, heavyMask * 0.4 );
    roughnessFactor = mix( roughnessFactor, 0.96, heavyMask * 0.45 );
  }
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
 * Rust and localized impact relief. Both perturb the view-space normal before the
 * BRDF. Impact gradients are analytic in world metres, so dents keep the same depth
 * from bonnet-close inspection to the chase camera without four extra field taps.
 */
const CAR_BODY_NORMAL = `
#include <normal_fragment_maps>

if ( uRust > 0.001 ) {
  vec3 condNP = vCondBodyPos;
  float condH = condRust( condNP ).x;
  vec3 condGrad = vec3(
    condRust( condNP + vec3( COND_PIT_EPS, 0.0, 0.0 ) ).x - condH,
    condRust( condNP + vec3( 0.0, COND_PIT_EPS, 0.0 ) ).x - condH,
    condRust( condNP + vec3( 0.0, 0.0, COND_PIT_EPS ) ).x - condH
  ) / COND_PIT_EPS;
  condGrad = vCondBodyBasis * condGrad;
  vec3 condWN = normalize( vCondWorldNormal );
  condGrad -= condWN * dot( condGrad, condWN );
  vec3 condVG = ( viewMatrix * vec4( condGrad, 0.0 ) ).xyz;
  normal = normalize( normal - condVG * uRust * COND_PIT_DEPTH );
}

if ( uDamageCount > 0 ) {
  vec4 damageMasks;
  float heavyMask;
  vec3 damageGradient;
  vec3 condWN = normalize( vCondWorldNormal );
  condDamage( vCondWorldPos, condWN, damageMasks, heavyMask, damageGradient );
  float damagePaintSurface = 1.0;
  #ifdef USE_MAP
    if ( uPalettePaint > 0.5 ) {
      vec2 damageCell = floor( vMapUv * vec2( 9.0, 2.0 ) );
      damagePaintSurface = all( equal( damageCell, uPalettePaintCell ) ) ? 1.0 : 0.0;
    }
  #endif
  damageGradient *= damagePaintSurface;
  damageGradient -= condWN * dot( damageGradient, condWN );
  vec3 damageVG = ( viewMatrix * vec4( damageGradient, 0.0 ) ).xyz;
  // Positive gradient means depth increases into the panel; adding it makes the
  // flanks lean inward. The scratch contribution adds a much finer raised edge.
  normal = normalize( normal + damageVG * COND_DENT_DEPTH );
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
  shader.uniforms.uDamageCount = uniforms.damageCount;
  shader.uniforms.uDamagePosRadius = uniforms.damagePosRadius;
  shader.uniforms.uDamageNormalStrength = uniforms.damageNormalStrength;
  shader.uniforms.uDamageMeta = uniforms.damageMeta;
  shader.uniforms.uCondFieldOrigin = uniforms.fieldOrigin;

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
const CAR_PAINT_ROUGHNESS = MATERIALS_CONFIG.paintRoughness;
const CAR_PAINT_METALNESS = MATERIALS_CONFIG.paintMetalness;

/**
 * Clones an authored paint slot with one shared metallic automotive finish.
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

  const uniforms: CarBodyUniforms = {
    dirt: { value: 0 },
    rust: { value: 0 },
    scratches: { value: 0 },
    fieldOrigin: { value: wearFieldOrigin(++wearFieldSerial) },
    palettePaint: { value: 0 },
    paintColor: { value: new THREE.Color() },
    paintCell: { value: new THREE.Vector2() },
    damageCount: { value: 0 },
    damagePosRadius: {
      value: Array.from({ length: MAX_BODY_DAMAGE_IMPACTS }, () => new THREE.Vector4()),
    },
    damageNormalStrength: {
      value: Array.from({ length: MAX_BODY_DAMAGE_IMPACTS }, () => new THREE.Vector4()),
    },
    damageMeta: {
      value: Array.from({ length: MAX_BODY_DAMAGE_IMPACTS }, () => new THREE.Vector4()),
    },
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
  const material = makeCarPaintFinishMaterial(source);
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;

  const uniforms: CarPaletteUniforms = {
    dirt: { value: 0 },
    rust: { value: 0 },
    scratches: { value: 0 },
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

/**
 * Writes cosmetic shell condition for one car. Only paint materials made by
 * makeCarBodyConditionMaterial are in the weak map, so trim in the same subtree is
 * skipped without relying on names or material colours.
 */
export function setCarBodyCondition(
  carRoot: THREE.Object3D,
  dirt: number,
  scratches: number,
  damage: readonly BodyDamageImpact[] = [],
): void {
  const count = Math.min(damage.length, MAX_BODY_DAMAGE_IMPACTS);
  const first = damage.length - count;
  for (let i = 0; i < count; i++) {
    const impact = damage[first + i]!;
    damageVectorScratch
      .set(impact.x, impact.y, impact.z)
      .applyQuaternion(carRoot.quaternion)
      .add(carRoot.position);
    damagePositionScratch[i]!.set(
      damageVectorScratch.x,
      damageVectorScratch.y,
      damageVectorScratch.z,
      impact.radius,
    );
    damageVectorScratch
      .set(impact.nx, impact.ny, impact.nz)
      .applyQuaternion(carRoot.quaternion)
      .normalize();
    damageNormalScratch[i]!.set(
      damageVectorScratch.x,
      damageVectorScratch.y,
      damageVectorScratch.z,
      impact.strength,
    );
    damageMetaScratch[i]!.set(DAMAGE_TYPE_CODE[impact.type], impact.seed, 0, 0);
  }

  carRoot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(material)) {
      for (const m of material) writeCarBodyCondition(m, dirt, scratches, count);
    } else {
      writeCarBodyCondition(material, dirt, scratches, count);
    }
  });
}

function writeCarBodyCondition(
  material: THREE.Material,
  dirt: number,
  scratches: number,
  damageCount: number,
): void {
  const uniforms = carBodyUniforms.get(material);
  if (uniforms === undefined || !hasDamageUniforms(uniforms)) return;
  uniforms.dirt.value = dirt;
  uniforms.scratches!.value = scratches;
  uniforms.damageCount.value = damageCount;
  for (let i = 0; i < damageCount; i++) {
    uniforms.damagePosRadius.value[i]!.copy(damagePositionScratch[i]!);
    uniforms.damageNormalStrength.value[i]!.copy(damageNormalScratch[i]!);
    uniforms.damageMeta.value[i]!.copy(damageMetaScratch[i]!);
  }
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
