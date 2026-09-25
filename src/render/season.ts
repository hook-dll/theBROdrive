import type * as THREE from 'three';

import {
  AUTUMN_GROUND,
  AUTUMN_LEAVES,
  BARE_TWIG,
  BARE_TWIGS,
  CANOPY,
  CANOPY_SNOW,
  canopyTurn,
  DEAD_GRASS,
  luma,
  SNOW,
  SNOW_UNDER_TREES,
  type Rgb,
  type SeasonState,
} from '../world/season';

/**
 * The season in the shaders (world/season.ts has the calendar and the colours).
 *
 * One set of uniform objects shared by every material that recolours for the season,
 * set once a frame by `setSeasonUniforms`. The GLSL below is generated from the same
 * colour tables the vista's CPU path uses, so the two cannot drift apart.
 */

export const SEASON_UNIFORMS = {
  uSeasonTurn: { value: 0 },
  uSeasonDry: { value: 0 },
  uSeasonBare: { value: 0 },
  uSeasonSnow: { value: 0 },
  uSeasonFresh: { value: 0 },
  /** `canopyTurn(turn)`: how far a far wood as a whole has turned. */
  uSeasonCanopy: { value: 0 },
  /** The weather's wetness (world/weather.ts): darker ground, a shining road. */
  uWeatherWet: { value: 0 },
} satisfies Record<string, THREE.IUniform<number>>;

export function setSeasonUniforms(season: SeasonState): void {
  const u = SEASON_UNIFORMS;
  u.uSeasonTurn.value = season.turn;
  u.uSeasonDry.value = season.dry;
  u.uSeasonBare.value = season.bare;
  u.uSeasonSnow.value = season.snow;
  u.uSeasonFresh.value = season.fresh;
  u.uSeasonCanopy.value = canopyTurn(season.turn);
}

const v3 = (c: Rgb): string => `vec3( ${c.map((x) => x.toFixed(5)).join(', ')} )`;
const arr = (cs: readonly Rgb[]): string => `vec3[${cs.length}]( ${cs.map(v3).join(', ')} )`;
const farr = (fs: readonly number[]): string => `float[${fs.length}]( ${fs.map((f) => f.toFixed(4)).join(', ')} )`;

const G = AUTUMN_GROUND;
const L = AUTUMN_LEAVES;

/**
 * Declarations and functions, for both shader stages:
 *
 *   seasonGround( col, w )        linear summer ground colour, w = ground paint weights
 *   seasonCanopy( col )           a far wood's canopy colour
 *   seasonLeafTurn( kind, rnd )   how far one tree's leaves have turned, 0..1
 *   seasonLeafTarget( kind, rnd ) its autumn colour per unit of summer brightness
 *   seasonLeaf( col, kind, rnd )  a leaf colour, recoloured for that tree
 *   seasonLeafBare( kind, rnd )   how far that tree has dropped its leaves
 *   seasonLeafKeep( bare, shade ) whether one painted leaf is still on
 *   seasonEvergreenSnow( kind, up ) snow on a conifer's upper side
 *   seasonSnowAt( forest, spot )  how much snow lies on the ground
 *   seasonPatch( xz )             a world noise for snow's patches
 *
 * `rnd` is the tree's own random 0..1, the same value for its model and its impostor.
 */
export const SEASON_GLSL = /* glsl */ `
uniform float uSeasonTurn;
uniform float uSeasonDry;
uniform float uSeasonBare;
uniform float uSeasonSnow;
uniform float uSeasonFresh;
uniform float uSeasonCanopy;
uniform float uWeatherWet;
float seasonLuma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
/**
 * How much snow lies at a point, 0..1: the snow channel, less under trees, and patchy
 * while it comes and goes (\`spot\` a 0..1 noise of the place), so the first snow
 * whitens the open first and the thaw bares the ground in patches, not all at once.
 */
float seasonSnowAt( float forest, float spot ) {
  if ( uSeasonSnow <= 0.0 ) return 0.0;
  float lying = uSeasonSnow * ( 1.0 - ${SNOW_UNDER_TREES.toFixed(3)} * forest );
  return smoothstep( spot * 0.7, spot * 0.7 + 0.3, lying );
}
vec3 seasonGround( vec3 col, vec4 w, float spot ) {
  if ( uSeasonDry <= 0.0 && uSeasonSnow <= 0.0 ) return col;
  float sum = w.x + w.y + w.z + w.w;
  w = sum < 0.01 ? vec4( 1.0, 0.0, 0.0, 0.0 ) : w / sum;
  float l = seasonLuma( col );
  vec3 meadow = ${v3(G.meadow)} * ( l / ${luma(G.meadowRef).toFixed(5)} );
  meadow = mix( meadow, col, ${G.meadowKeep.toFixed(3)} );
  // Late autumn: with the leaves down the meadow goes dull brown, and stays so under the
  // snow until the spring green (\`dry\` falls) takes it back.
  meadow = mix( meadow, ${v3(DEAD_GRASS)} * ( l / ${luma(G.meadowRef).toFixed(5)} ), uSeasonBare * uSeasonDry * 0.8 );
  vec3 crop = ${v3(G.crop)} * ( l / ${luma(G.cropRef).toFixed(5)} );
  vec3 floorLitter = ${v3(G.floor)} * ( l / ${luma(G.floorRef).toFixed(5)} );
  vec3 autumn = meadow * w.x + crop * w.y + floorLitter * w.z + col * ${G.earthShade.toFixed(3)} * w.w;
  vec3 dry = mix( col, autumn, uSeasonDry );
  return mix( dry, ${v3(SNOW)}, seasonSnowAt( w.z, spot ) );
}
vec3 seasonGround( vec3 col, vec4 w ) {
  return seasonGround( col, w, 0.5 );
}
/** A cheap 0..1 value noise of a world position, for snow's patches (tens of metres). */
// Cells of 25 m and a hash repeating every 40 cells: a kilometre, the origin's rebase
// step (world/origin.ts), so the patches do not jump when the origin moves.
float seasonPatchHash( vec2 i ) {
  i = mod( i, 40.0 );
  return fract( sin( dot( i, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
}
float seasonPatch( vec2 p ) {
  vec2 i = floor( p / 25.0 );
  vec2 f = fract( p / 25.0 );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = seasonPatchHash( i );
  float b = seasonPatchHash( i + vec2( 1.0, 0.0 ) );
  float c = seasonPatchHash( i + vec2( 0.0, 1.0 ) );
  float d = seasonPatchHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
vec3 seasonCanopy( vec3 col ) {
  if ( uSeasonCanopy <= 0.0 && uSeasonBare <= 0.0 && uSeasonSnow <= 0.0 ) return col;
  // The birch share, from where the colour's chromaticity lies between the two ends.
  vec3 spruceCh = ${v3(CANOPY.spruce)};
  vec3 birchCh = ${v3(CANOPY.birch)};
  spruceCh /= spruceCh.r + spruceCh.g + spruceCh.b;
  birchCh /= birchCh.r + birchCh.g + birchCh.b;
  vec3 ch = col / max( col.r + col.g + col.b, 1e-5 );
  vec3 span = birchCh - spruceCh;
  float birch = clamp( dot( ch - spruceCh, span ) / dot( span, span ), 0.0, 1.0 );
  vec3 summer = mix( ${v3(CANOPY.spruce)}, ${v3(CANOPY.birch)}, birch );
  vec3 leaf = mix( ${v3(CANOPY.birch)}, ${v3(CANOPY.birchAutumn)}, uSeasonCanopy );
  vec3 now = mix( ${v3(CANOPY.spruce)}, mix( leaf, ${v3(CANOPY.birchBare)}, uSeasonBare ), birch );
  vec3 v = col * ( now / summer );
  return mix( v, ${v3(SNOW)} * 0.8, uSeasonSnow * ${CANOPY_SNOW.toFixed(3)} );
}
const vec3 SEASON_LEAF_A[${L.length}] = ${arr(L.map((l) => l.a))};
const vec3 SEASON_LEAF_B[${L.length}] = ${arr(L.map((l) => l.b))};
const float SEASON_LEAF_REF[${L.length}] = ${farr(L.map((l) => luma(l.ref)))};
const float SEASON_LEAF_LATE[${L.length}] = ${farr(L.map((l) => l.late))};
const float SEASON_LEAF_TURNS[${L.length}] = ${farr(L.map((l) => l.turns))};
float seasonLeafTurn( int kind, float rnd ) {
  // Each tree turns over its own stretch of the channel: a few early, most with the
  // rest, some late. The kind's lateness moves the whole kind.
  float from = SEASON_LEAF_LATE[ kind ] + rnd * 0.4;
  return SEASON_LEAF_TURNS[ kind ] * smoothstep( from, from + 0.3, uSeasonTurn );
}
// The tree's autumn colour per unit of summer brightness: a leaf of brightness l turns
// to seasonLeafTarget * l, so its light and shade survive the change of colour.
vec3 seasonLeafTarget( int kind, float rnd ) {
  return mix( SEASON_LEAF_A[ kind ], SEASON_LEAF_B[ kind ], fract( rnd * 7.31 ) ) / SEASON_LEAF_REF[ kind ];
}
vec3 seasonLeaf( vec3 col, int kind, float rnd ) {
  float t = seasonLeafTurn( kind, rnd );
  if ( t <= 0.0 ) return col;
  return mix( col, seasonLeafTarget( kind, rnd ) * seasonLuma( col ), t );
}
/**
 * How far one tree has dropped its leaves, 0..1: each broad-leaved tree at its own
 * point of the \`bare\` channel, conifers never.
 */
float seasonLeafBare( int kind, float rnd ) {
  float from = fract( rnd * 3.7 ) * 0.5;
  return SEASON_LEAF_TURNS[ kind ] * smoothstep( from, from + 0.4, uSeasonBare );
}
/**
 * Whether one painted leaf is still on the tree, as coverage: leaves go one by one,
 * each at its own point, picked by its painted shade (every leaf of the atlas is one
 * flat shade), so a thinning crown loses leaves, not opacity.
 */
float seasonLeafKeep( float bare, float leafShade ) {
  if ( bare <= 0.0 ) return 1.0;
  return step( bare * ${(1 - BARE_TWIGS).toFixed(3)}, fract( leafShade * 37.0 ) * 0.98 + 0.01 );
}
/** What is left of a bare crown reads as twigs: its colour, by how bare the tree is. */
vec3 seasonTwigs( vec3 col, float bare ) {
  return mix( col, ${v3(BARE_TWIG)}, smoothstep( 0.2, 0.9, bare ) );
}
/** 1 for an evergreen (conifer, juniper, moss), 0 for a broad-leaved kind. */
float seasonIsEvergreen( int kind ) {
  return 1.0 - SEASON_LEAF_TURNS[ kind ];
}
/** Snow on an evergreen's upper side (\`up\` its normal's y) and on moss: 0..1. */
float seasonEvergreenSnow( int kind, float up ) {
  return ( 1.0 - SEASON_LEAF_TURNS[ kind ] ) * uSeasonSnow * smoothstep( 0.15, 0.7, up ) * 0.8;
}
`;

/** Adds the season uniforms to a compiling shader and its functions after `#include <common>` in both stages. */
export function injectSeason(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, SEASON_UNIFORMS);
  // Patches chain: whichever gets here first declares it for the rest.
  if (shader.vertexShader.includes('uniform float uSeasonTurn;')) return;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${SEASON_GLSL}`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${SEASON_GLSL}`);
}

/**
 * A tree's own random 0..1 from its tint, which both its model (instance colour) and
 * its impostor carry as the same float (world/forest.ts).
 */
/** The snow colour as a GLSL literal. */
export const SNOW_GLSL = v3(SNOW);

export const SEASON_TREE_RANDOM_GLSL = 'fract( abs( tint ) * 91.7 )';

/**
 * Covers a material with snow as the \`snow\` channel rises: \`amount\` how much of
 * it disappears under the snow at full cover, \`shade\` the snow's brightness there (a
 * packed rut is greyer than a drift). For the strips laid on the ground, the shoulder
 * and the dirt tracks, which must go white with the ground they lie on.
 */
/** The weather's wetness, set once a frame with the season. */
export function setWeatherWet(wet: number): void {
  SEASON_UNIFORMS.uWeatherWet.value = wet;
}

/**
 * Wets a material in the rain: darker by `darken`, and glossy (roughness down to
 * `gloss`) so the road shines back the grey sky. The ground only darkens.
 */
export function applyWetness<T extends THREE.Material>(material: T, darken: number, gloss: number | null): T {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    injectSeason(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
diffuseColor.rgb *= 1.0 - ${darken.toFixed(3)} * uWeatherWet * ( 1.0 - uSeasonSnow );`,
    );
    if (gloss !== null) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, ${gloss.toFixed(3)}, uWeatherWet * ( 1.0 - uSeasonSnow ) );`,
      );
    }
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:wet-${darken}-${gloss}`;
  return material;
}

export function applySnowCover<T extends THREE.Material>(material: T, amount: number, shade = 1): T {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    injectSeason(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
diffuseColor.rgb = mix( diffuseColor.rgb, ${SNOW_GLSL} * ${shade.toFixed(3)}, uSeasonSnow * ${amount.toFixed(3)} );`,
    );
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:snow-${amount}-${shade}`;
  return material;
}
