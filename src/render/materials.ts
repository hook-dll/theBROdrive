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
import { SandColor } from './desertdust';
import { stickerAtlas } from './stickerart';

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

/**
 * Where on a car the road reaches, per model, in chassis-local metres.
 *
 * Desert dust is not a uniform film: the tyres throw it up behind each wheel and
 * along the sills, and the low-pressure wake behind a moving car holds a cloud of it
 * against the tail. Placing that needs to know how tall the body is and where its
 * wheels are, which is exactly what `CarModelMeasure` already carries.
 */
export interface CarBodyFrame {
  /** Chassis-box half extents. */
  readonly halfExtents: readonly [number, number, number];
  readonly frontAxleZ: number;
  readonly rearAxleZ: number;
  /** Wheel-centre height at rest. */
  readonly wheelCentreY: number;
  readonly wheelRadius: number;
}

interface CarBodyUniforms {
  readonly dirt: { value: number };
  readonly scratches: { value: number };
  /** Offset into the noise field, so same-model cars do not wear identically. */
  readonly fieldOrigin: { value: THREE.Vector3 };
  readonly bodyHalf: { value: THREE.Vector3 };
  /** Front axle Z, rear axle Z, wheel-centre Y, wheel radius. */
  readonly axles: { value: THREE.Vector4 };
  readonly palettePaint: { value: number };
  readonly paintColor: { value: THREE.Color };
  readonly paintCell: { value: THREE.Vector2 };
  /** The "stick it here" pulse, 0..1 (CAR_HIGHLIGHT). */
  readonly highlight: { value: number };
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
/**
 * The dust a car collects, authored against the sand the drive starts on and carried
 * round the palette with it (render/desertdust.ts): a lighter settled film, a darker
 * packed crust, and the pale film a bare part gathers. Shared by every program.
 */
const DUST_LIGHT = new SandColor(new THREE.Color(0.58, 0.46, 0.3));
const DUST_CRUST = new SandColor(new THREE.Color(0.4, 0.29, 0.16));
const DUST_FILM = new SandColor(new THREE.Color(0.72, 0.66, 0.55));

function bindDesertDust(shader: WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uDustLight = { value: DUST_LIGHT.value };
  shader.uniforms.uDustCrust = { value: DUST_CRUST.value };
  shader.uniforms.uDustFilm = { value: DUST_FILM.value };
}

const CONDITION_PROGRAM_KEY = 'condition-rust-dirt-v2';

/**
 * Every car's paint — driven, traffic, parked wreck and courier — shares this one
 * program. What differs between a showroom car and a sand-blasted wreck is uniform
 * VALUES, so a POI full of wrecks entering the view compiles nothing.
 */
const CAR_BODY_PROGRAM_KEY = 'car-body-condition-v3';

/**
 * Every car's sticker decals share this program too (stickerdecals.ts): a decal is a
 * plain lit standard material with the paint's own wear patched in, so only its uniform
 * VALUES differ from car to car. The try-on preview is the same material with a smaller
 * opacity, so it compiles nothing either.
 */
const CAR_STICKER_PROGRAM_KEY = 'car-sticker-decal-v1';

/**
 * Name of the vertex attribute carrying each paint vertex's chassis-local position
 * (see `render/carmodel.ts`). Car bodies are several meshes, each with its own local
 * frame and a non-uniform fit scale, so neither the mesh-local nor the world position
 * can say "this is the sill" or "this is the tail" — only the chassis frame can.
 */
export const CAR_BODY_POSITION_ATTRIBUTE = 'carBodyPos';

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

/**
 * 3D value noise on a cheap arithmetic hash, shared by the part and car programs.
 * Returns 0..1 with a mean of 0.5.
 */
const CONDITION_NOISE = `
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
`;

const CONDITION_PARS = `
uniform float uDirt;
uniform vec3 uDustLight;
uniform vec3 uDustCrust;
uniform vec3 uDustFilm;
uniform float uRust;
${CONDITION_NOISE}

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
// ---------------------------------------------------------------------------
// Car paint
// ---------------------------------------------------------------------------

/**
 * The car program's vertex side: nothing but a hand-off of the chassis-local
 * position. The fit and the ride drop have already been baked into the geometry on
 * the CPU, so the vertex shader stays stock.
 */
const CAR_BODY_VERTEX_PARS = `#include <common>
attribute vec3 ${CAR_BODY_POSITION_ATTRIBUTE};
varying vec3 vCarBodyPos;`;
const CAR_BODY_VERTEX_HOOK = `#include <worldpos_vertex>
vCarBodyPos = ${CAR_BODY_POSITION_ATTRIBUTE};`;

/**
 * Fragment declarations shared by everything that wears the car's dust: the paint
 * (`CAR_BODY_PARS`), the window glass (materials.ts GLASS_GRIME_*) and the sticker
 * decals (render/stickerdecals.ts), which reuse this block so a decal is dusted and
 * scratched exactly as the panel under it is.
 *
 * `carArch` is the dust fan one axle's tyres throw: it starts at the tyre and
 * reaches further BEHIND the wheel than in front of it, which is where the arch lip
 * and the next panel back catch it on every real car driven off tarmac.
 *
 * `carScratchLayer` is one layer of fine scratches: at most one short straight
 * streak per cell, present with probability `density`, running mostly along the
 * panel the way a kerb, a branch or another car's bumper drags across it. Its pixel
 * footprint is taken before the per-cell early-out, because a derivative inside
 * non-uniform control flow is undefined.
 */
const CAR_WEAR_PARS = `uniform float uDirt;
uniform vec3 uDustLight;
uniform vec3 uDustCrust;
uniform vec3 uDustFilm;
uniform float uScratch;
uniform vec3 uCarFieldOrigin;
uniform vec3 uCarBodyHalf;
uniform vec4 uCarAxles;
varying vec3 vCarBodyPos;
${CONDITION_NOISE}
float carArch( vec3 p, float axleZ, float forward ) {
  float ahead = ( p.z - axleZ ) * forward;
  vec2 d = vec2( p.y - uCarAxles.z, ahead * ( ahead < 0.0 ? 0.55 : 1.25 ) );
  return 1.0 - smoothstep( uCarAxles.w * 0.95, uCarAxles.w * 2.1, length( d ) );
}`;

/** One layer of the paint's fine scratches, shared by the paint and the sticker decals. */
const CAR_SCRATCH_LAYER = `float carScratchLayer( vec2 uv, float cell, float density, float seed ) {
  vec2 g = uv / cell;
  float aa = max( fwidth( g.x ) + fwidth( g.y ), 1e-4 );
  vec2 id = floor( g );
  if ( condHash( vec3( id, seed ) ) > density ) return 0.0;
  float h1 = condHash( vec3( id, seed + 19.0 ) );
  float h2 = condHash( vec3( id, seed + 43.0 ) );
  float angle = ( h1 - 0.5 ) * 0.8 + step( 0.82, h2 ) * ( h1 - 0.5 ) * 2.4;
  vec2 dir = vec2( cos( angle ), sin( angle ) );
  vec2 f = fract( g ) - 0.5 - ( vec2( h1, h2 ) - 0.5 ) * 0.3;
  float across = abs( dot( f, vec2( -dir.y, dir.x ) ) );
  float along = abs( dot( f, dir ) );
  float halfLength = 0.3 + 0.18 * h2;
  float width = 0.008 + 0.012 * h1;
  float line = 1.0 - smoothstep( width, width + aa, across );
  line *= 1.0 - smoothstep( halfLength * 0.7, halfLength, along );
  // A scratch thinner than a pixel cannot be drawn, only averaged: fading it by its
  // coverage is what stops a distant car sparkling instead of looking scuffed.
  return line * min( 1.0, 3.0 * width / aa );
}`;

/** The paint's own declarations over the shared wear: the palette and the pulse. */
const CAR_BODY_PARS = `#include <common>
${CAR_WEAR_PARS}
${CAR_SCRATCH_LAYER}
uniform float uPalettePaint;
uniform vec3 uPalettePaintColor;
uniform vec2 uPalettePaintCell;
uniform float uHighlight;`;

/**
 * The Soviet atlas is a 9x2 sheet of flat colour swatches. Only the main body mesh
 * receives this material, and only its authored paint cell is replaced; glass,
 * chrome, lamps, wheels and rally decals keep their original cells.
 *
 * `carPaintPanel` tells the condition chunk which fragments are paint. Scratches in
 * chrome, rubber and black trim cells barely show, so they are drawn faintly there.
 */
const CAR_PAINT_MAP = `float carPaintPanel = 1.0;
#include <map_fragment>
#ifdef USE_MAP
if ( uPalettePaint > 0.5 ) {
  vec2 carPaintCell = floor( vMapUv * vec2( 9.0, 2.0 ) );
  if ( all( equal( carPaintCell, uPalettePaintCell ) ) ) {
    diffuseColor.rgb = uPalettePaintColor;
  } else {
    carPaintPanel = 0.3;
  }
}
#endif`;

/**
 * The "here I am" glow: while the player holds a sticker, the cars it could go on
 * warm up in a soft pulse, strongest at the silhouette (a fresnel rim), so the car
 * reads as the thing to aim at without a marker floating over it.
 */
const CAR_HIGHLIGHT = `
if ( uHighlight > 0.001 ) {
  float hlRim = pow( 1.0 - saturate( dot( normal, normalize( -vViewPosition ) ) ), 2.0 );
  diffuseColor.rgb += uHighlight * ( 0.08 + 0.8 * hlRim ) * vec3( 1.0, 0.8, 0.42 );
}`;

/**
 * Dirt and scratches on car paint, in the car's own chassis frame.
 *
 * Injected after the normal is final but before `lights_physical_fragment` builds
 * the BRDF inputs, so it can both read the shading normal and still change
 * diffuseColor, roughnessFactor and metalnessFactor.
 *
 * THE GATE. Everything below sits behind one uniform test that is coherent across a
 * whole draw call, so a clean car — a fresh spawn, a courier — pays one comparison
 * per fragment and none of the noise. Each half has its own gate as well, so a car
 * that is only dusty never evaluates a scratch cell.
 *
 * DIRT reads like the desert that threw it: a warm sand crust, heaviest along the
 * sills and valances, in a fan behind each wheel and across the tail (the wake of a
 * moving car holds a dust cloud against it), climbing the body as the level rises;
 * above that only a light film that settles more on the roof and bonnet. It is
 * matt, and it hides whatever paint and scratches are under it.
 *
 * SCRATCHES are sparse fine streaks of paler, duller paint whose density follows
 * `uScratch`, weighted towards the nose and tail corners, the flanks at bumper to
 * belt height — the places a body actually meets the world. The streaks run along
 * whichever panel face the fragment lies on, found from the screen-space derivative
 * of the chassis position; swirl marks too fine to draw are averaged into a general
 * loss of gloss.
 */
const CAR_BODY_CONDITION = `#include <normal_fragment_maps>
if ( uDirt + uScratch > 0.0005 ) {
  vec3 carP = vCarBodyPos;
  vec3 carH = uCarBodyHalf;
  vec3 carQ = abs( carP ) / carH;
  float carHeight = clamp( ( carP.y + carH.y ) / ( 2.0 * carH.y ), 0.0, 1.0 );
  float carForward = uCarAxles.x >= uCarAxles.y ? 1.0 : -1.0;
  float carAlong = carP.z * carForward / carH.z;

  if ( uScratch > 0.0005 ) {
    // Where a body meets the world: bumper corners at either end, the sills and door
    // bottoms that kerbs and scrub brush reach, and the arch lips stones are thrown
    // at. The roof and the upper flanks stay nearly clean.
    float belt = 1.0 - smoothstep( 0.45, 0.8, carHeight );
    float ends = smoothstep( 0.72, 0.98, carQ.z ) * ( 0.35 + 0.65 * belt );
    float corners = ends * ( 0.6 + 0.4 * smoothstep( 0.55, 0.95, carQ.x ) );
    float sills = smoothstep( 0.8, 0.98, carQ.x ) * ( 1.0 - smoothstep( 0.18, 0.5, carHeight ) );
    float lips = max(
      carArch( carP, uCarAxles.x, carForward ),
      carArch( carP, uCarAxles.y, carForward )
    );
    float zone = max( max( corners, sills * 0.75 ), lips * 0.55 );
    float density = uScratch * ( 0.04 + 0.96 * zone );
    vec3 carFace = abs( cross( dFdx( carP ), dFdy( carP ) ) );
    vec2 carUv = carFace.x > max( carFace.y, carFace.z )
      ? carP.zy
      : ( carFace.z > carFace.y ? carP.xy : carP.xz );
    carUv += uCarFieldOrigin.xy;
    // Fine marks, then the long horizontal scrapes a kerb or another car leaves.
    float lines = max(
      carScratchLayer( carUv, 0.12, density * 0.8, 3.0 ),
      carScratchLayer( vec2( carUv.x * 0.35, carUv.y ), 0.14, density * 0.45, 11.0 )
    ) * carPaintPanel;
    // Through the clear top of the paint to the grey primer and bare steel under it:
    // pale on dark paint, dark on pale paint, dull on both.
    vec3 scratched = mix( diffuseColor.rgb, vec3( 0.3, 0.29, 0.27 ), 0.8 );
    float swirl = density * 0.45 * carPaintPanel;
    diffuseColor.rgb = mix( diffuseColor.rgb, scratched, max( lines * 0.85, swirl * 0.12 ) );
    roughnessFactor = mix( roughnessFactor, 0.7, swirl );
    roughnessFactor = mix( roughnessFactor, 0.82, lines );
  }

  if ( uDirt > 0.0005 ) {
    vec3 carN = carP + uCarFieldOrigin;
    float low = 1.0 - smoothstep( 0.04, 0.6, carHeight );
    float flank = smoothstep( 0.45, 0.9, carQ.x );
    float arch = max(
      carArch( carP, uCarAxles.x, carForward ),
      carArch( carP, uCarAxles.y, carForward )
    ) * ( 0.35 + 0.65 * flank );
    float tail = smoothstep( 0.6, 0.97, -carAlong ) * ( 1.0 - 0.5 * carHeight );
    float exposure = max( max( low, arch ), tail );
    float mottle = condNoise( carN * 2.4 );
    // Run-off streaks: long vertically, short across, on the lower body only.
    float drip = condNoise( vec3( carN.x * 6.0, carN.y * 0.8, carN.z * 6.0 ) );
    float crust = uDirt * ( 0.15 + 1.5 * exposure )
      + ( mottle - 0.5 ) * 0.55 * uDirt
      + ( drip - 0.5 ) * 0.35 * uDirt * low;
    crust = smoothstep( 0.1, 0.9, crust );
    // View-space normal back to world: settling dust only knows which way is up.
    float carUp = saturate( ( vec4( normal, 0.0 ) * viewMatrix ).y );
    float film = uDirt * ( 0.22 + 0.33 * carUp ) * ( 0.65 + 0.7 * mottle );
    float cover = saturate( max( crust, film ) );
    vec3 dust = mix( uDustLight, uDustCrust, crust );
    diffuseColor.rgb = mix( diffuseColor.rgb, dust, cover * ( 0.6 + 0.35 * crust ) );
    roughnessFactor = mix( roughnessFactor, 0.96, cover );
    metalnessFactor = mix( metalnessFactor, 0.0, cover );
  }
}`;

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
  vec3 dustColor = mix( vec3( condLum ), uDustFilm, 0.5 );
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
  bindDesertDust(shader);
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

/** Binds one car's paint uniforms: palette recolour, dirt and scratches. */
function patchCarBodyShader(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: CarBodyUniforms,
  unified: boolean,
): void {
  shader.uniforms.uDirt = uniforms.dirt;
  shader.uniforms.uScratch = uniforms.scratches;
  bindDesertDust(shader);
  shader.uniforms.uCarFieldOrigin = uniforms.fieldOrigin;
  shader.uniforms.uCarBodyHalf = uniforms.bodyHalf;
  shader.uniforms.uCarAxles = uniforms.axles;
  shader.uniforms.uPalettePaint = uniforms.palettePaint;
  shader.uniforms.uPalettePaintColor = uniforms.paintColor;
  shader.uniforms.uPalettePaintCell = uniforms.paintCell;
  shader.uniforms.uHighlight = uniforms.highlight;

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', CAR_BODY_VERTEX_PARS)
    .replace('#include <worldpos_vertex>', CAR_BODY_VERTEX_HOOK);

  // Under the unified car style the atlas's non-paint swatches are re-shaded by the
  // table, which has to arrive with the rest of the fragment declarations and run
  // BEFORE the wear below: dirt is what covers a cleaned-up bumper, not the reverse.
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', unified ? CAR_BODY_PARS + CAR_ATLAS_FINISH : CAR_BODY_PARS)
    .replace('#include <map_fragment>', CAR_PAINT_MAP)
    .replace(
      '#include <normal_fragment_maps>',
      (unified ? CAR_ATLAS_FINISH_PAINT + CAR_BODY_CONDITION : CAR_BODY_CONDITION) + CAR_HIGHLIGHT,
    );
}


// ---------------------------------------------------------------------------
// Unified car style (`?carstyle=unified`, DEV only)
// ---------------------------------------------------------------------------

/**
 * The non-paint surfaces every pack is snapped to by the unified car style, so a
 * Soviet bumper, a GTA trim strip and a wheel rim are the same material whichever
 * car they were imported on.
 *
 * Four finishes is what a period car actually has: painted black, rubber, painted
 * steel and chrome. One palette rather than a per-pack opinion is the whole point —
 * a car's finish must not be able to say which pack it came from.
 */
export interface CarSurfaceFinish {
  readonly color: number;
  readonly roughness: number;
  readonly metalness: number;
}

export const CAR_SURFACE_FINISH = {
  /** Bumper-to-bumper black plastic, mouldings and grille surrounds. */
  trim: { color: 0x1b1d1f, roughness: 0.6, metalness: 0 },
  /** Tyres and rub strips: matte enough to swallow a highlight. */
  rubber: { color: 0x131415, roughness: 0.9, metalness: 0 },
  /** Painted steel wheel: half metallic, visibly duller than chrome. */
  rim: { color: 0x8e9296, roughness: 0.45, metalness: 0.3 },
  /** Chromed bumpers, grilles and hubcaps: the one mirror on a period car. */
  chrome: { color: 0xb8bec3, roughness: 0.25, metalness: 0.8 },
} as const satisfies Record<string, CarSurfaceFinish>;

/** How the unified style dresses one authored material. */
export interface UnifiedMaterialOptions {
  /** The palette surface this material becomes. */
  readonly finish: CarSurfaceFinish;
  /** Keep the source's own base colour — for a surface the palette does not name. */
  readonly keepColor?: boolean;
}

/**
 * A palette colour as GLSL, in the working space three shades in (linear): the
 * shader writes these straight into `diffuseColor`, so converting twice would
 * darken every bumper.
 */
function glslColor(color: number): string {
  const c = new THREE.Color(color);
  return `vec3( ${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)} )`;
}

/**
 * The atlas's non-paint swatches, as a cell -> finish table.
 *
 * The 9x2 sheet is fifteen flat swatches and the body mesh and the wheels draw
 * everything out of it. Measured over all fifteen Soviet bodies, only three of those
 * cells are surfaces this palette owns:
 *
 *   (0, 1) the grey steel: a body's bumpers and grille, and every wheel's own rim
 *   (1, 1) the dark grey:  bumper rubbers and side mouldings
 *   (2, 1) the black:      tyres, black trim and the underbody
 *
 * Everything else keeps the swatch the pack painted it — the car's own paint cell
 * (whichever cell that model uses), the teal glass, the lamp lenses, the whitewall
 * and the rally stripes.
 *
 * `wheel` picks between the two readings of the grey steel cell: the same swatch is
 * a chromed bumper on a body and a painted steel rim on a wheel, and the palette
 * keeps those two surfaces apart. It is a constant at every call site, so the driver
 * folds the branch away.
 */
const CAR_ATLAS_FINISH = `
bool carAtlasFinish( vec2 cell, bool wheel, out vec3 color, out float roughness, out float metalness ) {
  if ( all( equal( cell, vec2( 0.0, 1.0 ) ) ) ) {
    color = wheel ? ${glslColor(CAR_SURFACE_FINISH.rim.color)} : ${glslColor(CAR_SURFACE_FINISH.chrome.color)};
    roughness = wheel ? ${CAR_SURFACE_FINISH.rim.roughness.toFixed(3)} : ${CAR_SURFACE_FINISH.chrome.roughness.toFixed(3)};
    metalness = wheel ? ${CAR_SURFACE_FINISH.rim.metalness.toFixed(3)} : ${CAR_SURFACE_FINISH.chrome.metalness.toFixed(3)};
    return true;
  }
  if ( all( equal( cell, vec2( 1.0, 1.0 ) ) ) ) {
    color = ${glslColor(CAR_SURFACE_FINISH.trim.color)};
    roughness = ${CAR_SURFACE_FINISH.trim.roughness.toFixed(3)};
    metalness = ${CAR_SURFACE_FINISH.trim.metalness.toFixed(3)};
    return true;
  }
  if ( all( equal( cell, vec2( 2.0, 1.0 ) ) ) ) {
    color = ${glslColor(CAR_SURFACE_FINISH.rubber.color)};
    roughness = ${CAR_SURFACE_FINISH.rubber.roughness.toFixed(3)};
    metalness = ${CAR_SURFACE_FINISH.rubber.metalness.toFixed(3)};
    return true;
  }
  return false;
}`;

/**
 * The body's copy of the table, applied where the BRDF inputs are already computed
 * so it can rewrite colour, roughness and metalness together — and BEFORE the wear
 * block that follows it, which mixes its own values over whatever the surface
 * started as. Dirt covers a bumper; a bumper does not cover dirt.
 *
 * A car's own paint cell is left to `uPalettePaintColor`, which is how the per-car
 * factory colour has always arrived.
 */
const CAR_ATLAS_FINISH_PAINT = `#ifdef USE_MAP
{
  vec2 carAtlasCell = floor( vMapUv * vec2( 9.0, 2.0 ) );
  if ( uPalettePaint < 0.5 || !all( equal( carAtlasCell, uPalettePaintCell ) ) ) {
    vec3 carAtlasColor; float carAtlasRoughness; float carAtlasMetalness;
    if ( carAtlasFinish( carAtlasCell, false, carAtlasColor, carAtlasRoughness, carAtlasMetalness ) ) {
      diffuseColor.rgb = carAtlasColor;
      roughnessFactor = carAtlasRoughness;
      metalnessFactor = carAtlasMetalness;
    }
  }
}
#endif
`;

/** The wheel's copy: no paint cell to protect, and the grey steel is a rim. */
const CAR_ATLAS_FINISH_WHEEL = `#ifdef USE_MAP
{
  vec2 carAtlasCell = floor( vMapUv * vec2( 9.0, 2.0 ) );
  vec3 carAtlasColor; float carAtlasRoughness; float carAtlasMetalness;
  if ( carAtlasFinish( carAtlasCell, true, carAtlasColor, carAtlasRoughness, carAtlasMetalness ) ) {
    diffuseColor.rgb = carAtlasColor;
    roughnessFactor = carAtlasRoughness;
    metalnessFactor = carAtlasMetalness;
  }
}
#endif
`;

/** Stable program key for every unified atlas material. */
const UNIFIED_ATLAS_PROGRAM_KEY = 'car-atlas-finish-v1';

/**
 * Patches one atlas material: the pack's tyre, rim and trim swatches become the
 * palette, in place of the flat colours and Blinn response the FBX shipped.
 */
function patchUnifiedAtlasShader(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>' + CAR_ATLAS_FINISH)
    .replace('#include <normal_fragment_maps>', CAR_ATLAS_FINISH_WHEEL + '#include <normal_fragment_maps>');
}

/**
 * One car model material under the unified style. The pack's own map is kept, so
 * whatever the palette does not name — a whitewall, a rally stripe — is still the
 * swatch that pack painted, and the table re-shades only the surfaces it owns.
 *
 * `wheel` decides how the shared grey steel swatch reads, and is the only thing that
 * differs between a wheel and a bodywork mesh that would otherwise carry the atlas.
 */
export function makeUnifiedAtlasMaterial(source: THREE.Material, wheel: boolean): THREE.Material {
  if (!(source instanceof THREE.MeshStandardMaterial) && !(source instanceof THREE.MeshPhongMaterial)) {
    return source.clone();
  }
  // The carried colour stays the source's — white on the atlas — because the map IS
  // the palette here: tinting it would shift every swatch the table leaves alone.
  // `trim` is the base for the cells the table does not claim: a plain dielectric is
  // the safest reading of a swatch no pack ever named.
  const material = cloneAsStandard(
    source,
    source.color,
    CAR_SURFACE_FINISH.trim.roughness,
    CAR_SURFACE_FINISH.trim.metalness,
  );
  material.onBeforeCompile = (shader) => patchUnifiedAtlasShader(shader);
  material.customProgramCacheKey = () => `${UNIFIED_ATLAS_PROGRAM_KEY}${wheel ? '-wheel' : '-body'}`;
  return material;
}

/**
 * One authored car material as its unified-style counterpart: the palette's colour
 * and finish, keeping the source's map, emissive, name and sidedness. This is what
 * turns the GTA packs' named `car_trim`, `Tyres` and `wheel_rim` into the same
 * surfaces the Soviet atlas cells become.
 */
export function makeUnifiedSurfaceMaterial(
  source: THREE.Material,
  options: UnifiedMaterialOptions,
): THREE.Material {
  if (!(source instanceof THREE.MeshStandardMaterial) && !(source instanceof THREE.MeshPhongMaterial)) {
    return source.clone();
  }
  return cloneAsStandard(
    source,
    options.keepColor ? source.color : options.finish.color,
    options.finish.roughness,
    options.finish.metalness,
  );
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
 * The one window tint in the game: car glass and house windows are the same
 * opaque sky mirror, so the scene probe supplies sky, cirrus and Sun and nothing
 * behind the pane is ever modelled. The restrained blue and reflection strength
 * keep it glass-like without turning every window into a chrome-blue panel.
 * Owners build their own instance from these numbers (see `carGlassMaterial` in
 * render/carmodel.ts and the dwellings' glass) so disposing one never frees the
 * other.
 */
export const TINTED_GLASS = {
  color: 0x203746,
  roughness: 0.11,
  metalness: 0.35,
  envMapIntensity: 1.7,
} as const;

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
function makeCarPaintFinishMaterial(source: THREE.Material): THREE.Material {
  if (!(source instanceof THREE.MeshStandardMaterial) && !(source instanceof THREE.MeshPhongMaterial)) {
    return source.clone();
  }
  return cloneAsStandard(source, source.color, CAR_PAINT_ROUGHNESS, CAR_PAINT_METALNESS);
}

/**
 * Clones an authored car material under one finish: the colour it is given, and the
 * roughness/metalness pair that says what the surface IS.
 *
 * Every channel the source can carry comes across — map, emissive, normal, alpha,
 * sidedness, depth state — because a car part's identity lives in its map and its
 * cutout, not in its BRDF. The maps that would MODULATE the finish are dropped
 * instead: an authored roughness or metalness map is the pack's own opinion about a
 * surface this finish now owns, and leaving it on would fight every value written.
 */
function cloneAsStandard(
  source: THREE.MeshStandardMaterial | THREE.MeshPhongMaterial,
  color: THREE.ColorRepresentation,
  roughness: number,
  metalness: number,
): THREE.MeshStandardMaterial {
  if (source instanceof THREE.MeshStandardMaterial) {
    const material = source.clone();
    material.color.set(color);
    material.roughness = roughness;
    material.metalness = metalness;
    material.roughnessMap = null;
    material.metalnessMap = null;
    material.envMapIntensity = 1;
    return material;
  }

  const material = new THREE.MeshStandardMaterial({
    color,
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
    roughness,
    metalness,
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
 *
 * `seed` is the car's appearance hash: wear is sampled in the body's own frame, so
 * without it two cars of one model would scuff and dust in identical places, and
 * with it a saved car wears in the same places every time it loads.
 *
 * `unified` is the DEV-only car-style switch. It adds the shared palette's per-atlas-
 * cell finishes to this same program, and is carried on the material rather than read
 * here because `?carstyle` is carmodel.ts's flag — and the two variants must not share
 * a compiled program.
 */
export function makeCarBodyConditionMaterial(
  source: THREE.Material,
  frame: CarBodyFrame,
  seed: number,
  unified: boolean,
): THREE.Material {
  const material = makeCarPaintFinishMaterial(source);
  if (!(material instanceof THREE.MeshStandardMaterial)) return material;

  const half = frame.halfExtents;
  const uniforms: CarBodyUniforms = {
    dirt: { value: 0 },
    scratches: { value: 0 },
    fieldOrigin: { value: wearFieldOrigin(seed) },
    bodyHalf: { value: new THREE.Vector3(half[0], half[1], half[2]) },
    axles: {
      value: new THREE.Vector4(
        frame.frontAxleZ,
        frame.rearAxleZ,
        frame.wheelCentreY,
        frame.wheelRadius,
      ),
    },
    palettePaint: { value: 0 },
    paintColor: { value: new THREE.Color() },
    paintCell: { value: new THREE.Vector2() },
    highlight: { value: 0 },
  };
  carBodyUniforms.set(material, uniforms);
  material.onBeforeCompile = (shader) => patchCarBodyShader(shader, uniforms, unified);
  material.customProgramCacheKey = () =>
    unified ? `${CAR_BODY_PROGRAM_KEY}-unified` : CAR_BODY_PROGRAM_KEY;
  return material;
}

// ---------------------------------------------------------------------------
// Sticker decals
// ---------------------------------------------------------------------------

/** Opacity of the try-on preview decal, 0..1. */
export const STICKER_PREVIEW_ALPHA = 0.78;

const STICKER_DECAL_VERTEX_PARS = `#include <common>
attribute vec3 ${CAR_BODY_POSITION_ATTRIBUTE};
attribute float aDecal;
varying vec3 vCarBodyPos;
varying float vDecal;`;

const STICKER_DECAL_FRAGMENT_PARS = `#include <common>
${CAR_WEAR_PARS}
${CAR_SCRATCH_LAYER}
uniform float uOpacity;
varying float vDecal;`;

const STICKER_DECAL_VERTEX = `#include <worldpos_vertex>
vCarBodyPos = ${CAR_BODY_POSITION_ATTRIBUTE};
vDecal = aDecal;`;

/**
 * Reads the sticker atlas un-premultiplied, so the material can blend it the ordinary
 * way: three premultiplies a texture on upload (`stickerart.ts`), and the standard
 * alpha blend would then multiply the ink by its own alpha a second time. This
 * REPLACES the stock `map_fragment`: kept in front of it, the atlas was applied twice
 * (ink squared, edges thinned to alpha squared).
 */
const STICKER_DECAL_MAP = `#ifdef USE_MAP
vec4 stickerInk = texture2D( map, vMapUv );
diffuseColor *= vec4( stickerInk.rgb / max( stickerInk.a, 1e-4 ), stickerInk.a );
#endif`;

/**
 * Wears the decal exactly as the panel under it wears: the same block the paint runs
 * (CAR_BODY_CONDITION), read at the chassis position the decal carries, so dust settles
 * on the sticker the way it settled on the printed one and scratches cross both.
 */
const STICKER_DECAL_WEAR = `float carPaintPanel = 1.0;
${CAR_BODY_CONDITION}`;

/**
 * One car's sticker-decal material: the projected geometry (render/stickerdecals.ts)
 * carries the atlas UVs and this prints them.
 *
 * A decal is a separate mesh drawn over the panel it was clipped from, so it must not
 * write depth — two stickers on one spot share a depth and the newest has to stay on
 * top, which buffer order then decides — and it floats a couple of millimetres off the
 * panel (stickerdecals.ts). Vinyl: satin, no metal flake, and the paint's own wear over
 * the top, which is the order a real sticker ages in.
 *
 * `frame` is the car's paint material. The decal shares its dirt, scratch, field, body
 * and axle uniform OBJECTS, so a car gathering dust dusts its stickers with no extra
 * work and `setCarBodyCondition` never has to know decals exist. `opacity` is 1 for a
 * placed sticker and `STICKER_PREVIEW_ALPHA` for the try-on — the same program either
 * way, since only a uniform value differs.
 */
export function makeCarStickerMaterial(frame: CarGrimeFrame | null, opacity = 1): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    name: 'car-sticker-decal',
    map: stickerAtlas().texture,
    roughness: 0.42,
    metalness: 0,
    envMapIntensity: 1,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // The decal is coplanar with the panel it was clipped from: nudge it towards the
    // camera in depth as well as in space, or a long grazing view fights over it.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const print = { value: opacity };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOpacity = print;
    if (frame) {
      shader.uniforms.uDirt = frame.dirt;
      shader.uniforms.uScratch = frame.scratches;
      shader.uniforms.uCarFieldOrigin = frame.fieldOrigin;
      shader.uniforms.uCarBodyHalf = frame.bodyHalf;
      shader.uniforms.uCarAxles = frame.axles;
    }
    bindDesertDust(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', STICKER_DECAL_VERTEX_PARS)
      .replace('#include <worldpos_vertex>', STICKER_DECAL_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', STICKER_DECAL_FRAGMENT_PARS)
      .replace('#include <map_fragment>', STICKER_DECAL_MAP)
      .replace('#include <normal_fragment_maps>', STICKER_DECAL_WEAR)
      .replace(
        '#include <alphatest_fragment>',
        `diffuseColor.a *= vDecal * uOpacity;\n#include <alphatest_fragment>`,
      );
  };
  material.customProgramCacheKey = () => CAR_STICKER_PROGRAM_KEY;
  return material;
}

/** The "stick it here" pulse on one car's paint, 0..1 (CAR_HIGHLIGHT). */
export function setCarBodyHighlight(paint: readonly THREE.Material[], value: number): void {
  for (const material of paint) {
    const uniforms = carBodyUniforms.get(material);
    if (uniforms) uniforms.highlight.value = value;
  }
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
 * Resprays one car: every paint material it was instanced with takes `color`. An
 * atlas body swaps its paint cell's replacement colour, a solid-paint body its
 * material colour; glass, lamps and trim were never in the list.
 */
export function setCarBodyPaintColor(paint: readonly THREE.Material[], color: THREE.Color): void {
  for (const material of paint) {
    const uniforms = carBodyUniforms.get(material);
    if (uniforms !== undefined && uniforms.palettePaint.value > 0) {
      uniforms.paintColor.value.copy(color);
    } else if (material instanceof THREE.MeshStandardMaterial) {
      material.color.copy(color);
    }
  }
}

/**
 * Writes one car's shell dirt and scratches into the paint materials it was
 * instanced with. Uniform writes into handles captured once, so a car driving
 * through dust can call this every frame without walking its scene graph.
 */
export function setCarBodyCondition(
  paint: readonly THREE.Material[],
  dirt: number,
  scratches: number,
): void {
  for (const material of paint) {
    const uniforms = carBodyUniforms.get(material);
    if (uniforms === undefined) continue;
    uniforms.dirt.value = dirt;
    uniforms.scratches.value = scratches;
  }
}

// ---------------------------------------------------------------------------
// Grime on glass and lamp lenses
// ---------------------------------------------------------------------------

/**
 * DUST ON THE GLASS AND THE LENSES, as a film rather than a crust.
 *
 * Glass does not take the paint's shader: it has no chassis-frame attribute, no rust
 * and no scratches, and what dirt does to it is different — it is not a colour laid
 * over the surface so much as the MIRROR going out of it. A clean window is a sky
 * reflection; a dusty one is a pale, matt, patchy pane. A lens does the same, and also
 * lets less of its own light out, which is the one thing a driver actually notices.
 *
 * One program for every car's glass and one per lamp material kind, shared through
 * `customProgramCacheKey`: what differs between a showroom pane and a desert one is a
 * uniform. Nothing is sampled in world space, so nothing slides over the glass as the
 * car turns: windows follow the paint's crust in the chassis frame (GLASS_GRIME_BODY),
 * lenses carry an even film (GRIME_COLOR).
 */
const CAR_GRIME_PROGRAM_KEY = 'car-grime-v3';
const CAR_GLASS_GRIME_PROGRAM_KEY = 'car-glass-grime-v2';
const carGrimeUniforms = new WeakMap<THREE.Material, { value: number }>();

const GRIME_FRAGMENT_PARS = `#include <common>
uniform float uGrime;
uniform float uGrimeSkyScale;
uniform vec3 uDustLight;
uniform vec3 uDustCrust;
`;

// LENSES: an even film, the same dust the paint's upper panels carry. The first version
// had a mottle, a fine grain and drip runs sampled in WORLD orientation: the pattern slid
// across the lens whenever the car turned, and the fine grain read as pixels. A lens is
// small and has no chassis-frame stamp; a uniform matt layer is what it shows.
const GRIME_COLOR = `#include <color_fragment>
float grimeFilm = 0.0;
if ( uGrime > 0.0005 ) {
  // A little dust already takes most of a lens's shine: the film builds fast, then
  // saturates, rather than growing in step with the paint's crust.
  grimeFilm = saturate( 1.1 * uGrime );
  vec3 grimeDust = mix( uDustLight, uDustCrust, 0.15 );
  diffuseColor.rgb = mix( diffuseColor.rgb, grimeDust, grimeFilm * 0.85 );
}`;

/**
 * WINDOWS: the paint's own dust, continued over the glass.
 *
 * The panes carry the chassis-frame stamp the paint does (carmodel.ts
 * `stampCarBodyPositions`) and share the car's field origin, half extents and axles, so
 * this is the paint's crust term evaluated on glass: it climbs from the sills, fans
 * behind the wheels and sits in the tail's wake, with the same uneven edge, and where it
 * reaches a window it crosses it on the same line it crosses the door. Above it only a
 * thin film, thinner than on paint (glass is smooth, steep and wiped). Nothing is sampled
 * in world space, so nothing slides as the car turns.
 */
const GLASS_GRIME_VERTEX_PARS = `#include <common>
attribute vec3 ${CAR_BODY_POSITION_ATTRIBUTE};
varying vec3 vCarBodyPos;`;
const GLASS_GRIME_VERTEX_HOOK = `#include <worldpos_vertex>
vCarBodyPos = ${CAR_BODY_POSITION_ATTRIBUTE};`;

const GLASS_GRIME_FRAGMENT_PARS = `#include <common>
uniform float uGrime;
uniform float uGrimeSkyScale;
uniform vec3 uDustLight;
uniform vec3 uDustCrust;
uniform vec3 uCarFieldOrigin;
uniform vec3 uCarBodyHalf;
uniform vec4 uCarAxles;
varying vec3 vCarBodyPos;
${CONDITION_NOISE}
float glassArch( vec3 p, float axleZ, float forward ) {
  float ahead = ( p.z - axleZ ) * forward;
  vec2 d = vec2( p.y - uCarAxles.z, ahead * ( ahead < 0.0 ? 0.55 : 1.25 ) );
  return 1.0 - smoothstep( uCarAxles.w * 0.95, uCarAxles.w * 2.1, length( d ) );
}`;

const GLASS_GRIME_DECLARE = `#include <color_fragment>
float grimeFilm = 0.0;`;

// Mirrors CAR_BODY_CONDITION's dirt block term for term; keep the two in step.
const GLASS_GRIME_BODY = `#include <normal_fragment_maps>
if ( uGrime > 0.0005 ) {
  vec3 carP = vCarBodyPos;
  vec3 carH = uCarBodyHalf;
  vec3 carQ = abs( carP ) / carH;
  float carHeight = clamp( ( carP.y + carH.y ) / ( 2.0 * carH.y ), 0.0, 1.0 );
  float carForward = uCarAxles.x >= uCarAxles.y ? 1.0 : -1.0;
  float carAlong = carP.z * carForward / carH.z;
  vec3 carN = carP + uCarFieldOrigin;
  float low = 1.0 - smoothstep( 0.04, 0.6, carHeight );
  float flank = smoothstep( 0.45, 0.9, carQ.x );
  float arch = max(
    glassArch( carP, uCarAxles.x, carForward ),
    glassArch( carP, uCarAxles.y, carForward )
  ) * ( 0.35 + 0.65 * flank );
  float tail = smoothstep( 0.6, 0.97, -carAlong ) * ( 1.0 - 0.5 * carHeight );
  float exposure = max( max( low, arch ), tail );
  float mottle = condNoise( carN * 2.4 );
  float drip = condNoise( vec3( carN.x * 6.0, carN.y * 0.8, carN.z * 6.0 ) );
  float crust = uGrime * ( 0.15 + 1.5 * exposure )
    + ( mottle - 0.5 ) * 0.55 * uGrime
    + ( drip - 0.5 ) * 0.35 * uGrime * low;
  crust = smoothstep( 0.1, 0.9, crust );
  float carUp = saturate( ( vec4( normal, 0.0 ) * viewMatrix ).y );
  float film = 0.6 * uGrime * ( 0.22 + 0.33 * carUp ) * ( 0.65 + 0.7 * mottle );
  grimeFilm = saturate( max( crust, film ) );
  vec3 dust = mix( uDustLight, uDustCrust, crust );
  diffuseColor.rgb = mix( diffuseColor.rgb, dust, grimeFilm * ( 0.6 + 0.35 * crust ) );
  roughnessFactor = mix( roughnessFactor, 0.96, grimeFilm );
  metalnessFactor = mix( metalnessFactor, 0.0, saturate( grimeFilm * 1.7 ) );
}`;

const GRIME_ROUGHNESS = `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.95, grimeFilm );`;

const GRIME_METALNESS = `#include <metalnessmap_fragment>
metalnessFactor = mix( metalnessFactor, 0.0, saturate( grimeFilm * 1.7 ) );`;

// Dust is matt and sees the sky as the paint's dust does. The glass's boosted sky
// (TINTED_GLASS.envMapIntensity) is for the MIRROR; left on the film it washed the
// sand into a pale grey-blue fog. Where there is dust, the sky light is brought back to
// what an ordinary surface gets.
const GRIME_SKY = `#include <lights_fragment_maps>
#if defined( RE_IndirectDiffuse )
  iblIrradiance *= mix( 1.0, uGrimeSkyScale, grimeFilm );
#endif
#if defined( RE_IndirectSpecular )
  radiance *= mix( 1.0, uGrimeSkyScale, grimeFilm );
#endif`;

const GRIME_SPECULAR = `#include <specularmap_fragment>
specularStrength *= 1.0 - 0.85 * grimeFilm;`;

// A lens under dust lets out a good deal less, and what it lets out has come through
// sand: warmer, a dim amber rather than a white bulb. The loss has to be large to show
// at all — a lit lens is several times over white, and a mild cut stays clipped white.
const GRIME_EMISSIVE = `#include <emissivemap_fragment>
totalEmissiveRadiance *= ( 1.0 - 0.8 * grimeFilm ) * mix( vec3( 1.0 ), vec3( 1.0, 0.8, 0.55 ), grimeFilm );`;

/**
 * The part of one car's paint uniforms anything else on the car wears: its glass, its
 * sticker decals. Dirt and scratches come across as well, since they are the uniform
 * objects themselves: a car that gathers dust dusts its decals without a call.
 */
export interface CarGrimeFrame {
  readonly dirt: { value: number };
  readonly scratches: { value: number };
  readonly fieldOrigin: { value: THREE.Vector3 };
  readonly bodyHalf: { value: THREE.Vector3 };
  readonly axles: { value: THREE.Vector4 };
}

/** The chassis frame of a paint material made by `makeCarBodyConditionMaterial`. */
export function carPaintGrimeFrame(paint: THREE.Material): CarGrimeFrame | null {
  return carBodyUniforms.get(paint) ?? null;
}

/**
 * Gives a glass or lamp material the grime, in place, and returns it. The material
 * must be this car's own (a clone): the uniform is per material. With `frame` (window
 * glass stamped with chassis positions) the dust is the paint's crust continued over
 * the pane; without it (lamp lenses) an even film.
 */
export function makeCarGrimeMaterial<T extends THREE.MeshStandardMaterial | THREE.MeshPhongMaterial>(
  material: T,
  frame: CarGrimeFrame | null = null,
): T {
  const grime = { value: 0 };
  carGrimeUniforms.set(material, grime);
  const standard = material instanceof THREE.MeshStandardMaterial;
  const glass = standard && frame !== null;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrime = grime;
    shader.uniforms.uGrimeSkyScale = {
      value: standard ? 1 / Math.max(1, (material as THREE.MeshStandardMaterial).envMapIntensity) : 1,
    };
    bindDesertDust(shader);
    if (glass) {
      shader.uniforms.uCarFieldOrigin = frame.fieldOrigin;
      shader.uniforms.uCarBodyHalf = frame.bodyHalf;
      shader.uniforms.uCarAxles = frame.axles;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', GLASS_GRIME_VERTEX_PARS)
        .replace('#include <worldpos_vertex>', GLASS_GRIME_VERTEX_HOOK);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', GLASS_GRIME_FRAGMENT_PARS)
        .replace('#include <color_fragment>', GLASS_GRIME_DECLARE)
        .replace('#include <normal_fragment_maps>', GLASS_GRIME_BODY)
        .replace('#include <lights_fragment_maps>', GRIME_SKY);
      return;
    }
    let fragment = shader.fragmentShader
      .replace('#include <common>', GRIME_FRAGMENT_PARS)
      .replace('#include <color_fragment>', GRIME_COLOR)
      .replace('#include <emissivemap_fragment>', GRIME_EMISSIVE);
    fragment = standard
      ? fragment
          .replace('#include <roughnessmap_fragment>', GRIME_ROUGHNESS)
          .replace('#include <metalnessmap_fragment>', GRIME_METALNESS)
          .replace('#include <lights_fragment_maps>', GRIME_SKY)
      : fragment.replace('#include <specularmap_fragment>', GRIME_SPECULAR);
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => (glass ? CAR_GLASS_GRIME_PROGRAM_KEY : CAR_GRIME_PROGRAM_KEY);
  return material;
}

/** Writes grime (0..1) into glass or lamp materials made by `makeCarGrimeMaterial`. */
export function setCarGrime(materials: readonly THREE.Material[], grime: number): void {
  for (const material of materials) {
    const uniform = carGrimeUniforms.get(material);
    if (uniform) uniform.value = grime;
  }
}

/** The condition shader's own sand, so a weathered wreck reads as the same dust. */
const STATIC_DUST_COLOR = DUST_LIGHT.value;

/**
 * Weathers a static shell's paint at no per-frame cost: its colour is pulled toward the
 * desert's dust and its finish dulled, once, on the CPU, and the condition shader's gate
 * stays shut. A wreck never changes, and the per-fragment noise that makes a driven
 * car's dust patchy was a full wear shader on every wreck in view.
 */
export function weatherStaticCarPaint(paint: readonly THREE.Material[], dust: number): void {
  for (const material of paint) {
    const uniforms = carBodyUniforms.get(material);
    if (uniforms) {
      uniforms.dirt.value = 0;
      uniforms.scratches.value = 0;
    }
    const palette = uniforms !== undefined && uniforms.palettePaint.value > 0;
    if (palette) uniforms.paintColor.value.lerp(STATIC_DUST_COLOR, dust);
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    if (!palette) material.color.lerp(STATIC_DUST_COLOR, dust);
    material.roughness += (0.96 - material.roughness) * dust;
    material.metalness *= 1 - dust;
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
