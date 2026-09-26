/**
 * The two vegetation numbers the settings page quotes, kept here rather than exported from
 * the modules that own them.
 *
 * `GRASS_TIERS` and `MODEL_RANGE_M` are private to `world/grass.ts` and `world/forest.ts`,
 * and this menu may not open those modules up without giving the presentation a say in how
 * the world is built. They are therefore COPIED, with the same discipline the tyre-dot
 * colours use in `hud.ts`: the copy is typed as a total map of the accepted rungs, so a
 * fourth rung breaks the build here instead of quietly quoting a number that no longer
 * exists, and a change to either ladder has to be reflected here by hand.
 *
 * They are quoted and not used: nothing in the game reads these, and they only decide what a
 * hint line says. What the world actually draws stays the tier's business.
 */

import type { GraphicsQuality } from '../game/settings';

/** Metres of grass round the camera. `world/grass.ts`, `RADIUS_M`: the same on every rung. */
export const GRASS_BAND_M: Record<GraphicsQuality, number> = {
  acceptable: 70,
  standard: 70,
  blessing: 70,
};

/** Metres a tree is a model rather than a quad. `world/forest.ts`, `MODEL_RANGE_M`. */
export const TREE_MODEL_RANGE_M: Record<GraphicsQuality, number> = {
  acceptable: 130,
  standard: 190,
  blessing: 280,
};
