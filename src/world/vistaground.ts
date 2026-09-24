import { newCoverSample } from './landcover';
import type { Terrain } from './terrain';

/**
 * THE CANOPY BLANKET, and the far ground's colour.
 *
 * Past the far forest's impostor radius (world/forest.ts) a wood is not trees. It is
 * the ground raised to the height of the crowns and painted their colour: at two
 * kilometres a spruce is a couple of pixels and a wood is a dark mass with a ragged
 * top, and a raised, outlined heightfield is exactly that for no draw calls at all.
 * The impostors dissolve over the same band the blanket rises in, and at that range
 * the rise is half a degree of the view, inside the haze.
 */

/** Crowns of a closed wood, metres over the ground. Spruce stand a little taller. */
export const CANOPY_HEIGHT_M = 17;
/** Radius from the camera over which the blanket rises, and the near trees end. */
export const CANOPY_FROM_M = 1800;
export const CANOPY_FULL_M = 2300;

const sample = newCoverSample();
const canopy = new Float32Array(3);

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
 * Height and linear colour of the far ground at a point, for the vista disc.
 * `radius` is the distance from the camera; `colors[at..at+2]` receives the colour.
 */
export function vistaGroundAt(
  terrain: Terrain,
  x: number,
  z: number,
  radius: number,
  reliefWeight: number,
  colors: Float32Array,
  at: number,
): number {
  let h = terrain.horizonHeight(x, z, radius, reliefWeight);
  // The far ground has no road to clear back from: the tiles own the road's surroundings.
  terrain.cover.sample(x, z, 1e6, sample);
  let r = sample.r;
  let g = sample.g;
  let b = sample.b;
  if (sample.forest > 0) {
    const ramp = radius <= CANOPY_FROM_M ? 0 : Math.min(1, (radius - CANOPY_FROM_M) / (CANOPY_FULL_M - CANOPY_FROM_M));
    h += canopyHeight(x, z, sample.forest, sample.birch) * ramp;
    terrain.cover.canopyColour(x, z, sample.birch, canopy);
    const w = sample.forest * ramp;
    r += (canopy[0]! - r) * w;
    g += (canopy[1]! - g) * w;
    b += (canopy[2]! - b) * w;
  }
  colors[at] = r;
  colors[at + 1] = g;
  colors[at + 2] = b;
  return h;
}
