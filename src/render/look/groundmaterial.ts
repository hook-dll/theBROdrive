import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';

import { applyCloudShadow } from '../cloudshadow';
import { injectSeason, SNOW_GLSL } from '../season';
import type { LookPalette } from '../../world/look/palette';
import { GROUND_COLOR_GLSL, GROUND_SCALE, groundColourUniforms, setGroundColours } from './groundcolor.glsl';
import { groundTextures, type GroundTextureName } from './groundtextures';
import { applyWorldLighting } from './lighting';

/**
 * THE GROUND — tiles, vista and everything else that is bare earth — as one shader.
 *
 * WHAT IT IS. Four photographs, twelve masks and one colour function stacked in the
 * order a walker would meet them: meadow, the field that took the meadow's place, the
 * litter under a wood, the peat of a bog, the silt of a shore, the rock of a cutting,
 * the gravel of the verge, and the snow that lies on all of them in winter. Each layer
 * is BLENDED IN, not pasted on: the weight comes from a per-vertex attribute the
 * generator computed (world/groundattrs.ts), and the EDGE of that weight comes from the
 * layer's own height channel (see `groundHeightBlend` in groundcolor.glsl.ts), which is
 * what turns a field margin or a wood's edge into a ragged line decided by the
 * photograph rather than by a smoothstep in the outline of the triangle under it.
 *
 * WHAT IT REPLACED. The comic ground (banded light, strata contours, ink stipple), the
 * procedural paint of `render/groundpaint.ts` and a CPU vertex colour produced by the
 * land cover. Those three were built for a desert whose problem was that a correct dune
 * looked like nothing; a meadow has the opposite problem, and the answer to it is not
 * more ink but a photograph, four colours and noise.
 *
 * LIGHT. The tiles are stock `MeshStandardMaterial`s carrying the world lighting patch
 * (render/look/lighting.ts): Lambert from the real sun, the grazing sheen that draws the
 * velvet on a far hillside, the sunlit radiance term and the baked forest shade — which
 * is now the wood's own density in a vertex attribute, so a forest floor is dark because
 * the sun does not reach it and not because something painted it dark.
 *
 * TWO VARIANTS, ONE LOOK. `tile` is the near lattice: the 7 m blade photograph, the
 * 100 m speckle and the verge gravel. `vista` is the same look at 200 m and beyond,
 * where three of those have died of their own minification — a 7 m photograph seen from
 * a kilometre away IS its own mean — so the vista passes that mean as a constant and
 * skips the fetch. It is the same shader with three terms substituted, never a second
 * look, which is what keeps the seam between the two systems invisible.
 */

/**
 * Where the tiles hand their small-scale height over to the vista, metres from the
 * camera. The tile shader removes `aTerrainDetail` over this band, so the detail a 3 m
 * lattice carries and a 250 m one cannot never lifts the near surface above the far one
 * and draws a step across the boundary.
 */
export const GROUND_DETAIL_FADE_FULL = 300;
export const GROUND_DETAIL_FADE_GONE = 1000;

/**
 * What the near speckle mask averages to. The vista draws from two hundred metres out,
 * where a 20 cm speckle is many pixels to a texel: what the sampler would return IS the
 * mask's own mean, and passing it costs one less fetch than asking for it.
 */
const DETAIL_NEAR_MEAN = 0.86;

/** Gains that make a photograph's own mean the palette's colour. See the body below. */
const GRASS_GAIN = 1 / 0.214;
const GRASS_SNOW_GAIN = 1 / 0.473;
/** Litter is dark under a canopy; this is what keeps a wood's floor readable in shade. */
const FOREST_GAIN = 1.7;
/**
 * Plastic gains on the photographed layers, one per file, all of them the same kind of
 * number: a bare-plough albedo really is low (0.05-0.15 in linear light), but a field of
 * it under a low autumn sun is not a hole in the frame, and the first pass had exactly
 * that problem. These bring each layer's MEAN to what the palette asks for, so the
 * palette keeps deciding the colour and only the exposure of the photograph is corrected.
 */
const SOIL_GAIN = 1.9;
const GRAVEL_GAIN = 1.35;
const SHORE_GAIN = 1.35;
const ROCK_GAIN = 1.35;
/** Peat stays dark — a mire is dark — but muddy ground is earth, not a shadow. */
const PEAT_GAIN = 1.15;

export type GroundMaterialKind = 'tile' | 'vista';

/**
 * Attribute names shared with the generators. The tile lattice and the vista's worker
 * both write exactly these, and a mismatch is a silently wrong picture rather than an
 * error — so they are declared once, here, beside the shader that reads them.
 */
export const GROUND_ATTRIBUTES = {
  /** vec4: meadow lushness, wood density (the baked shade), crop class, crop inside-plot. */
  cover: 'aCover',
  /** vec4: wetness, peat, shore silt, rock (from the normal's slope). */
  aux: 'aGroundAux',
  /** vec3: field-local u and v in metres (the furrow frame), and the field's own tint. */
  field: 'aField',
  /** vec2: verge gravel weight, signed distance past the asphalt edge in metres. */
  road: 'aRoad',
  /** float: small-scale height the tile shader fades out (tiles only). */
  detail: 'aTerrainDetail',
  /** vec4: a far wood's crown colour, its height, and the ramp to paint it by (vista only). */
  canopy: 'aCanopy',
} as const;

const textureUniform = (name: GroundTextureName): string =>
  `uGroundTex${name[0]!.toUpperCase()}${name.slice(1)}`;

/**
 * The four forest floors, in `SEASON_ORDER`: bound to ONE PAIR of samplers rather than
 * declared as four. The palette names the two heavy seasons of the moment
 * (`LookPalette.groundForestA/B`) and `setGroundLook` points the pair at them once a
 * frame, so a transition between two litters costs two fetches and not four.
 */
const FOREST_SEASONS: readonly GroundTextureName[] = [
  'forestSpring', 'forestSummer', 'forestAutumn', 'forestWinter',
];

/**
 * THE SAMPLER BUDGET, and why these lists are short.
 *
 * The fragment stage has 16 texture units on this device and three spends two of them on
 * the shadow map and the environment, so a material can have fourteen. A ground layer per
 * photograph with one sampler each took eighteen and the shader would not link at all —
 * which is what forced the three decisions below rather than a taste for small shaders:
 *
 *  - the four forest floors are one PAIR, rebound per frame (see `FOREST_SEASONS`);
 *  - `rock.webp`'s own alpha IS the crack map `rock_height.webp` carries, so the height
 *    comes out of the colour fetch and the separate mask is not bound at all;
 *  - the two terms that exist only as a distance substitution — the blade photograph and
 *    the near speckle on the vista — are not declared by the vista at all, and the winter
 *    far-detail mask is left out even on the tiles: what it added was streak structure
 *    under snow, and the snow albedo blend already carries that.
 */
const NEAR_TEXTURES: readonly GroundTextureName[] = [
  'grass', 'grassSnow', 'soil', 'peat', 'gravel', 'rock', 'shore',
  'noiseFine', 'noiseVariation', 'detailNear', 'detailFar',
];
const FAR_TEXTURES: readonly GroundTextureName[] = [
  'soil', 'peat', 'rock', 'shore', 'noiseFine', 'noiseVariation', 'detailFar',
];

const FOREST_A = 'uGroundTexForestA';
const FOREST_B = 'uGroundTexForestB';

/** Bound by hand each frame; declared always, because both variants draw a wood. */
const forestA: THREE.IUniform = { value: null as unknown as THREE.Texture };
const forestB: THREE.IUniform = { value: null as unknown as THREE.Texture };
const forestMix: THREE.IUniform = { value: 0 };

/**
 * The frame's ground look: the palette's colours, and the two forest photographs the
 * season is between. Called once a frame from the sky, beside `setWorldLighting`.
 */
export function setGroundLook(palette: LookPalette): void {
  setGroundColours(palette);
  const textures = groundTextures();
  forestA.value = textures[FOREST_SEASONS[palette.groundForestA] ?? 'forestSummer'];
  forestB.value = textures[FOREST_SEASONS[palette.groundForestB] ?? 'forestSummer'];
  forestMix.value = palette.groundForestMix;
}

/** Every sampler this variant declares, as a uniform, and its declaration text. */
function samplers(kind: GroundMaterialKind): { uniforms: Record<string, THREE.IUniform>; glsl: string } {
  const textures = groundTextures();
  const uniforms: Record<string, THREE.IUniform> = {};
  const declared = kind === 'tile' ? NEAR_TEXTURES : FAR_TEXTURES;
  for (const name of declared) uniforms[textureUniform(name)] = { value: textures[name] };
  // A sensible pair before the first frame's `setGroundLook`: summer over summer.
  if (forestA.value === null) {
    forestA.value = textures.forestSummer;
    forestB.value = textures.forestSummer;
  }
  uniforms[FOREST_A] = forestA;
  uniforms[FOREST_B] = forestB;
  uniforms.uGroundForestMix = forestMix;
  const glsl = [...declared.map((name) => textureUniform(name)), FOREST_A, FOREST_B]
    .map((name) => `uniform sampler2D ${name};`)
    .join('\n')
    + '\nuniform float uGroundForestMix;';
  return { uniforms, glsl };
}

/** Puts a material's depth just inside the far plane, in front of the sky dome's. */
function farDepthOnly<T extends THREE.Material>(material: T): T {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\ngl_Position.z = gl_Position.w * 0.99999;',
    );
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:far-depth`;
  return material;
}

const n = (value: number): string => value.toFixed(4);

/** The canopy blanket's radii, mirrored from world/vistaground.ts. */
const CANOPY_FROM = 4185.0;
const CANOPY_FULL = 4860.0;
/** A wood's crown height at which the blanket paints its colour rather than merely rising. */
const CANOPY_PAINT_M = 5.0;

/** The vertex stage: attribute plumbing, the canopy raise and the detail hand-over. */
function vertexPrelude(vista: boolean, detail: boolean): string {
  return `#include <common>
attribute vec4 ${GROUND_ATTRIBUTES.cover};
attribute vec4 ${GROUND_ATTRIBUTES.aux};
attribute vec3 ${GROUND_ATTRIBUTES.field};
attribute vec2 ${GROUND_ATTRIBUTES.road};
${detail ? `attribute float ${GROUND_ATTRIBUTES.detail};` : ''}
${vista ? `attribute vec4 ${GROUND_ATTRIBUTES.canopy};` : ''}
varying vec3 vGroundWorld;
varying vec4 vGroundCover;
varying vec4 vGroundAux;
varying vec3 vGroundField;
varying vec2 vGroundRoad;
${vista ? 'varying vec4 vCanopy;' : ''}
`;
}

function vertexBody(vista: boolean, detail: boolean): string {
  return `vec3 transformed = vec3( position );
${detail
  ? `float groundDetailFade = smoothstep( ${n(GROUND_DETAIL_FADE_FULL)}, ${n(GROUND_DETAIL_FADE_GONE)}, length( ( modelMatrix * vec4( position, 1.0 ) ).xz - cameraPosition.xz ) );
transformed.y -= ${GROUND_ATTRIBUTES.detail} * groundDetailFade;`
  : ''}
${vista
  ? `// The canopy blanket: past the far woods' reach a closed wood is the ground raised to
// the height of its crowns and painted their colour. The ramp is the same one the near
// tiles and the impostors use, so nothing appears or vanishes at the hand-over.
float groundCanopyRamp = smoothstep( ${n(CANOPY_FROM)}, ${n(CANOPY_FULL)}, length( ( modelMatrix * vec4( position, 1.0 ) ).xz - cameraPosition.xz ) );
vCanopy = vec4( ${GROUND_ATTRIBUTES.canopy}.rgb, groundCanopyRamp * min( 1.0, ${GROUND_ATTRIBUTES.canopy}.w / ${n(CANOPY_PAINT_M)} ) );
transformed.y += ${GROUND_ATTRIBUTES.canopy}.w * groundCanopyRamp;`
  : ''}
vec4 groundWorld = modelMatrix * vec4( transformed, 1.0 );
vGroundWorld = groundWorld.xyz;
vGroundCover = ${GROUND_ATTRIBUTES.cover};
vGroundAux = ${GROUND_ATTRIBUTES.aux};
vGroundField = ${GROUND_ATTRIBUTES.field};
vGroundRoad = ${GROUND_ATTRIBUTES.road};
`;
}

/** The fragment body: every layer, in the order a walker would meet them. */
function fragmentBody(near: boolean): string {
  return `{
vec2 gdW = vGroundWorld.xz;
float gdView = length( vViewPosition );

// --- The noise fields. The 7 m and the 100 m ones pick between the meadow's two tones,
// the 500 m and 2 km ones are the patch map — the "this part of the country is not that
// part" the eye reads at a glance — and the 4 km one says how pale and high the ground
// is.
float gdVariation = texture2D( ${textureUniform('noiseVariation')}, gdW / ${n(GROUND_SCALE.fade2000)} ).r - 0.5;
float gdCloseVar = ( 1.0 - texture2D( ${textureUniform('noiseVariation')}, gdW / ${n(GROUND_SCALE.fade500)} ).r ) - 0.5;
float gdFade100 = texture2D( ${textureUniform('noiseFine')}, gdW / ${n(GROUND_SCALE.fade100)} ).r;
float gdFade500 = texture2D( ${textureUniform('noiseFine')}, gdW / ${n(GROUND_SCALE.fade500)} ).r;
float gdFade4000 = texture2D( ${textureUniform('noiseFine')}, gdW / ${n(GROUND_SCALE.fade4000)} ).r;
${near
  ? `float gdFade7 = texture2D( ${textureUniform('noiseFine')}, gdW / ${n(GROUND_SCALE.fine)} ).r;`
  : `float gdFade7 = 0.5;`}

float gdLush = vGroundCover.x;
float gdForest = vGroundCover.y;
float gdWet = vGroundAux.x;
float gdSnow = seasonSnowAt( gdForest, seasonPatch( gdW ) );

// --- The meadow. \'lightGrass\' is slowroads' altitudinal paleness, scaled back hard
// right beside the road, because a gravel verge fringed with straw-coloured grass is the
// one place the eye stands close enough to catch the lie.
float gdHeightVal = clamp( ( vGroundWorld.y - ( 30.0 + gdFade4000 * 40.0 ) ) / 150.0, 0.0, 1.0 );
float gdLight = min( 1.0, gdHeightVal * ( gdFade500 + gdHeightVal * 0.5 ) );
float gdDark = clamp( ( gdFade100 - 0.25 ) * 2.0, 0.0, 1.0 );
gdLight *= max( 0.25, max( 0.0, vGroundRoad.y ) / ( 0.5 + gdFade7 ) );

vec3 gdGrassTex;
${near
  ? `gdGrassTex = texture2D( ${textureUniform('grass')}, gdW / ${n(GROUND_SCALE.grass)} ).rgb * ${n(GRASS_GAIN)};
// Winter is the same sward under snow: its own photograph, normalised to the same mean
// so the palette's winter colours set the level rather than the file's exposure.
if ( gdSnow > 0.01 ) {
  gdGrassTex = mix( gdGrassTex, texture2D( ${textureUniform('grassSnow')}, gdW / ${n(GROUND_SCALE.grass)} ).rgb * ${n(GRASS_SNOW_GAIN)}, gdSnow );
}`
  : `// The blade photograph is fully mip-averaged well inside the vista's first ring, and
// the gain above is its own mean, so the layer is exactly 1.0 there — winter and summer
// alike. What is left at this distance is the colour.
gdGrassTex = vec3( 1.0 );`}
vec3 gdCol = groundGrassTint( gdFade7, gdFade100, gdVariation, gdCloseVar, gdLight, gdDark, gdGrassTex.r ) * gdGrassTex;

// --- A field: standing crop, harvested stubble or bare ploughland, one crop and one
// tint per plot, furrows along the plot's own axis. The stripes are traced with the
// derivative of their own phase so they dissolve rather than alias: at two hundred
// metres a 3 m furrow is a flat colour, which is what the eye sees there anyway.
float gdBand = vGroundField.y * ( 6.2831853 / 3.2 );
float gdStripe = mix( 0.5, 0.5 + 0.5 * sin( gdBand ), 1.0 - smoothstep( 0.45, 1.2, max( fwidth( gdBand ), 1e-4 ) ) );
float gdPlot = vGroundCover.w;
float gdCropClass = vGroundCover.z * 8.0 - 1.0;
if ( gdPlot > 0.004 && gdCropClass >= -0.5 ) {
  int gdCrop = int( clamp( gdCropClass, 0.0, 6.0 ) + 0.5 );
  vec3 gdCropCol;
  float gdCropHeight;
  if ( gdCrop == 3 ) {
    // PLOUGHLAND is the soil photograph with its own clods, and the furrows are the stripe:
    // bare earth is bright grey-brown in the reference frames, and a field of it read flat
    // because the furrow modulation was three per cent on a photograph that mips away by a
    // hundred metres. Both are stronger here.
    vec4 gdSoil = texture2D( ${textureUniform('soil')}, gdW / ${n(GROUND_SCALE.soil)} );
    gdCropCol = gdSoil.rgb * uGroundSoil * ${n(SOIL_GAIN)} * ( 0.74 + 0.52 * gdStripe );
    gdCropHeight = gdSoil.a;
  } else if ( gdCrop == 2 ) {
    // A harvested field IS the meadow's straw: short stubs of the same plant, so it takes
    // the blade photograph under the stubble colour and the soil's clods underneath it.
    vec4 gdSoil = texture2D( ${textureUniform('soil')}, gdW / ${n(GROUND_SCALE.soil)} );
    gdCropCol = mix( gdSoil.rgb * uGroundSoil * ${n(SOIL_GAIN)}, gdGrassTex.rgb * uGroundStubble * 1.05, 0.55 );
    gdCropHeight = mix( gdSoil.a, gdGrassTex.r, 0.55 );
  } else {
    // A standing crop has no photograph of its own: it is the meadow's own blade
    // luminance under the crop's colour, which is also why a field of rye reads at four
    // hundred metres.
    gdCropCol = uGroundCrops[ gdCrop ];
    gdCropHeight = gdGrassTex.r;
  }
  gdCropCol *= ( 0.9 + 0.2 * gdStripe ) * ( 1.0 + vGroundField.z * 0.12 );
  gdCropCol += uGroundFieldTint * ( 0.09 * vGroundField.z );
  gdCol = groundHeightBlend( gdCol, gdGrassTex.r, gdCropCol, gdCropHeight, gdPlot, 0.06 );
}

// --- The litter under a wood. Four photographs, of which at most two are ever in play:
// the channel that turns the leaves and the one that drops them are two halves of one
// transition, so autumn's floor is mixed over summer's and winter's over autumn's, and
// a season costs one fetch rather than four.
// ONLY UNDER A WOOD. the cover's own forest density includes the birch coming up on fallow plots, and a
// floor of needle litter painted at any density at all turned a hillside of meadow into
// leaf mould — the reference's meadows are grass with the litter at the wood's edge.
float gdLitter = smoothstep( 0.18, 0.65, gdForest );
if ( gdLitter > 0.02 ) {
  vec4 gdFloorTex = texture2D( ${FOREST_A}, gdW / ${n(GROUND_SCALE.forest)} );
  if ( uGroundForestMix > 0.01 ) gdFloorTex = mix( gdFloorTex, texture2D( ${FOREST_B}, gdW / ${n(GROUND_SCALE.forest)} ), uGroundForestMix );
  gdCol = groundHeightBlend( gdCol, 1.0, gdFloorTex.rgb * uGroundForest * ${n(FOREST_GAIN)}, gdFloorTex.a * 2.0 * gdFade500, gdLitter, 0.1 + ( 1.0 - gdLitter ) * gdFade7 * 0.8 );
}

// --- A bog's peat, and the mud of ground that never drains: the same photograph at two
// scales, so at eight metres it is a mire and at four it is the ground under a wet
// hollow.
float gdPeat = vGroundAux.y;
if ( gdPeat > 0.02 || gdWet > 0.05 ) {
  if ( gdPeat > 0.02 ) {
    vec4 gdPeatTex = texture2D( ${textureUniform('peat')}, gdW / ${n(GROUND_SCALE.peat)} );
    gdCol = groundHeightBlend( gdCol, 1.0, gdPeatTex.rgb * uGroundPeat * ${n(PEAT_GAIN)}, gdPeatTex.a, min( 1.0, gdPeat * 0.95 ), 0.07 );
  }
  // MUD IS EARTH, NOT A HOLE. It was the peat photograph at four metres, and peat is the
  // darkest tile in the set: a wet hollow became a black blotch on a green meadow, which is
  // what the owner's "dark blotches" were. The ploughland's own photograph at a smaller
  // scale is what wet ground under grass actually looks like, and it is mixed by the
  // wetness rather than painted over it.
  if ( gdWet > 0.05 ) {
    vec4 gdMud = texture2D( ${textureUniform('soil')}, gdW / 4.0 );
    gdCol = mix( gdCol, gdMud.rgb * uGroundMud * ${n(SOIL_GAIN)}, min( 0.55, gdWet * 0.9 ) );
  }
}

// --- A shore's silt: the shallow bottom a lake's sheet is transparent over, and the
// reason a waterline is a band rather than a line.
float gdSilt = vGroundAux.z;
if ( gdSilt > 0.02 ) {
  vec4 gdSand = texture2D( ${textureUniform('shore')}, gdW / ${n(GROUND_SCALE.shore)} );
  gdCol = groundHeightBlend( gdCol, 1.0, gdSand.rgb * uGroundSilt * ${n(SHORE_GAIN)}, gdSand.a, min( 1.0, gdSilt ), 0.05 );
}

// --- Rock on what is too steep to hold soil: a cutting, a ravine's side, a river bank.
// The slope comes off the normal, so it follows the land rather than a painted mask, and
// the crack map is both the blend and the reason a cliff has a face at all.
float gdRock = vGroundAux.w;
if ( gdRock > 0.08 ) {
  vec4 gdRockTex = texture2D( ${textureUniform('rock')}, gdW / ${n(GROUND_SCALE.rock)} );
  // The crack map is this texture's own alpha (public/look/manifest.json): one fetch, not two.
  float gdRockHeight = gdRockTex.a;
  vec3 gdRockCol = gdRockTex.rgb * uGroundRock * ${n(ROCK_GAIN)};
  // Far off the same rock at three times the scale: a nine-metre repeat read at three
  // hundred metres is a pattern, and a cutting is exactly where that shows.
  gdRockCol = mix( gdRockCol, texture2D( ${textureUniform('rock')}, gdW / ${n(GROUND_SCALE.rock * 3)} ).rgb * uGroundRock * ${n(ROCK_GAIN)}, clamp( ( gdView - 40.0 ) / 160.0, 0.0, 1.0 ) );
  gdCol = groundHeightBlend( gdCol, 1.0, gdRockCol, gdRockHeight * gdRockHeight, gdRock, 0.08 );
}

${near
  ? `// --- The verge: gravel thrown off the road edge, ragged by its own height channel and
// thinned by the 100 m noise, so it is a strip nobody graded rather than a painted band.
float gdVerge = vGroundRoad.x * ( 0.32 + 1.1 * gdFade100 ) * ( 1.0 - 0.9 * gdSnow );
if ( gdVerge > 0.01 ) {
  // GRAVEL IN THE GAPS, which is slowroads' rule for this strip (SrGround §8): where the
  // sward's own photograph is bright the grass wins, where it is dark — the thin places,
  // the trodden wheel track, the ditch spoil — the stones show. So the strip is a texture
  // and not a painted band, and its edge is decided by the grass rather than by a smoothstep
  // in the road's own distance.
  vec4 gdGravel = texture2D( ${textureUniform('gravel')}, gdW / ${n(GROUND_SCALE.gravel)} );
  float gdGap = clamp( 1.25 - gdGrassTex.r, 0.0, 1.0 );
  vec3 gdGravelCol = gdGravel.rgb * uGroundGravel * ${n(GRAVEL_GAIN)} * ( 0.78 + 0.6 * gdVerge * gdVerge );
  gdCol = mix( gdCol, gdGravelCol, clamp( gdVerge * ( 0.35 + 0.9 * gdGap ), 0.0, 0.92 ) );
}`
  : `// The verge belongs to the tiles: the vista is drawn from two hundred metres out, where
// the road is a line and its shoulder is not a surface.`}

// --- Snow, BEFORE the detail masks, so the snow itself carries the 100 m and 500 m
// structure: a plough furrow or a bare patch under ten centimetres of snow is grey, and
// snow laid after the mask would erase every field boundary in the winter frame.
if ( gdSnow > 0.001 ) {
  gdCol = mix( gdCol, ${SNOW_GLSL} * ( 0.88 + 0.35 * groundLuma( gdCol ) ), gdSnow );
}

// --- Multi-scale detail, applied last so that every layer above carries it: the 100 m
// speckle and the 500 m blotches that stop a repeated photograph from reading as one.
// Weakest underfoot, full at three hundred metres — the distance at which a tiling
// pattern starts to show — and never a flat multiply, because a mask sampled at three
// scales is a pattern with no period.
float gdDetailFar = texture2D( ${textureUniform('detailFar')}, gdW / ${n(GROUND_SCALE.fade2000)} ).r;
float gdBlend = ( 1.0 - gdDetailFar ) * ( 0.6 + 0.4 * gdLight ) * 2.0;
float gdBlendB = groundScreen( 1.0 - texture2D( ${textureUniform('detailFar')}, gdW / ${n(GROUND_SCALE.fade100)} ).r, 1.0 - texture2D( ${textureUniform('detailFar')}, gdW / ${n(GROUND_SCALE.fade500)} ).r ) * min( 1.0, gdBlend * 10.0 );
gdBlend = mix( gdBlendB, gdBlend, clamp( gdView / 800.0, 0.0, 1.0 ) ) * clamp( 0.4 + 0.6 * gdView / 300.0, 0.0, 1.0 );
gdBlend += ( 1.0 - ${near
  ? `mix( texture2D( ${textureUniform('detailNear')}, gdW / ${n(GROUND_SCALE.fade100)} ).r, 1.0, gdSnow )`
  : `${n(DETAIL_NEAR_MEAN)}`} ) * ( 0.45 + 0.25 * gdLight );
// Clamped: the mask is a MULTIPLIER on an albedo, and an unclamped one could take a dark
// texel under a dark blotch past zero and print a black hole in a green field.
gdCol *= 1.0 - min( 0.8, gdBlend );

// --- Snow over everything it can lie on: patchy, thinner under a wood, and never pure
// white, because a Russian winter is grey.
${near
  ? ''
  : `// --- A wood seen from six kilometres is the ground raised to its crowns (see the vertex
// stage): this is the colour that goes with the raise.
gdCol = mix( gdCol, seasonCanopy( vCanopy.rgb ), vCanopy.w );
`}
diffuseColor.rgb = gdCol;
}`;
}

/**
 * The fragment stage's declarations. Injected before `void main()`, not after
 * `#include <common>`: `groundSeasonWeights` reads the season uniforms that
 * `injectSeason` has already put after `<common>`, and GLSL wants them declared first.
 */
function fragmentPrelude(vista: boolean): string {
  return `${samplers(vista ? 'vista' : 'tile').glsl}
${GROUND_COLOR_GLSL}
varying vec3 vGroundWorld;
varying vec4 vGroundCover;
varying vec4 vGroundAux;
varying vec3 vGroundField;
varying vec2 vGroundRoad;
${vista ? 'varying vec4 vCanopy;' : ''}
`;
}

/**
 * One ground material. `kind` picks the tile lattice or the vista; `underTiles` makes it
 * write its depth at the far plane, for the vista band the tiles are drawn over.
 */
function createGroundMaterial(kind: GroundMaterialKind, underTiles = false): THREE.MeshStandardMaterial {
  const near = kind === 'tile';
  const material = applyWorldLighting(
    applyCloudShadow(
      new THREE.MeshStandardMaterial({
        roughness: 0.93,
        metalness: 0,
        // The ground takes no environment: it is rough, it faces up, and a hemisphere of
        // bright sky used as a reflection paints the fields rather than lighting them.
        envMapIntensity: 0,
        depthWrite: true,
      }),
    ),
    // The baked shade is the wood's own density, straight off the vertex.
    { shade: 'vGroundCover.y' },
  );

  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => {
    previousCompile.call(material, shader, renderer);
    injectSeason(shader);
    Object.assign(shader.uniforms, groundColourUniforms(), samplers(kind).uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', vertexPrelude(!near, near))
      .replace('#include <begin_vertex>', vertexBody(!near, near));
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${fragmentPrelude(!near)}\nvoid main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fragmentBody(near)}`);
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${previousKey.call(material)}:ground-${kind}-v1`;

  return underTiles ? farDepthOnly(material) : material;
}

/** The player-centred lattice: every layer, at every scale. */
export const GROUND_TILE_MATERIAL = createGroundMaterial('tile');
/** The vista's outer band: the same look, with the three near terms substituted. */
export const GROUND_VISTA_MATERIAL = createGroundMaterial('vista');
/** The vista where the tiles are drawn over it: the same look, depth at the far plane. */
export const GROUND_VISTA_UNDER_MATERIAL = createGroundMaterial('vista', true);
