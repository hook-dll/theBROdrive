import { type CoverSample } from './landcover';

/**
 * THE GROUND'S RENDER ATTRIBUTES: what the ground shader needs to know about a vertex,
 * computed once, where the vertex is built.
 *
 * WHY IT IS NOT THE COLOUR. The old pipeline baked a colour into the land cover's own
 * output — `cover.sample` returned an rgb, `writeGroundWeights` folded four weights into
 * an attribute, and the ground shader mixed a procedural paint over the result. That
 * made the land cover responsible for the look, which is why the look could not change
 * with the light: the colour was decided before the shader saw it. What a vertex
 * actually knows is what kind of ground it is — how lush the meadow is, where the wood
 * is, which crop the plot grows, how wet the hollow is, how far the asphalt is — and
 * every one of those is a number that stays true whatever the season and the hour.
 *
 * SO THIS IS THE STEP THAT MEASURES THOSE NUMBERS, and the shader that turns them into
 * pixels (`render/look/groundmaterial.ts`). It runs in the tile worker, in the vista's
 * worker and in the road lab's mesh, so all three describe the same ground the same way;
 * it holds no three.js and touches no scene.
 *
 * WHAT IT PACKS, per vertex:
 *
 *   aCover   meadow lushness | wood density | crop class | how far inside the plot
 *   aGroundAux  wetness | peat | shore silt | rock (the slope, written in the normals pass)
 *   aField   the plot's own u and v in metres, and its own random tint
 *   aRoad    the verge gravel weight, and the signed distance past the asphalt edge
 *
 * The wood density doubles as the baked forest shade the lighting patch reads
 * (render/look/lighting.ts): a wood's floor is dark because the sun does not reach it,
 * and the same number that decides it is the one that places the litter.
 */

/** Floats per vertex in each block. Declared once, read by the shader through its own copy. */
export const GROUND_COVER_STRIDE = 4;
export const GROUND_AUX_STRIDE = 4;
export const GROUND_FIELD_STRIDE = 3;
export const GROUND_ROAD_STRIDE = 2;

/**
 * How far past the asphalt edge the gravel is at full strength and where it has become
 * grass again, metres. NARROW, because the road mesh already lays its own shoulder strip
 * over the first three and a half metres: what is left for the ground to draw is the
 * ragged fringe where the grader's spoil meets the sward, and the reference frames show
 * that as a metre or two of bare stone and then grass with stones in it.
 */
const VERGE_FULL_M = 1.5;
const VERGE_GONE_M = 9;
/**
 * How far outside a lake's waterline its silt reaches, metres, and the weight at the
 * waterline itself. Beyond this the bottom is out of sight under the water or ordinary
 * bank, and the band is what makes a shoreline a band rather than a line drawn round a
 * polynomial.
 */
const SILT_REACH_M = 6;
const SILT_AT_WATER = 1.35;
/**
 * The slope at which rock has fully taken over the surface, and the rate it comes in at.
 * From slowroads, whose numbers were tuned against the same kind of photograph: a bank
 * that grass can hold is under about a sixth of a gradient, and a cutting is over half.
 */
const ROCK_FLAT_NY = 0.98;
const ROCK_SLOPE_GAIN = 1.4;

/**
 * The rock weight of one vertex from its normal's own up-ness: 0 on ground a plough could
 * cross, 1 on a face. Written by the tile generator's second (normals) pass and by the
 * vista's sample builder, so the two agree at the seam.
 */
export function groundRockWeight(normalY: number): number {
  const rock = (ROCK_FLAT_NY - normalY) * ROCK_SLOPE_GAIN;
  return rock <= 0 ? 0 : rock >= 1 ? 1 : rock;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The four blocks one tile's or one disc's vertices carry, sized together and handed to
 * the renderer as attributes. A plain holder: the packing itself is `write` below.
 */
export class GroundAttributes {
  readonly cover: Float32Array;
  readonly aux: Float32Array;
  readonly field: Float32Array;
  readonly road: Float32Array;

  constructor(vertexCount: number) {
    this.cover = new Float32Array(vertexCount * GROUND_COVER_STRIDE);
    this.aux = new Float32Array(vertexCount * GROUND_AUX_STRIDE);
    this.field = new Float32Array(vertexCount * GROUND_FIELD_STRIDE);
    this.road = new Float32Array(vertexCount * GROUND_ROAD_STRIDE);
  }

  /**
   * Packs one vertex.
   *
   * `fromWater` is metres outside a lake's waterline (negative over the water, Infinity
   * where no basin is near) and `pastEdge` is metres past the asphalt edge (negative on
   * the road, Infinity where no road is near). Both are facts about the place, measured
   * by the caller, which is why they arrive as distances rather than as weights: what a
   * distance means for the look is decided here and only here.
   */
  write(
    at: number,
    cover: CoverSample,
    wet: number,
    bog: number,
    fromWater: number,
    pastEdge: number,
  ): void {
    const c = at * GROUND_COVER_STRIDE;
    this.cover[c] = cover.lush;
    this.cover[c + 1] = cover.forest;
    // The crop class, one slot above -1 so that "no crop" is zero and needs no branch.
    this.cover[c + 2] = (cover.crop + 1) / 8;
    this.cover[c + 3] = cover.plot;

    const a = at * GROUND_AUX_STRIDE;
    this.aux[a] = wet;
    this.aux[a + 1] = bog > 0 ? Math.min(1, bog * 0.9) : 0;
    this.aux[a + 2] = fromWater > SILT_REACH_M ? 0 : Math.max(0, Math.min(1, SILT_AT_WATER - fromWater / SILT_REACH_M));
    // The slope is not known until the normals are, so the fourth slot stays zero here
    // and is written by the normals pass (`groundRockWeight`).

    const f = at * GROUND_FIELD_STRIDE;
    this.field[f] = cover.fieldU;
    this.field[f + 1] = cover.fieldV;
    this.field[f + 2] = cover.fieldTint;

    const r = at * GROUND_ROAD_STRIDE;
    const edge = Number.isFinite(pastEdge) ? pastEdge : 0;
    this.road[r] = edge <= 0 ? 0 : 1 - smoothstep(VERGE_FULL_M, VERGE_GONE_M, edge);
    this.road[r + 1] = Math.min(80, Math.max(-30, edge));
  }
}
