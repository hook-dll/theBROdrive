import type * as THREE from 'three';

import { AUTUMN_GROUND, AUTUMN_LEAVES, CANOPY, canopyTurn, luma, type Rgb, type SeasonState } from '../world/season';

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
float seasonLuma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
vec3 seasonGround( vec3 col, vec4 w ) {
  if ( uSeasonDry <= 0.0 ) return col;
  float sum = w.x + w.y + w.z + w.w;
  w = sum < 0.01 ? vec4( 1.0, 0.0, 0.0, 0.0 ) : w / sum;
  float l = seasonLuma( col );
  vec3 meadow = ${v3(G.meadow)} * ( l / ${luma(G.meadowRef).toFixed(5)} );
  meadow = mix( meadow, col, ${G.meadowKeep.toFixed(3)} );
  vec3 crop = ${v3(G.crop)} * ( l / ${luma(G.cropRef).toFixed(5)} );
  vec3 floorLitter = ${v3(G.floor)} * ( l / ${luma(G.floorRef).toFixed(5)} );
  vec3 autumn = meadow * w.x + crop * w.y + floorLitter * w.z + col * ${G.earthShade.toFixed(3)} * w.w;
  return mix( col, autumn, uSeasonDry );
}
vec3 seasonCanopy( vec3 col ) {
  if ( uSeasonCanopy <= 0.0 ) return col;
  // The birch share, from where the colour's chromaticity lies between the two ends.
  vec3 spruceCh = ${v3(CANOPY.spruce)};
  vec3 birchCh = ${v3(CANOPY.birch)};
  spruceCh /= spruceCh.r + spruceCh.g + spruceCh.b;
  birchCh /= birchCh.r + birchCh.g + birchCh.b;
  vec3 ch = col / max( col.r + col.g + col.b, 1e-5 );
  vec3 span = birchCh - spruceCh;
  float birch = clamp( dot( ch - spruceCh, span ) / dot( span, span ), 0.0, 1.0 );
  vec3 summer = mix( ${v3(CANOPY.spruce)}, ${v3(CANOPY.birch)}, birch );
  vec3 autumn = mix( ${v3(CANOPY.spruce)}, ${v3(CANOPY.birchAutumn)}, birch );
  return col * mix( vec3( 1.0 ), autumn / summer, uSeasonCanopy );
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
export const SEASON_TREE_RANDOM_GLSL = 'fract( abs( tint ) * 91.7 )';
