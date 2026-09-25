import { hashUnit3 } from '../core/rng';

/**
 * WHICH TREES OF A WOOD STAND ON THE FAR HORIZON.
 *
 * Past `IMPOSTOR_TO_M` (world/forest.ts) a wood is too many trees to draw each one, and
 * a raised, painted ground in their place (the canopy blanket) read from a hill as bare
 * green bands: slowroads draws its far woods as trees, and so do we. One tree in
 * `1 / FAR_KEEP_SHARE` goes on as an impostor to `FAR_WOODS_TO_M`, widened as the rest
 * dissolve (world/impostors.ts) so the wood keeps its mass. Which ones is a hash of the
 * position, the same in the worker that plants them and wherever they are drawn.
 */

export const FAR_KEEP_SHARE = 0.2;
/** How far a wood's kept trees are drawn; the canopy blanket rises past it. */
export const FAR_WOODS_TO_M = 4500;
const KEEP_TAG = 0x4b454550;

export function isFarKeeper(x: number, z: number): boolean {
  return hashUnit3(KEEP_TAG, Math.round(x * 4), Math.round(z * 4)) < FAR_KEEP_SHARE;
}
