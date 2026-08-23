/**
 * tools/shadow-length.ts
 *
 * How long a shadow the sun casts through the day, before and after the shadow
 * elevation clamp in render/sky.ts.
 *
 * Shadow length is caster height / tan(elevation), which runs away to infinity as
 * the sun approaches the horizon: that is the "shadow is sometimes enormous" a player
 * sees around dawn and dusk, and it is a property of the geometry rather than of the
 * shadow map. The clamp bounds it; this prints the bound.
 *
 *   npx tsx tools/shadow-length.ts
 *
 * Nothing here is part of the game bundle.
 */

/** Keep in sync with render/sky.ts. */
const SHADOW_MIN_ELEVATION = 0.26;
const SHADOW_FADE_ELEVATION = 0.12;
/** A car's roof height, metres: the caster the player is looking at. */
const CASTER_HEIGHT = 1.5;

function length(elevationRad: number): number {
  return CASTER_HEIGHT / Math.tan(Math.max(1e-4, elevationRad));
}

console.log('sun elev   shadow before   shadow after   shadow opacity');
for (const degrees of [0.5, 1, 2, 3, 5, 8, 12, 15, 20, 30, 45, 70]) {
  const rad = (degrees * Math.PI) / 180;
  const clamped = Math.max(rad, SHADOW_MIN_ELEVATION);
  const fade = Math.min(1, Math.max(0, rad / SHADOW_FADE_ELEVATION));
  const smooth = fade * fade * (3 - 2 * fade);
  console.log(
    `${String(degrees).padStart(5)}\u00b0   ${length(rad).toFixed(1).padStart(9)} m   ` +
      `${length(clamped).toFixed(1).padStart(9)} m   ${(smooth * 100).toFixed(0).padStart(9)}%`,
  );
}
