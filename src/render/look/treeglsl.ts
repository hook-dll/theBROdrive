import * as THREE from 'three';

import type { LookPalette } from '../../world/look/palette';
import { groundTextures } from './groundtextures';
import { retainTreeTextures, treeSeasonFiles, treeTexture, TREE_SEASON_FILES, TREE_SHARED_FILES } from './treeassets';

/**
 * WHAT EVERY TREE MATERIAL SHARES: the season's two atlases, the palette's strengths,
 * and the handful of GLSL lines that must be the same in the model and in the impostor
 * or the change from one to the other shows.
 *
 * THE SEASON IS TWO ATLASES. Each season's trees were rendered from the same crown
 * geometry in a different paint, so the four atlases are one continuous thing sampled at
 * four points, and a transition is a blend between two neighbours. `LookPalette` already
 * names the two heaviest seasons and their mix (`groundForestA/B`, the same numbers the
 * ground's forest floor uses) — a tree and the floor under it therefore cannot disagree
 * about what month it is, and both change on the same frame.
 *
 * THE THREE NUMBERS THAT KEEP THE SEAM SHUT. The model and its impostor are two drawings
 * of one tree, and the eye catches any difference between them along the hand-over band:
 *
 *  1. TINT. One tree's leaves differ from its neighbour's by up to `treeDiscolouration`
 *     (SrTrees §1), a patch of wood about 250 m across. Both shaders call the same
 *     `treePatch` on the same WORLD position, so a tree keeps its tint as it dissolves.
 *  2. DARKENING. Both lose up to a third of their brightness between 50 and 250 m
 *     (SrTrees §1), which is what stops a far wood reading as brighter than a near one.
 *  3. GLOW. Sunlit leaves are multiplied by `vec3(rg * 8, 0.5) * radiance`
 *     (SrTrees §1) — the bright rim that makes a crown read as volume. Radiance comes
 *     from the palette at half the ground's strength, and the glow is applied to the
 *     sunlit term only, so nothing glows in shade or at night.
 *
 * The numbers are `slowroads`' own, kept because they are the look rather than a
 * measurement of anything.
 */

/** Season-order how far one tree's leaves may differ: spring, summer, autumn, winter. */
const TREE_DISCOLOURATION = [1.5, 0.9, 1.2, 0.2];
/** Trees take half the ground's radiance (SrTrees §1). */
const TREE_RADIANCE_SHARE = 0.5;
/** Where a crown loses brightness, and by how much, between the near and far edge. */
export const TREE_DARK_FROM_M = 50;
export const TREE_DARK_TO_M = 250;
const TREE_DARK_LOSS = 0.33;
/** The alpha test falls from `near` to `far` with distance, so mips keep the crown's edge. */
export const TREE_ALPHA_NEAR = 0.5;
export const TREE_ALPHA_FAR = 0.3;
/**
 * THE HAND-OVER BAND. A model is drawn out to the tier's model range and its impostor
 * from there; both dissolve against the same noise over this many metres, one where the
 * other is not, so a wood thins into impostors instead of swapping (SrTrees §5).
 */
export const TREE_LOD_BAND_M = 75;
/**
 * The models are authored ~11 m tall — a young tree. The world's trees are 15-20 m
 * (`plantTrees` scales a tree by 0.7-1.3), so the model is drawn at this much more than
 * the collider's scale. It is the same number for the impostors' quads, or a tree would
 * change size at the hand-over.
 */
export const TREE_MODEL_SCALE = 1.45;
/**
 * How much of the model's own width is drawn. The assets' crowns are broad — 7.5-8 m across
 * an 11.5 m tree — and the placement spaces trees on a 6.5 m lattice, so drawn whole they
 * meet along a road and a wood becomes one hedge: the reference frames' roadside birches
 * are separate trunks with sky between their crowns. The placement and the colliders are
 * the world's and cannot move, so the crown is narrowed to the wood the placement grows.
 */
export const TREE_WIDTH_SCALE = 0.72;
/** Snow settling on the upper side of a bare crown, as a share of the season's snow. */
const TREE_SNOW = 0.75;

/**
 * The model and the impostor both read these, so one write per frame reaches every tree.
 * A uniform object is shared by reference: `setTreeLook` writes a number once and every
 * material's compiled program sees it (the same arrangement `render/look/lighting.ts`
 * uses).
 */
export const treeUniforms = {
  uTreeAtlasA: { value: null as THREE.Texture | null },
  uTreeAtlasB: { value: null as THREE.Texture | null },
  uTreeConiferA: { value: null as THREE.Texture | null },
  uTreeConiferB: { value: null as THREE.Texture | null },
  uTreeConiferAlphaA: { value: null as THREE.Texture | null },
  uTreeConiferAlphaB: { value: null as THREE.Texture | null },
  uTreeImposterA: { value: null as THREE.Texture | null },
  uTreeImposterB: { value: null as THREE.Texture | null },
  uTreeConiferImposterA: { value: null as THREE.Texture | null },
  uTreeConiferImposterB: { value: null as THREE.Texture | null },
  uTreeNormal: { value: null as THREE.Texture | null },
  uTreeImposterNormal: { value: null as THREE.Texture | null },
  uTreeConiferNormal: { value: null as THREE.Texture | null },
  uTreeNoise: { value: null as THREE.Texture | null },
  /** The weight of the second atlas, 0 when the season is between one month and itself. */
  uTreeMix: { value: 0 },
  uTreeRadiance: { value: 0 },
  uTreeDiscolouration: { value: 0.9 },
  /** Where the models end: the tier's number, and the far edge of the dissolve band. */
  uTreeModelTo: { value: 200 },
  /** True per season, for the snow that lies on a bare crown's upper side. */
  uTreeSnow: { value: 0 },
  /** TEMPORARY DIAGNOSTIC: bits select unlit albedo, forced mip 0, normal fixes. */
  uTreeDbg: { value: 0 },
} satisfies Record<string, THREE.IUniform>;

/**
 * This frame's tree look, from the palette. Called once a frame from the sky, beside
 * `setGroundLook` and `setBushLook`, so trees, bushes and the ground turn together.
 *
 * The pair of atlases is the ground's own season pair, and the discolouration is the
 * pair's blend of the season table. Everything else is written from the palette's light.
 */
export function setTreeLook(palette: LookPalette): void {
  const a = palette.groundForestA;
  const b = palette.groundForestB;
  const filesA = TREE_SEASON_FILES[a]!;
  const filesB = TREE_SEASON_FILES[b]!;
  // Only the two seasons in play are resident: two 4K atlases each is 150 MB of texture,
  // and a pair changes a few times a game year (see the module header of treeassets.ts).
  retainTreeTextures(treeSeasonFiles(a, b));
  const u = treeUniforms;
  u.uTreeAtlasA.value = treeTexture(filesA.deciduous, true);
  u.uTreeAtlasB.value = treeTexture(filesB.deciduous, true);
  u.uTreeConiferA.value = treeTexture(filesA.conifer, true);
  u.uTreeConiferB.value = treeTexture(filesB.conifer, true);
  u.uTreeConiferAlphaA.value = treeTexture(filesA.coniferAlpha, false);
  u.uTreeConiferAlphaB.value = treeTexture(filesB.coniferAlpha, false);
  u.uTreeImposterA.value = treeTexture(filesA.imposterDeciduous, true);
  u.uTreeImposterB.value = treeTexture(filesB.imposterDeciduous, true);
  u.uTreeConiferImposterA.value = treeTexture(filesA.imposterConifer, true);
  u.uTreeConiferImposterB.value = treeTexture(filesB.imposterConifer, true);
  // The normals and the conifer impostor atlas name no season: the crown they were baked
  // from is the same every season, so they are loaded once and never dropped.
  u.uTreeNormal.value = treeTexture(TREE_SHARED_FILES.deciduousNormal, false);
  u.uTreeImposterNormal.value = treeTexture(TREE_SHARED_FILES.imposterDeciduousNormal, false);
  u.uTreeConiferNormal.value = treeTexture(TREE_SHARED_FILES.imposterConiferNormal, false);
  u.uTreeNoise.value = groundTextures().noiseFine;
  u.uTreeMix.value = palette.groundForestMix;
  u.uTreeRadiance.value = palette.radiance * TREE_RADIANCE_SHARE;
  u.uTreeDiscolouration.value =
    TREE_DISCOLOURATION[a]! + (TREE_DISCOLOURATION[b]! - TREE_DISCOLOURATION[a]!) * palette.groundForestMix;
  u.uTreeSnow.value = palette.groundForestMix * (b === 3 ? 1 : 0) + (1 - palette.groundForestMix) * (a === 3 ? 1 : 0);
}

/** Where the models end, this frame: the tier's range, set by `world/forest.ts`. */
export function setTreeModelRange(metres: number): void {
  treeUniforms.uTreeModelTo.value = metres;
}

/**
 * The lines both tree materials paste into their shaders. The patch noise, the tint and
 * the distance the models and the impostors both darken by have to be one function, or
 * the hand-over band shows them as two.
 *
 * The declarations every tree material needs. A SAMPLER IS A FRAGMENT'S: the vertex stage
 * of a tree samples nothing, and a sampler declared there would be a texture unit asked for
 * and thrown away. The patch noise, the tint and the darkening, though, must be one
 * function in both stages, so the functions below go into both.
 */
export const TREE_SAMPLERS_GLSL = /* glsl */ `
uniform sampler2D uTreeAtlasA;
uniform sampler2D uTreeAtlasB;
uniform sampler2D uTreeConiferA;
uniform sampler2D uTreeConiferB;
uniform sampler2D uTreeConiferAlphaA;
uniform sampler2D uTreeConiferAlphaB;
uniform sampler2D uTreeImposterA;
uniform sampler2D uTreeImposterB;
uniform sampler2D uTreeConiferImposterA;
uniform sampler2D uTreeConiferImposterB;
uniform sampler2D uTreeNormal;
uniform sampler2D uTreeImposterNormal;
uniform sampler2D uTreeConiferNormal;
uniform sampler2D uTreeNoise;
`;

export const TREE_UNIFORMS_GLSL = /* glsl */ `
uniform float uTreeMix;
uniform float uTreeRadiance;
uniform float uTreeDiscolouration;
uniform float uTreeModelTo;
uniform float uTreeSnow;
uniform float uTreeDbg;
`;

/** TEMPORARY: the diagnostic bits and the atlas fetch they can bias. */
const TREE_DBG_GLSL = /* glsl */ `
float treeDbgBit( float bit ) { return mod( floor( uTreeDbg / bit ), 2.0 ); }
vec4 treeTexel( sampler2D tex, vec2 uv ) {
	return texture2D( tex, uv, treeDbgBit( 2.0 ) > 0.5 ? -8.0 : 0.0 );
}
`;

export const TREE_COMMON_GLSL = /* glsl */ `
${TREE_UNIFORMS_GLSL}
${TREE_DBG_GLSL}

/**
 * A 0..1 noise of the place, on cells of 'cell' metres with a hash that repeats every
 * four of them: a kilometre, the floating origin's own step (world/origin.ts), so a
 * rebase does not make the whole wood change colour at once.
 */
float treeHash( vec2 i ) {
	i = mod( i, 4.0 );
	return fract( sin( dot( i, vec2( 41.13, 289.7 ) ) + 1.7 ) * 43758.5453 );
}
float treePatch( vec2 p, float cell ) {
	vec2 c = floor( p / cell );
	vec2 f = fract( p / cell );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( treeHash( c ), treeHash( c + vec2( 1.0, 0.0 ) ), f.x ),
		mix( treeHash( c + vec2( 0.0, 1.0 ) ), treeHash( c + vec2( 1.0, 1.0 ) ), f.x ),
		f.y
	);
}
/** How much greener or browner than its neighbours the wood at a place is drawn. */
float treeDiscolour( vec2 world ) {
	float n = 0.65 * treePatch( world, 250.0 ) + 0.35 * treePatch( world, 125.0 );
	return 1.0 + ( n - 0.5 ) * uTreeDiscolouration;
}
/** The share of its brightness a tree keeps at a distance: 1 near, 0.67 at 250 m. */
float treeDistBlend( float d ) {
	return 1.0 - ${TREE_DARK_LOSS.toFixed(2)} * clamp( ( d - ${TREE_DARK_FROM_M.toFixed(1)} ) / ${(TREE_DARK_TO_M - TREE_DARK_FROM_M).toFixed(1)}, 0.0, 1.0 );
}
/**
 * THE SEASON, PER LEAF. The two atlases hold the same crown in two paints, so the blend
 * would work as a plain mix — but a mix of gold and green is a muddy olive for a week of
 * game time. Each leaf instead changes at its own point of the mix, ordered by the
 * pipeline's own bake (Col.r, "how turned this leaf is"), which is what an autumn looks
 * like: a few leaves at a time, over the whole crown.
 */
float treeSeasonMix( float turned ) {
	if ( uTreeMix <= 0.0 ) return 0.0;
	return clamp( ( uTreeMix - ( turned * 0.8 + 0.1 ) ) * 6.0 + 0.5, 0.0, 1.0 );
}
/** The alpha the crown keeps: a cut-out read through mips erodes, so the test falls. */
float treeAlphaCut( float d, float far ) {
	return max( ${TREE_ALPHA_FAR.toFixed(2)}, ${TREE_ALPHA_NEAR.toFixed(2)} * ( 1.0 - d / ( far + ${TREE_LOD_BAND_M.toFixed(1)} ) ) );
}
/**
 * The glow of sunlit leaves: a multiplier on the direct light only, keyed on the leaf's
 * own colour, scaled by the distance darkening: take the leaf texel's own rgb.
 */
vec3 treeGlow( vec3 rgb, float blend ) {
	return vec3( rgb.r * 8.0, rgb.g * 8.0, 0.5 ) * ( uTreeRadiance * blend );
}
`;
