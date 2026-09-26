import type * as THREE from 'three';
import type { LookPalette } from '../../world/look/palette';

/**
 * THE GROUND'S COLOUR, IN ONE PLACE, FOR EVERYTHING THAT GROWS ON IT.
 *
 * Half of slowroads' terrain look is not a texture and not a light: it is one function.
 * A greyscale photograph of grass supplies only luminance — the bright blade tips and
 * the dark bases — and every colour in the frame comes out of four uniforms mixed by
 * three noise fields, with the TEXEL'S OWN BRIGHTNESS deciding how much of the pale,
 * dry "peak" colour a blade reaches. That last term is what makes a meadow read as
 * blades rather than as green felt, and it is why the meadow can be repainted for a
 * season by moving four colours and nothing else.
 *
 * WHY IT IS A MODULE OF ITS OWN. The ground (render/look/groundmaterial.ts), the grass
 * tufts and the bushes of stage 3 all have to evaluate THE SAME function at the same
 * world scales, or a tuft stands on a patch of ground of a different colour from itself
 * and the verge reads as two materials. So the maths below takes its inputs as
 * arguments — the caller samples the noise, because the ground can afford to sample it
 * per fragment and a tuft can only afford it once per instance — and the four colours
 * are shared uniforms written once a frame from `world/look/palette.ts`.
 *
 * THE SCALES, and why they are not the assets' own numbers. Every UV here is derived
 * from a world position that is RELATIVE TO THE FLOATING ORIGIN (world/origin.ts), and
 * the origin jumps by `REBASE_STEP` = 1000 m. A period that does not divide 1000 m
 * therefore changes phase at every jump, and a 7 m grass tile would shift by five
 * metres with a visible step. The photographs' own periods are 5–9 m, so each one is
 * used at the nearest divisor of a kilometre — 1000/142 instead of 7, 1000/111 instead
 * of 9 — which is a scale error under one percent, invisible on a photo of grass, and
 * gives a pattern that survives a rebase exactly.
 */

/** Metres one repeat of each photograph covers. See the note above about 1000 m. */
export const GROUND_SCALE = {
  /** `grass.webp`, the greyscale meadow. */
  grass: 1000 / 142,
  /** `forest_*.webp`, the litter floor. */
  forest: 1000 / 111,
  /** `soil.webp`, ploughland. */
  soil: 1000 / 125,
  /** `stubble.webp`. */
  stubble: 1000 / 167,
  /** `peat.webp`. */
  peat: 1000 / 125,
  /** `gravel.webp`, the verge. */
  gravel: 1000 / 200,
  /** `rock.webp` and `rock_height.webp`. */
  rock: 1000 / 111,
  /** `sand.webp`, the shore. */
  shore: 1000 / 167,
  /** The noise fields: the 7 m, 100 m, 500 m, 2 km and 4 km fades. */
  fine: 1000 / 142,
  fade100: 100,
  fade500: 500,
  fade2000: 2000,
  fade4000: 4000,
} as const;

/**
 * The colours, as one shared block. `setGroundLook` writes them once a frame, so a
 * material that has already compiled sees the new season with no recompile and no
 * per-material write — the same mechanism `render/look/lighting.ts` uses for the light.
 *
 * Every tint here MULTIPLIES a photograph or a greyscale tile, so the neutral value is
 * white and the palette only says how far this season is from the one it was taken in.
 * `crops` is the exception and the reason there is a seven-entry array: a standing crop
 * has no photograph, so it is the same grass luminance under a colour of its own.
 */
const uniforms: Record<string, THREE.IUniform> = {
  uGroundGrassA: { value: [1, 1, 1] },
  uGroundGrassB: { value: [1, 1, 1] },
  uGroundPeakA: { value: [1, 1, 1] },
  uGroundPeakB: { value: [1, 1, 1] },
  uGroundSoil: { value: [1, 1, 1] },
  uGroundStubble: { value: [1, 1, 1] },
  uGroundPeat: { value: [1, 1, 1] },
  uGroundSilt: { value: [1, 1, 1] },
  uGroundGravel: { value: [1, 1, 1] },
  uGroundRock: { value: [1, 1, 1] },
  uGroundMud: { value: [1, 1, 1] },
  uGroundForest: { value: [1, 1, 1] },
  uGroundFieldTint: { value: [1, 1, 1] },
  uGroundCrops: { value: new Float32Array(21).fill(1) },
};

/** The shared uniform objects, for a hand-written material that wants them injected. */
export function groundColourUniforms(): Record<string, THREE.IUniform> {
  return uniforms;
}

/** One of the palette's colour fields, as the setter below reads it. */
type GroundColourField = 'grassA' | 'grassB' | 'peakA' | 'peakB' | 'groundSoil' | 'groundStubble'
  | 'groundPeat' | 'groundSilt' | 'groundGravel' | 'groundRock' | 'groundMud' | 'groundForest' | 'fieldTint';

/**
 * Which uniform carries which palette field. Built once, so the per-frame setter is a
 * walk over thirteen pairs with no allocation and no thirteen-line hand copy that
 * could silently drop a colour when a field is added.
 */
const RGB_SOURCES: readonly (readonly [GroundColourField, THREE.IUniform])[] = [
  ['grassA', uniforms.uGroundGrassA!],
  ['grassB', uniforms.uGroundGrassB!],
  ['peakA', uniforms.uGroundPeakA!],
  ['peakB', uniforms.uGroundPeakB!],
  ['groundSoil', uniforms.uGroundSoil!],
  ['groundStubble', uniforms.uGroundStubble!],
  ['groundPeat', uniforms.uGroundPeat!],
  ['groundSilt', uniforms.uGroundSilt!],
  ['groundGravel', uniforms.uGroundGravel!],
  ['groundRock', uniforms.uGroundRock!],
  ['groundMud', uniforms.uGroundMud!],
  ['groundForest', uniforms.uGroundForest!],
  ['fieldTint', uniforms.uGroundFieldTint!],
];

/**
 * This frame's ground colours, from the look palette. The material module wraps this in
 * `setGroundLook`, which also rebinds the two forest photographs.
 */
export function setGroundColours(palette: LookPalette): void {
  for (const [field, uniform] of RGB_SOURCES) {
    const colour = palette[field];
    const value = uniform.value as number[];
    value[0] = colour.r;
    value[1] = colour.g;
    value[2] = colour.b;
  }
  const crops = uniforms.uGroundCrops!.value as Float32Array;
  const src = palette.groundCrops;
  for (let i = 0; i < 21; i++) crops[i] = src[i]!;
}

/**
 * The declarations and the maths, for insertion after `#include <common>` in whichever
 * stage needs it. `SEASON_GLSL` (render/season.ts) supplies the season channels, which
 * the forest floor's own season blend reads; a material that uses the forest layer must
 * have injected that first.
 */
export const GROUND_COLOR_GLSL = /* glsl */ `
uniform vec3 uGroundGrassA;
uniform vec3 uGroundGrassB;
uniform vec3 uGroundPeakA;
uniform vec3 uGroundPeakB;
uniform vec3 uGroundSoil;
uniform vec3 uGroundStubble;
uniform vec3 uGroundPeat;
uniform vec3 uGroundSilt;
uniform vec3 uGroundGravel;
uniform vec3 uGroundRock;
uniform vec3 uGroundMud;
uniform vec3 uGroundForest;
uniform vec3 uGroundFieldTint;
uniform vec3 uGroundCrops[7];

float groundScreen( float a, float b ) { return 1.0 - ( 1.0 - a ) * ( 1.0 - b ); }
float groundLuma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

/**
 * THE FOUR-COLOUR TINT. \`fade7\`/\`fade100\` are the two low fades that pick between the
 * grass's two tones, \`variation\` and \`closeVar\` are the 2 km patch map and its 500 m
 * twin (already centred on zero), \`lightGrass\` is how pale this piece of country is,
 * \`darkGrass\` how much the wet hollows darken it, and \`blade\` the photograph's own
 * luminance at this texel.
 *
 * The blade term is the whole trick: a bright tip reaches the peak colour, a dark base
 * stays in the green, and the two do not cross-fade with the noise — they are decided
 * per texel, which is what a photograph of grass is for.
 */
vec3 groundGrassTint( float fade7, float fade100, float variation, float closeVar, float lightGrass, float darkGrass, float blade ) {
  float blend = clamp( ( groundScreen( fade100, fade7 ) + darkGrass ) * 0.5, 0.0, 1.0 );
  blend = blend * blend + variation + closeVar;
  float t = clamp( blend, -0.25, 1.25 );
  vec3 base = mix( uGroundGrassA, uGroundGrassB, t );
  vec3 peak = mix( uGroundPeakA, uGroundPeakB, t );
  float tip = clamp( clamp( lightGrass + variation - closeVar, 0.0, 1.0 ) * 2.0 * blade, 0.0, 1.0 );
  return mix( base, peak, tip );
}

/**
 * HEIGHT-BASED BLENDING, slowroads' \`terrainBlend\`: a layer does not cover the one under
 * it, it FILLS the low places and shows through in the high ones, so the edge between
 * two materials is a ragged line decided by each texture's own height channel rather
 * than a smoothstep in the shape of the triangle that carries it. \`ha\`/\`hb\` are the two
 * heights, \`w\` is how much of layer B there is at all, and \`depth\` is how deep its
 * lowest ground cuts (0.05 for sand against grass, 0.055 for gravel, 0.08 for rock, 0.1
 * for litter).
 */
vec3 groundHeightBlend( vec3 a, float ha, vec3 b, float hb, float w, float depth ) {
  float wa = 1.0 - w;
  float top = max( ha + wa, hb + w ) - depth;
  float ba = max( ha + wa - top, 0.0 );
  float bb = max( hb + w - top, 0.0 );
  float sum = ba + bb;
  return sum < 1e-4 ? mix( a, b, w ) : ( a * ba + b * bb ) / sum;
}
`;
