import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';

import { applyCloudShadow } from '../cloudshadow';
import { injectSeason, SNOW_GLSL } from '../season';
import { applyWorldLighting } from './lighting';
import { TREE_COMMON_GLSL, TREE_SAMPLERS_GLSL, treeUniforms, TREE_LOD_BAND_M } from './treeglsl';

/**
 * THE FAR TREES: one quad per tree, turned to face the camera and painted from a
 * sixteen-view atlas of the species it is.
 *
 * WHAT AN IMPOSTOR IS. Past the model range a tree is a few pixels tall, and a quad costs
 * two triangles where its model costs a hundred and seventy. The atlas holds sixteen views
 * of each species, baked from the pipeline's full-detail tree, and the fragment picks the
 * view the camera is nearest to and switches between neighbours with a dither rather than
 * a second fetch — one texel shows one view, never two trees (SrTrees §4).
 *
 * THE SEAM IS THE WHOLE JOB. A model hands over to its impostor across `TREE_LOD_BAND_M`,
 * both dissolving against the same noise texture, one keeping exactly what the other drops.
 * Three numbers then have to match on both sides or the band shows as a change of drawing:
 * the per-tree tint, the glow of sunlit leaves, and the 50→250 m darkening — all three come
 * from `treeglsl.ts` and are called by both shaders.
 *
 * GROWN AND SUNK PAST 200 m. A far wood loses its smaller trees to the haze, so past 200 m
 * every impostor grows 30 % and sinks 4 m into the ground over the next 800: the wood keeps
 * its mass and its horizon line, and the trees the ground's own mound of canopy used to
 * stand in for are now the trees themselves (SrTrees §4).
 *
 * WHERE THE INSTANCE DATA LIVES. Not in attributes: six kilometres of a wood is hundreds of
 * thousands of trees, and per-instance vertex data for that is tens of megabytes rewritten
 * every time a tile arrives. The instances are two `vec4`s in a FLOAT TEXTURE instead
 * (`world/impostors.ts` owns the store), and the vertex shader fetches its own row by
 * instance index — a texture fetch where an attribute would do, and it is what makes a
 * hundred thousand trees one draw.
 */

/** The metres past the model range where an impostor starts to widen and sink. */
const WIDEN_FROM_M = 200;
const WIDEN_SPAN_M = 800;
const WIDEN_SCALE = 0.3;
const WIDEN_SINK_M = 4;
/** A wood's own keepers widen as the rest of the wood dissolves, so it keeps its mass. */
const KEEPER_WIDEN = 0.8;
/** Where a distant impostor stops dithering its view and takes the nearer one to half. */
const VIEW_DITHER_FROM_M = 300;
const VIEW_DITHER_TO_M = 600;
/** How many views the atlas holds round a tree, and how much of the mip's alpha to give back. */
export const IMPOSTOR_VIEWS = 16;
const MIP_ALPHA_RESTORE = 0.12;
/** The alpha a far tree is cut out at: below it the texel is the ground behind the tree. */
const IMPOSTOR_CUT = 0.6;

export const impostorUniforms = {
  /** The model range and the dissolve band: the same numbers the models use. */
  uImpFrom: { value: 200 },
  uImpBand: { value: TREE_LOD_BAND_M },
  /** Where a tree of a wood goes, and a wood's far keeper, and a tree outside a wood. */
  uImpTo: { value: 2000 },
  uImpKeepTo: { value: 4500 },
  uImpOpenTo: { value: 6000 },
  /** Views round a tree, and the two atlases' row counts (deciduous, conifer). */
  uImpViews: { value: IMPOSTOR_VIEWS },
  uImpRows: { value: new THREE.Vector2(4, 2) },
  /** One texel of the atlas, in uv, for the mip estimate the alpha compensation needs. */
  uImpTexel: { value: new THREE.Vector2(1 / 4096, 1 / 1024) },
  /** The store the instance data lives in. `world/impostors.ts` owns the contents. */
  uImpData0: { value: null as THREE.DataTexture | null },
  uImpData1: { value: null as THREE.DataTexture | null },
} satisfies Record<string, THREE.IUniform>;

/** The model range and the reaches: written by the forest renderer when the tier changes. */
export function setImpostorReach(from: number, to: number, openTo: number, keepTo: number): void {
  impostorUniforms.uImpFrom.value = from;
  impostorUniforms.uImpTo.value = to;
  impostorUniforms.uImpOpenTo.value = openTo;
  impostorUniforms.uImpKeepTo.value = keepTo;
}

/**
 * The atlas' own geometry, from the manifest: the row count per sheet, its cell size in
 * pixels, and the views round a tree. The texel size is what the mip estimate needs.
 */
export function setImpostorLayout(rowDeciduous: number, rowConifer: number, cellPx: number, views: number): void {
  impostorUniforms.uImpRows.value.set(rowDeciduous, rowConifer);
  impostorUniforms.uImpViews.value = views;
  impostorUniforms.uImpTexel.value.set(1 / (views * cellPx), 1 / (rowDeciduous * cellPx));
}

/** The one attribute an impostor carries: which row of the store it is. */
const IMPOSTOR_ATTRIBUTES = /* glsl */ `
attribute float aImpIndex;
`;

const IMPOSTOR_UNIFORMS = /* glsl */ `
uniform highp sampler2D uImpData0;
uniform highp sampler2D uImpData1;
uniform float uImpFrom;
uniform float uImpBand;
uniform float uImpTo;
uniform float uImpKeepTo;
uniform float uImpOpenTo;
uniform float uImpViews;
uniform vec2 uImpRows;
uniform vec2 uImpTexel;
`;

const IMPOSTOR_VARYINGS = /* glsl */ `
varying vec2 vImpQuad;
varying vec2 vImpUvA;
varying vec2 vImpUvB;
varying vec3 vImpRight;
varying vec3 vImpFwd;
varying vec3 vImpWorld;
varying float vImpBlend;
varying float vImpCam;
varying float vImpFade;
varying float vImpDissolve;
varying float vImpConifer;
varying float vImpTint;
`;

/** The vertex stage's declarations: the attribute, the store's uniforms, the shared maths. */
const IMPOSTOR_VERTEX_PRELUDE_GLSL = `${IMPOSTOR_ATTRIBUTES}${IMPOSTOR_UNIFORMS}${IMPOSTOR_VARYINGS}${TREE_COMMON_GLSL}`;

/** The fragment's: the store and the atlases, the varyings, and no attribute. */
const IMPOSTOR_FRAGMENT_PRELUDE_GLSL = `${IMPOSTOR_UNIFORMS}${TREE_SAMPLERS_GLSL}${IMPOSTOR_VARYINGS}${TREE_COMMON_GLSL}`;

/** The vertex stage: fetch the instance, billboard it, pick the two views, dissolve it. */
const IMPOSTOR_VERTEX = /* glsl */ `
ivec2 impTexel = ivec2( int( aImpIndex ) % ${1024}, int( aImpIndex ) / ${1024} );
vec4 imp0 = texelFetch( uImpData0, impTexel, 0 );
vec4 imp1 = texelFetch( uImpData1, impTexel, 0 );
vec3 impBase = imp0.xyz;
vec3 impWorld = ( modelMatrix * vec4( impBase, 1.0 ) ).xyz;
vec2 impTo = cameraPosition.xz - impWorld.xz;
vec3 impFwd = normalize( vec3( impTo.x, 0.0, impTo.y ) + vec3( 1e-4, 0.0, 0.0 ) );
vec3 impRight = vec3( impFwd.z, 0.0, -impFwd.x );
// Overwritten per pixel from the normal atlas; this only feeds three's varyings.
vec3 objectNormal = impFwd;
vImpRight = impRight;
vImpFwd = impFwd;
vImpWorld = impWorld;
`;

const IMPOSTOR_VERTEX_BODY = /* glsl */ `
#include <begin_vertex>
{
	// a1.x is the species plus the tree's own turn as a fraction of a turn.
	float impSpecies = floor( imp1.x );
	float impYaw = fract( imp1.x ) * 6.2832;
	float impCam = length( impTo );
	// A tree of a wood goes at uImpTo; one outside a wood carries on to uImpOpenTo, and a
	// wood's far keeper to uImpKeepTo, widening as the rest of its wood dissolves.
	float impKeeper = step( 5.0, imp1.w );
	float impReach = imp1.w < 0.0 ? uImpOpenTo : mix( uImpTo, uImpKeepTo, impKeeper );
	float impGrow = 1.0 + impKeeper * ${KEEPER_WIDEN.toFixed(1)} * smoothstep( uImpTo * 0.8, uImpTo * 1.1, impCam );
	// Past 200 m a wood's trees grow and sink: what a far wood loses to the ground and the
	// haze, without losing its mass (SrTrees §4).
	float impFar = clamp( ( impCam - ${WIDEN_FROM_M.toFixed(1)} ) / ${WIDEN_SPAN_M.toFixed(1)}, 0.0, 1.0 );
	impGrow *= 1.0 + ${WIDEN_SCALE.toFixed(1)} * impFar;
	vec3 transformed = impBase
		+ impRight * position.x * imp1.y * impGrow
		+ vec3( 0.0, position.y * imp1.z * impGrow - imp0.w - ${WIDEN_SINK_M.toFixed(1)} * impFar, 0.0 );
	// Nothing before the model hands over, and nothing past its own reach. Collapsed to the
	// foot rather than scaled away, so a hidden impostor is two degenerate triangles.
	if ( impCam < uImpFrom - uImpBand * 0.5 || impCam > impReach || imp1.y <= 0.0 ) transformed = impBase;
	vImpCam = impCam;
	vImpConifer = step( 3.5, impSpecies );
	vImpTint = impKeeper > 0.5 ? imp1.w - 10.0 : abs( imp1.w );
	vImpQuad = uv;
	// Which of the sixteen views the camera is nearest to, in the tree's own frame. Both
	// that view and the next are carried, and the FRAGMENT picks between them per texel —
	// a view chosen per vertex would be interpolated into a double image (SrTrees §4).
	float impSide = mod( ( atan( impTo.x, impTo.y ) - impYaw ) / 6.2832 * uImpViews, uImpViews );
	float impView0 = floor( impSide );
	vImpBlend = impSide - impView0;
	// The two atlases hold different row counts: the species picks both the row and the sheet.
	float impRows = mix( uImpRows.x, uImpRows.y, vImpConifer );
	float impRow = impSpecies - 4.0 * vImpConifer;
	// Top-down v, like every tree atlas (render/look/treeassets.ts): a species' row is a band
	// from the top of the sheet, and a cell's foot sits on the band's lower edge.
	vec2 impCell = vec2( ( impView0 + uv.x ) / uImpViews, ( impRow + 1.0 - uv.y ) / impRows );
	vec2 impNext = vec2( ( mod( impView0 + 1.0, uImpViews ) + uv.x ) / uImpViews, impCell.y );
	vImpUvA = impCell;
	vImpUvB = impNext;
	// Its own place in the wood, for the fade at its reach.
	float impHash = fract( sin( dot( impBase.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	float impGone = impReach * ( 0.7 + 0.3 * impHash );
	vImpFade = 1.0 - smoothstep( impGone - impReach * 0.12, impGone, impCam );
	// The hand-over, read from the same noise texture the models dither against
	// (render/look/treematerial.ts): what this keeps, that drops, and the other way round.
	vImpDissolve = clamp( ( impCam - ( uImpFrom - uImpBand * 0.5 ) ) / uImpBand, 0.0, 1.0 );
}
`;

/** The fragment stage: one view, one season pair, the same light as the model. */
const IMPOSTOR_FRAGMENT = /* glsl */ `
// The view this texel shows, shared with the normal block below.
vec2 impPickedUv;
${THREE.ShaderChunk.color_fragment}
{
	bool impConifer = vImpConifer > 0.5;
	// The view, per texel: closer than 300 m the switch is dithered in proportion, past
	// 600 m the pattern is finer than a pixel and the nearer view simply wins (SrTrees §4).
	float impDither = texture2D( uTreeNoise, vImpQuad * vec2( 21.32, 4.0 ) ).r;
	float impPickAt = mix( 0.5, vImpBlend, 1.0 - smoothstep( ${VIEW_DITHER_FROM_M.toFixed(1)}, ${VIEW_DITHER_TO_M.toFixed(1)}, vImpCam ) );
	impPickedUv = impDither < impPickAt ? vImpUvB : vImpUvA;
	vec4 imp = impConifer ? texture2D( uTreeConiferImposterA, impPickedUv ) : texture2D( uTreeImposterA, impPickedUv );
	if ( uTreeMix > 0.0 ) {
		// The pair is one crown in two paints, so a straight mix is one tree changing
		// colour; the per-leaf stagger the models get is invisible at this size.
		vec4 impB = impConifer ? texture2D( uTreeConiferImposterB, impPickedUv ) : texture2D( uTreeImposterB, impPickedUv );
		imp = mix( imp, impB, uTreeMix );
	}
	// Along with the models and never both: what this drops the model kept.
	float impDissolveNoise = fract( sin( dot( vImpQuad, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	if ( vImpDissolve < 1.0 && impDissolveNoise >= vImpDissolve ) discard;
	if ( imp.a < ${IMPOSTOR_CUT.toFixed(2)} ) discard;
	// The foot of a tree is darker than its crown: the atlas is unlit, so this is the one
	// shadow that has to be added, and the glow fades at the same rate (SrTrees §1c).
	float impFoot = 1.0 - 0.25 * clamp( ( 0.25 - vImpQuad.y ) / 0.08, 0.0, 1.0 );
	float impBlend = treeDistBlend( vImpCam ) * max( 0.5, impFoot );
	imp.rgb *= impFoot * impBlend * vImpTint;
	// One tree's own tint: the same function of the same world position the model uses, in
	// R and G for a deciduous tree and in G alone for a conifer (SrTrees §1).
	float impPatch = treeDiscolour( vImpWorld.xz );
	imp.rgb *= mix( vec3( 1.0, impPatch, 1.0 ), vec3( impPatch, impPatch, 1.0 ), 1.0 - vImpConifer );
	// Snow on the upper side of a bare crown, as on the models; a conifer's is in its atlas.
	vec3 impN = ( impConifer ? texture2D( uTreeConiferNormal, impPickedUv ) : texture2D( uTreeImposterNormal, impPickedUv ) ).xyz;
	imp.rgb = mix( imp.rgb, ${SNOW_GLSL} * 0.85, uTreeSnow * 0.75 * smoothstep( 0.15, 0.7, impN.y * 2.0 - 1.0 ) * ( 1.0 - vImpConifer ) );
	// Alpha lost to mip averaging, given back: a mipmapped cut-out thins and a far crown
	// shrinks otherwise, and the multisamples turn the alpha into coverage (SrTrees §1c).
	vec2 impTexel = impPickedUv / uImpTexel;
	float impMip = 0.5 * log2( max( max( dot( dFdx( impTexel ), dFdx( impTexel ) ), dot( dFdy( impTexel ), dFdy( impTexel ) ) ), 1.0 ) );
	diffuseColor = vec4( imp.rgb, imp.a * ( 1.0 + impMip * ${MIP_ALPHA_RESTORE.toFixed(2)} ) );
}
`;

const IMPOSTOR_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
	// The atlas' normals are the model's own, baked as the bake camera saw them: x to the
	// right of the quad, y up, z toward the viewer, so the quad turns them with itself
	// (SrTrees §1c).
	bool impConifer = vImpConifer > 0.5;
	vec3 impN = ( impConifer ? texture2D( uTreeConiferNormal, impPickedUv ) : texture2D( uTreeImposterNormal, impPickedUv ) ).xyz * 2.0 - 1.0;
	normal = normalize( ( viewMatrix * vec4( normalize( vImpRight * impN.x + vec3( 0.0, impN.y, 0.0 ) + vImpFwd * impN.z ), 0.0 ) ).xyz );
}
`;

const IMPOSTOR_LIGHT = /* glsl */ `
{
	// The same glow the models have, on the sunlit term only. A conifer has none (§1b).
	outgoingLight += reflectedLight.directDiffuse * treeGlow( diffuseColor.rgb, treeDistBlend( vImpCam ) ) * ( 1.0 - vImpConifer );
}
`;

/**
 * The impostor material. One material for both sheets: a tree's species is in its instance
 * data, so a wood of birches and spruces is one instanced draw per buffer chunk rather than
 * two, and which atlas a tree comes from is a branch in the shader.
 */
export function treeImpostorMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    // Coverage from the cut-out's own alpha: a far crown keeps its edge on the multisamples
    // and nothing has to be sorted (SrTrees §1c).
    alphaToCoverage: true,
  });
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, treeUniforms, impostorUniforms);
    injectSeason(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${IMPOSTOR_VERTEX_PRELUDE_GLSL}`)
      .replace('#include <beginnormal_vertex>', IMPOSTOR_VERTEX)
      .replace('#include <begin_vertex>', IMPOSTOR_VERTEX_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${IMPOSTOR_FRAGMENT_PRELUDE_GLSL}`)
      .replace('#include <map_fragment>', IMPOSTOR_FRAGMENT)
      .replace('#include <normal_fragment_maps>', IMPOSTOR_NORMAL)
      .replace('#include <opaque_fragment>', `${IMPOSTOR_LIGHT}\n#include <opaque_fragment>`);
  };
  // The world's light and the cloud field, as every tree and every ground material takes
  // them; a crown's shade is its own, so `shade` is zero.
  applyWorldLighting(material, { shade: '0.0' });
  applyCloudShadow(material);
  material.customProgramCacheKey = () => 'tree-impostor-v1';
  material.userData.tree = true;
  return material;
}
