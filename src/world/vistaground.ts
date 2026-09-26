import { FAR_WOODS_TO_M } from './farwoods';
import { GroundAttributes } from './groundattrs';
import { newCoverSample } from './landcover';
import type { Terrain } from './terrain';

/**
 * THE CANOPY BLANKET, and the far ground's own attributes.
 *
 * Past the far woods' reach (world/farwoods.ts, 4.5 km) a wood is not trees. It is the
 * ground raised to the height of the crowns and painted their colour: past a kilometre
 * a spruce is a few pixels and a wood is a dark mass with a ragged top, and a raised
 * heightfield is exactly that for no draw calls at all. The impostors dissolve over the
 * same band the blanket rises in, and at that range the rise is about a degree of the
 * view, inside the haze.
 *
 * WHAT THIS MODULE NO LONGER DOES IS COLOUR. It used to assemble the far ground's rgb on
 * the CPU from the season's palette — which meant the vista's colour was a generation
 * product, frozen into a geometry buffer the camera carries around, and the only way to
 * change it was to rebuild the disc. It now measures the same cover the near tiles
 * measure (`world/groundattrs.ts`) and lets the shader that draws the tiles draw the
 * far ground too, so the two cannot disagree about a season or a light.
 */

/** Crowns of a closed wood, metres over the ground. Spruce stand a little taller. */
export const CANOPY_HEIGHT_M = 17;
/** Radius from the camera over which the blanket rises, and the near trees end. */
export const CANOPY_FROM_M = FAR_WOODS_TO_M * 0.93;
export const CANOPY_FULL_M = FAR_WOODS_TO_M * 1.08;

const sample = newCoverSample();
const canopyColour = new Float32Array(3);

/**
 * Canopy height a wood of density `forest` and birch share `birch` carries at a point,
 * before any distance ramp. A little noise in the crowns so the skyline is not a shelf.
 */
export function canopyHeight(x: number, z: number, forest: number, birch: number): number {
  if (forest <= 0) return 0;
  const ragged = Math.sin(x * 0.19 + Math.sin(z * 0.13) * 2) * Math.sin(z * 0.17 + Math.sin(x * 0.11) * 2);
  // The edge of a wood is a slope of lower trees, not a wall; the square keeps it soft.
  return forest * forest * (CANOPY_HEIGHT_M + 2.5 * (1 - birch) + 2.2 * ragged);
}

/**
 * Height of the far ground at a point, and its render attributes, for the vista disc.
 *
 * `radius` is the distance from the camera: the relief in the height field fades over
 * 2.5-7 km and the caller passes how much of it is left. The canopy's HEIGHT is written
 * unramped — the distance ramp is the shader's, the same one the tiles and the impostors
 * use, so nothing can appear or vanish at the hand-over — and its colour goes into
 * `canopy` as four floats.
 */
export function vistaGroundAt(
  terrain: Terrain,
  x: number,
  z: number,
  radius: number,
  reliefWeight: number,
  attributes: GroundAttributes,
  at: number,
  canopy: Float32Array,
): number {
  const h = terrain.horizonHeight(x, z, radius, reliefWeight);
  // The far ground has no road to clear back from and no basin within reach: the tiles
  // own the road's surroundings, and a basin sits within 650 m of it.
  terrain.cover.sample(x, z, 1e6, sample);
  const bog = terrain.bogAt(x, z);
  attributes.write(at, sample, 0, bog, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

  // A WOOD DOES NOT STAND ON A MIRE. The planting puts only sparse, small trees on a bog
  // (`bog > 0.35`), so the mass is masked the same way the near tiles mask it, or the far
  // picture and the near one are different places.
  const forest = bog > 0 ? sample.forest * (1 - Math.min(1, bog * 0.9)) : sample.forest;
  if (forest > 0) {
    terrain.cover.canopyColour(x, z, sample.birch, canopyColour);
    canopy[at * 4] = canopyColour[0]!;
    canopy[at * 4 + 1] = canopyColour[1]!;
    canopy[at * 4 + 2] = canopyColour[2]!;
    canopy[at * 4 + 3] = canopyHeight(x, z, forest, sample.birch);
  } else {
    canopy[at * 4] = 0;
    canopy[at * 4 + 1] = 0;
    canopy[at * 4 + 2] = 0;
    canopy[at * 4 + 3] = 0;
  }
  return h;
}
