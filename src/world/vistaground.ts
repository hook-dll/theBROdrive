import { FAR_WOODS_TO_M } from './farwoods';
import { newCoverSample, writeGroundWeights } from './landcover';
import { seasonCanopy, seasonGround, type SeasonState } from './season';
import { PEAT, type Terrain } from './terrain';

/**
 * THE CANOPY BLANKET, and the far ground's colour.
 *
 * Past the far woods' reach (world/farwoods.ts, 4.5 km) a wood is not trees. It is
 * the ground raised to the height of the crowns and painted their colour: past a
 * kilometre a spruce is a few pixels and a wood is a dark mass with a ragged
 * top, and a raised, outlined heightfield is exactly that for no draw calls at all.
 * The impostors dissolve over the same band the blanket rises in, and at that range
 * the rise is about a degree of the view, inside the haze.
 */

/** Crowns of a closed wood, metres over the ground. Spruce stand a little taller. */
export const CANOPY_HEIGHT_M = 17;
/** Radius from the camera over which the blanket rises, and the near trees end. */
export const CANOPY_FROM_M = FAR_WOODS_TO_M * 0.93;
export const CANOPY_FULL_M = FAR_WOODS_TO_M * 1.08;

const sample = newCoverSample();
const canopy = new Float32Array(3);
const weights = new Float32Array(4);

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
 * `radius` is the distance from the camera; `colors[at..at+2]` receives the colour,
 * recoloured for `season` here rather than in the shader: the vista is rebuilt as the
 * camera moves, far more often than the season can visibly change.
 */
export function vistaGroundAt(
  terrain: Terrain,
  x: number,
  z: number,
  radius: number,
  reliefWeight: number,
  colors: Float32Array,
  at: number,
  season: SeasonState,
): number {
  let h = terrain.horizonHeight(x, z, radius, reliefWeight);
  // The far ground has no road to clear back from: the tiles own the road's surroundings.
  terrain.cover.sample(x, z, 1e6, sample);
  writeGroundWeights(sample, 0, weights, 0);
  colors[at] = sample.r;
  colors[at + 1] = sample.g;
  colors[at + 2] = sample.b;
  seasonGround(colors, at, weights[0]!, weights[1]!, weights[2]!, weights[3]!, season);
  let r = colors[at]!;
  let g = colors[at + 1]!;
  let b = colors[at + 2]!;
  // A BOG IS A MIRE FROM FAR AWAY TOO. The tiles draw its water as geometry and this disc
  // has no water at all, so without the peat here a bog is ordinary field on the horizon and
  // turns into a mire as you arrive — which is the owner's "заболоченность является
  // миражом", seen from the other end: nothing vanishes, but something APPEARS, and an
  // appearance at a distance is exactly what a mirage is. Peat makes the far ground and the
  // near ground the same place, and the water in it is then detail rather than a reveal.
  const bog = terrain.bogAt(x, z);
  if (bog > 0) {
    const m = Math.min(1, bog * 0.9);
    r += (PEAT[0] - r) * m;
    g += (PEAT[1] - g) * m;
    b += (PEAT[2] - b) * m;
  }
  // A WOOD DOES NOT STAND ON A MIRE. The peat above makes the far bog the same place as the
  // near one, and then this block lerped the very same ground to the canopy colour and
  // raised a seventeen-metre canopy blanket over it wherever the cover said forest — so in a
  // wooded district a bog still read as wood from the horizon and opened up on arrival, which
  // is the appearance-at-a-distance the peat was added to remove. The planting puts only
  // sparse, small trees on a bog (`bog > 0.35`), so the mass is masked the same way.
  // (A LAKE BASIN is masked in the tiles' own canopy, `world/deserttiledata.ts`; this disc
  // has no arclength to look a basin up with, and a basin sits within 650 m of the road.)
  const canopyForest = bog > 0 ? sample.forest * (1 - Math.min(1, bog * 0.9)) : sample.forest;
  if (canopyForest > 0) {
    const ramp = radius <= CANOPY_FROM_M ? 0 : Math.min(1, (radius - CANOPY_FROM_M) / (CANOPY_FULL_M - CANOPY_FROM_M));
    h += canopyHeight(x, z, canopyForest, sample.birch) * ramp;
    terrain.cover.canopyColour(x, z, sample.birch, canopy);
    seasonCanopy(canopy, 0, sample.birch, season);
    const w = canopyForest * ramp;
    r += (canopy[0]! - r) * w;
    g += (canopy[1]! - g) * w;
    b += (canopy[2]! - b) * w;
  }
  colors[at] = r;
  colors[at + 1] = g;
  colors[at + 2] = b;
  return h;
}
