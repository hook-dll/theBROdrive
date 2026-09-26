import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';

import { applyCloudShadow } from '../cloudshadow';
import { injectSeason, SNOW_GLSL } from '../season';
import { applyWorldLighting } from './lighting';
import { treeTexture, TREE_SHARED_FILES, type TreeAtlasGroup, type TreeLayout } from './treeassets';
import { TREE_COMMON_GLSL, TREE_SAMPLERS_GLSL, treeUniforms, TREE_LOD_BAND_M } from './treeglsl';

/**
 * THE TREES THEMSELVES: a model of about 170 vertices per species, and the three
 * multipliers that make a low-poly crown read as a tree with volume (SrTrees §1).
 *
 * WHY THE MODEL IS LOW-POLY. A crown is not geometry: it is a capsule the shader shades
 * the leaves against, a radial self-shadow, a per-leaf normal map and a glow. slowroads
 * draws a 135-180 vertex tree and it reads as a birch; our assets are the same shape, and
 * the pipeline rendered their sprites from a full-detail tree, so a card carries a few
 * leaves rather than one leaf-shaped blob.
 *
 * THE CARDS ARE CUT OUT BY THE ATLAS' ALPHA. The pipeline maps each card into a clump
 * cell whose sprite carries the module's own ragged leaf silhouette (the asset manifest's
 * `card_uvs`), so the shader never invents an outline: the cut-out is the sprite's own,
 * tested per fragment, and its threshold falls with distance so a mip-averaged crown does
 * not erode (SrTrees §1a).
 *
 * THE TRUNK IS FOLDED INTO THE BARK STRIP. The pipeline writes a stem vertex's uv in the
 * strip's own frame — u along the stem in wrap units, v one wrap around it — while a
 * card's uv is already in atlas space (see `treeassets.ts`). So a vertex the loader marked
 * as stem is folded into its species' column of the strip and a card is sampled as
 * authored; both then share one texture, one material and one draw.
 *
 * NO SHADOW MAP. The sun's shadow frustum is the car's and the tiles refuse the map, so a
 * tree neither casts nor receives: the forest sets `castShadow`/`receiveShadow` off, and a
 * wood's own shade on the ground is the ground's business (SrTrees §7).
 */

/** Where the crown's capsule is centred, and where the stem's own normal points from. */
const CROWN_CENTRE_Y = 4.6;
const TRUNK_CENTRE_Y = 7.0;
/** The radius inside which a leaf is in the crown's own shade, and where the shade ends. */
const CROWN_CORE_M = 2.83;
const CROWN_EDGE_M = 6.0;
/** How much of the direct sun the crown's core keeps: half, as slowroads does. */
const CORE_SUN = 0.5;
/** Needles lose up to this share of their light toward the axis (SrTrees §1b). */
const CONIFER_SHADE = 0.65;
/** A stand's density, as the conifer's shadow cone and its bark read it (SrTrees §1b). */
const CONIFER_DENSITY = 0.4;
/** How much of the pipeline's per-vertex bake reaches the albedo, per group. */
const TREE_COL_DECIDUOUS = 1;
const TREE_COL_CONIFER = 0;

/** The vertex body: everything the crown's shading needs that is a function of position. */
const CROWN_VERTEX_BODY = /* glsl */ `
#include <begin_vertex>
{
	#ifdef USE_INSTANCING
		mat4 treeInstance = instanceMatrix;
	#else
		mat4 treeInstance = mat4( 1.0 );
	#endif
	mat4 treeObject = modelMatrix * treeInstance;
	vTreeWorld = ( treeObject * vec4( position, 1.0 ) ).xyz;
	vTreeView = ( viewMatrix * vec4( vTreeWorld, 1.0 ) ).xyz;
	vTreeDist = length( vTreeWorld.xz - cameraPosition.xz );
	vTreeCol = aTreeCol;
	// The tree's own tint, from the instanced colour three binds when the mesh has one:
	// three's own color_fragment chunk only reads it when the material is in vertex-colour
	// mode, and this material's vertex colours are the pipeline's bake and not a colour, so
	// the tint is carried and applied by hand instead.
	#ifdef USE_INSTANCING_COLOR
		vTreeTint = instanceColor;
	#else
		vTreeTint = vec3( 1.0 );
	#endif
	// THE MODEL'S UV IS ATLAS UV, AND NOTHING IS RE-MAPPED HERE. A crown card points into
	// its species' clump cells and a stem into its species' column of the bark strip (the
	// asset manifest's "card_uvs"); both are authored in the atlas' own space by the
	// exporter, so the shader samples what it was given. All it has to know is where in a
	// column the strip ends: below that v every texel is bark, above it every texel is a
	// card, and the crown's shading treats the two differently.
	vTreeUv = uv;
	// A column's texels are cards down to the bark strip and bark below it, in the top-down
	// v the atlas is read in (render/look/treeassets.ts).
	vTreeLeaf = 1.0 - step( uTreeBarkFrom, uv.y );
	// The crown's volume: a capsule whose sphere sits at 4.6 m, and the stem's own normal
	// pointing down out of the trunk, which is what leaves a trunk under a canopy dark
	// (SrTrees §1a).
	float treeCy = min( position.y, ${CROWN_CENTRE_Y.toFixed(1)} );
	vec3 treeCentre = mix( vec3( 0.0, ${TRUNK_CENTRE_Y.toFixed(1)}, 0.0 ), vec3( 0.0, treeCy, 0.0 ), vTreeLeaf );
	vec3 treeNc = normalize( position - treeCentre + vec3( 0.0, 1e-4, 0.0 ) );
	vTreeNc = normalize( normalMatrix * ( mat3( treeInstance ) * treeNc ) );
	vTreeUp = ( mat3( treeObject ) * treeNc ).y;
	// How deep in the crown a leaf sits: 1 inside 2.8 m of the axis, 0 past 6 m, and
	// always darker near the foot. This is the whole of the crown's self-shadow.
	vec2 treeRadial = position.xz;
	float treeD2 = dot( treeRadial, treeRadial ) + ( position.y - treeCy ) * ( position.y - treeCy );
	float treeCore = 1.0 - clamp( ( treeD2 - ${(CROWN_CORE_M * CROWN_CORE_M).toFixed(1)} ) / ${(CROWN_EDGE_M * CROWN_EDGE_M - CROWN_CORE_M * CROWN_CORE_M).toFixed(1)}, 0.0, 1.0 );
	vTreeShadow = max( treeCore, 1.0 - clamp( position.y / 8.0, 0.0, 1.0 ) );
}
`;

/** A conifer: the cone IS the normal, and its shadow is a cone of its own. */
const CONIFER_VERTEX_EXTRA = /* glsl */ `
{
	// Nothing a card's normal says survives: a whorl is a cone, and its normal tilts
	// further up toward the top, so the spire catches the sun and the skirts stay dark.
	float treePitch = max( 0.5, 1.5 * clamp( position.y / 12.0, 0.0, 1.0 ) );
	vec3 treeCone = normalize( vec3( position.x, treePitch * length( position.xz ), position.z ) );
	treeCone = mix( normalize( vec3( position.x, 1.0, position.z ) ), treeCone, vTreeLeaf );
	#ifdef USE_INSTANCING
		vTreeNc = normalize( normalMatrix * ( mat3( instanceMatrix ) * treeCone ) );
	#else
		vTreeNc = normalize( normalMatrix * treeCone );
	#endif
	// The shadow cone: a radius that narrows with height, so the inner needles are up to
	// two thirds darker and the tips are not. The stem of a conifer keeps most of it.
	float treeHeight = clamp( position.y / 12.0, 0.0, 1.0 );
	float treeRadius = ( 2.5 + ${CONIFER_DENSITY.toFixed(1)} ) * max( 0.1, 1.0 - treeHeight );
	float treeConeShade = ( treeRadius - length( position.xz ) ) * 0.75;
	vTreeShadow = mix( ${(0.7 + 0.3 * CONIFER_DENSITY).toFixed(2)}, treeConeShade, vTreeLeaf );
}
`;

const DECIDUOUS_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
	// The atlas' per-clump normals, in the card's own frame: a card carries no tangents, so
	// the frame comes from the screen-space derivatives of the card's own uv — the
	// construction three's tangent-less path uses, on the card's own normal.
	vec3 treeMapN = texture2D( uTreeNormal, vTreeUv ).xyz * 2.0 - 1.0;
	if ( treeDbgBit( 4.0 ) > 0.5 ) treeMapN.y = -treeMapN.y;
	vec3 treeDp1 = dFdx( vTreeView );
	vec3 treeDp2 = dFdy( vTreeView );
	vec2 treeDu1 = dFdx( vTreeUv );
	vec2 treeDu2 = dFdy( vTreeUv );
	vec3 treeTangent = normalize( treeDp1 * treeDu2.y - treeDp2 * treeDu1.y );
	vec3 treeBitangent = normalize( cross( normal, treeTangent ) );
	normal = normalize( treeTangent * treeMapN.x + treeBitangent * treeMapN.y + normal * treeMapN.z );
	if ( treeDbgBit( 8.0 ) > 0.5 ) normal = normalize( vTreeNc );
}
`;

const CONIFER_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
	normal = normalize( vTreeNc );
}
`;

/** The albedo: the season's pair, the pipeline's bake, the tint, the cut-out, the dissolve. */
function crownFragment(leafShade: string, cut: string): string {
  return /* glsl */ `
${THREE.ShaderChunk.color_fragment}
{
	vec4 treeTex = treeTexel( uTreeAtlasA, vTreeUv );
	treeDbgAlbedo = treeTex.rgb;
	float treeTurn = fract( sin( dot( vTreeUv, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	float treeSeason = treeSeasonMix( treeTurn );
	if ( uTreeMix > 0.0 ) {
		// Which leaf changes when: a card turns at its own point of the mix, so autumn
		// arrives a few leaves at a time rather than as a wash of olive.
		treeTex = mix( treeTex, treeTexel( uTreeAtlasB, vTreeUv ), treeSeason );
	}
	${cut}
	treeTex.rgb *= vTreeTint * mix( vec3( 1.0 ), vTreeCol, uTreeColWeight );
	// One tree's leaves differ from its neighbour's in R and G only, and only on the
	// leaves, about a 250 m patch (SrTrees §1).
	treeTex.rgb.rg *= mix( 1.0, treeDiscolour( vTreeWorld.xz ), vTreeLeaf );
	${leafShade}
	// Snow on the upper side of a bare crown: the winter atlas is branches, and snow lies
	// on them as it lies on the ground. A conifer's snow is in its own winter atlas.
	treeTex.rgb = mix( treeTex.rgb, ${SNOW_GLSL} * 0.85, uTreeSnow * 0.75 * smoothstep( 0.15, 0.7, vTreeUp ) * vTreeLeaf );
	treeTex.rgb *= treeDistBlend( vTreeDist );
	// A cut-out read through mips erodes: the test falls with distance instead.
	if ( treeTex.a < treeAlphaCut( vTreeDist, uTreeModelTo ) ) discard;
	// The hand-over: one test against the noise, over the last stretch of the model
	// range, and the impostor keeps exactly what this drops (render/look/treeimpostor.ts).
	// The noise is read at the card's own uv, so a leaf's dither does not crawl.
	float treeDissolve = clamp( ( vTreeDist - ( uTreeModelTo - ${TREE_LOD_BAND_M.toFixed(1)} ) ) / ${TREE_LOD_BAND_M.toFixed(1)}, 0.0, 1.0 );
	if ( treeDissolve > 0.0 && texture2D( uTreeNoise, vTreeUv ).r < treeDissolve ) discard;
	diffuseColor = vec4( treeTex.rgb, 1.0 );
}
`;
}

const DECIDUOUS_LIGHT = /* glsl */ `
{
	// The crown capsule against the sun: twice as steep as a Lambert terminator and never
	// below a quarter, so the shaded side keeps its form (SrTrees §1a).
	float treeSun = 1.0;
	#if NUM_DIR_LIGHTS > 0
		treeSun = clamp( 2.0 * dot( directionalLights[ 0 ].direction, normalize( vTreeNc ) ), 0.25, 1.0 );
	#endif
	float treeShade = clamp( vTreeShadow, 0.0, 1.0 );
	float treeBlend = treeDistBlend( vTreeDist );
	reflectedLight.directDiffuse *= treeSun * ( 1.0 - ${CORE_SUN.toFixed(2)} * treeShade ) * treeBlend;
	// Half the sky in the core of a crown, and a little more than the sky on its rim.
	reflectedLight.indirectDiffuse *= 1.5 - treeShade;
	// Radiant sunlit leaves: R and G blow out, B barely moves, and it rides the direct light
	// alone, so nothing glows in shade or after sunset. LEAVES ONLY — the same bake gives a
	// white birch's bark rg = 1, and a glow on the stem was a row of lit posts down the road.
	outgoingLight += reflectedLight.directDiffuse * treeGlow( diffuseColor.rgb, treeBlend ) * vTreeLeaf;
	if ( treeDbgBit( 1.0 ) > 0.5 ) outgoingLight = treeDbgAlbedo;
}
`;

const CONIFER_LIGHT = /* glsl */ `
{
	// The sun twice: once through the cone's own Lambert term, once as the tilt of the
	// needle against it, which is the "severe" split the reference has (SrTrees §1b).
	float treeSun = 1.0;
	#if NUM_DIR_LIGHTS > 0
		treeSun = max( 0.0, dot( directionalLights[ 0 ].direction, normalize( normal ) ) );
	#endif
	reflectedLight.directDiffuse *= treeSun * treeDistBlend( vTreeDist );
	// The needles' own shade barely reaches the sky: the cone is dark inside, not dim.
	reflectedLight.indirectDiffuse *= 1.0 - max( 0.0, treeNeedleShadow() - 0.6 );
	if ( treeDbgBit( 1.0 ) > 0.5 ) outgoingLight = treeDbgAlbedo;
}
`;

const NEEDLE_SHADE = /* glsl */ `
/** How much of its light a conifer's needle has lost to the crown around it. */
float treeNeedleShadow() {
	return sqrt( clamp( vTreeShadow, 0.0, 1.0 ) ) * ${CONIFER_SHADE.toFixed(2)};
}
`;

interface CrownGroup {
  readonly group: TreeAtlasGroup;
  /** The alpha the cut-out is read from: the deciduous atlas carries it, a conifer has its own. */
  readonly alpha: 'atlas' | 'map';
  readonly vertexExtra: string;
  readonly normal: string;
  readonly leafShade: string;
  readonly light: string;
  readonly colourWeight: number;
  /** Extra samplers and helpers the fragment needs. */
  readonly fragmentExtra: string;
  readonly cacheKey: string;
}

const DECIDUOUS: CrownGroup = {
  group: 'deciduous',
  alpha: 'atlas',
  vertexExtra: '',
  normal: DECIDUOUS_NORMAL,
  leafShade: '',
  light: DECIDUOUS_LIGHT,
  colourWeight: TREE_COL_DECIDUOUS,
  fragmentExtra: '',
  cacheKey: 'tree-deciduous-v1',
};

const CONIFER: CrownGroup = {
  group: 'conifer',
  alpha: 'map',
  vertexExtra: CONIFER_VERTEX_EXTRA,
  normal: CONIFER_NORMAL,
  leafShade: 'treeTex.rgb *= 1.0 - treeNeedleShadow();',
  light: CONIFER_LIGHT,
  colourWeight: TREE_COL_CONIFER,
  fragmentExtra: NEEDLE_SHADE,
  cacheKey: 'tree-conifer-v1',
};

/** The one attribute a model carries beyond position, normal and uv: the pipeline's bake. */
const CROWN_ATTRIBUTES = /* glsl */ `
attribute vec3 aTreeCol;
`;

/** What the crown's own maths needs, as uniforms: not the sheen, that is the world's. */
const CROWN_UNIFORMS = /* glsl */ `
uniform float uTreeBarkFrom;
uniform float uTreeColWeight;
`;

const CROWN_VARYINGS = /* glsl */ `
varying vec2 vTreeUv;
varying vec3 vTreeTint;
varying vec3 vTreeCol;
varying vec3 vTreeWorld;
varying vec3 vTreeView;
varying vec3 vTreeNc;
varying float vTreeLeaf;
varying float vTreeShadow;
varying float vTreeDist;
varying float vTreeUp;
`;

/** The vertex stage's declarations: attributes, uniforms and the shared functions. */
const CROWN_VERTEX_PRELUDE_GLSL = `${CROWN_ATTRIBUTES}${CROWN_UNIFORMS}${CROWN_VARYINGS}${TREE_COMMON_GLSL}`;

/** The fragment's: the same, plus the samplers and without the attributes. */
const CROWN_FRAGMENT_PRELUDE_GLSL = `${TREE_SAMPLERS_GLSL}${CROWN_UNIFORMS}${CROWN_VARYINGS}${TREE_COMMON_GLSL}
vec3 treeDbgAlbedo;
`;

/** The albedo, with the conifer's own cut-out folded in before the test. */
function groupFragment(spec: CrownGroup): string {
  const cut =
    spec.alpha === 'atlas'
      ? '// The atlas\' own alpha carries the cut-out of a deciduous crown.'
      : `	// A conifer's cut-out is its own greyscale map, in its own season's file.
	float treeAlpha = treeTexel( uTreeConiferAlphaA, vTreeUv ).r;
	if ( uTreeMix > 0.0 ) treeAlpha = mix( treeAlpha, treeTexel( uTreeConiferAlphaB, vTreeUv ).r, treeSeason );
	treeTex.a = treeAlpha;`;
  return crownFragment(spec.leafShade, cut);
}

/**
 * One crown material: a deciduous tree's cards or a conifer's whorls. `MeshStandardMaterial`
 * underneath, so the sun, the sky, the cloud field, the fog and the tone curve keep
 * working, and patched with the world's lighting before this module's own hook so the
 * crown's masks scale the direct light the world then boosts.
 */
function crownMaterial(spec: CrownGroup, layout: TreeLayout): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    // Coverage, not blending: a crown's edge gets the multisamples, and the hand-over to
    // the impostor needs neither sorting nor an alpha stack (SrTrees §1c).
    alphaToCoverage: true,
  });
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, treeUniforms, {
      uTreeBarkFrom: { value: layout.barkFromV[spec.group] },
      uTreeColWeight: { value: spec.colourWeight },
    });
    // The season goes in last: `injectSeason` consumes the `#include <common>` line the
    // other patches hang their declarations off.
    injectSeason(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CROWN_VERTEX_PRELUDE_GLSL}`)
      .replace('#include <begin_vertex>', `${CROWN_VERTEX_BODY}\n${spec.vertexExtra}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CROWN_FRAGMENT_PRELUDE_GLSL}\n${spec.fragmentExtra}`)
      .replace('#include <map_fragment>', groupFragment(spec))
      .replace('#include <normal_fragment_maps>', spec.normal)
      .replace('#include <opaque_fragment>', `${spec.light}\n#include <opaque_fragment>`);
  };
  // The world's own lighting patches this, `shade` left at zero: a crown's shade is its
  // own capsule, computed above, and not something baked into its vertices.
  applyWorldLighting(material, { shade: '0.0' });
  applyCloudShadow(material);
  material.customProgramCacheKey = () => spec.cacheKey;
  material.userData.tree = true;
  return material;
}

export function deciduousTreeMaterial(layout: TreeLayout): THREE.MeshStandardMaterial {
  return crownMaterial(DECIDUOUS, layout);
}

export function coniferTreeMaterial(layout: TreeLayout): THREE.MeshStandardMaterial {
  return crownMaterial(CONIFER, layout);
}

/**
 * The floor of the wood: stumps and fallen trunks, one photographed scan atlas between
 * them, lit by the world's light and with the season's snow on top. Not a crown — no
 * capsule, no glow — and small enough to be drawn whole.
 */
export function stumpMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: treeTexture('stump.webp', true),
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    injectSeason(shader);
  };
  applyWorldLighting(material, { shade: '0.0' });
  applyCloudShadow(material);
  material.customProgramCacheKey = () => 'tree-stump-v1';
  material.userData.tree = true;
  return material;
}
