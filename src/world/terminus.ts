/**
 * The turning circle at the road's start: the ground it stands on, and the shape of
 * the paved bulb.
 *
 * The road is generated from `s = 0` upward and simply stopped there: asphalt ended
 * mid-stride against a dune, and ambient traffic driving toward the start ran out of
 * road and was quietly recycled out of sight. This module gives the terminus the thing
 * a real dead-end road has — a bulb wide enough to turn a car in — and `world/traffic.ts`
 * uses it to send oncoming cars back out instead of deleting them.
 *
 * WHY IT IS NOT PART OF THE ROAD RIBBON. `Road` is one arclength with a half-width at
 * each `s`, and everything (mesh, collider, corridor grading, scatter setback) is built
 * from that. A turning bulb expressed as a bulge in `halfWidthAt` is tempting because it
 * comes with all of that for free, but it is a bulge of ~17 m either side and the
 * homestead's pad starts 8.3 m off the crown at s = 12 (`house.ts`) — the bulb would eat
 * the garage. So the bulb lives BEHIND the start, in the apron the terrain already draws
 * there, where the only thing it can collide with is empty desert.
 *
 * The drive line turns on 11 m. That is not a guess: the ordinary `Autopilot` was
 * driven round analytic circles and holds 30 m to 0.88 m of lateral error, 12 m to
 * 0.93 m, 10 m to 1.12 m and 8 m to 1.39 m, falling apart at 6 m. Twelve and a half is
 * the smallest radius that still costs nothing in tracking, and it sets the paving:
 * drive line, plus the body's own half-width, plus the error, plus a margin.
 *
 * The ground under the bulb is FLATTENED, as a deterministic term in `Terrain` — the
 * same contract the lake basins have (`world/lakes.ts`): pure in world position, so the
 * tile worker reproduces it without being told anything, and what is drawn is what is
 * collided. Outside the rim the desert is untouched.
 */

/** Metres behind the road's start that the bulb's centre sits. */
export const TERMINUS_CENTRE_M = 15;
/** Radius of the paved disc. */
export const TERMINUS_PAD_M = 17;
/**
 * The drive line's two radii (`world/turnaround.ts` builds the line itself): the loop
 * round the bulb, and the hook that joins it to each lane.
 *
 * The loop sits 6 m inside the paving, which covers the body's half-width, the metre of
 * tracking error measured at this radius, and a car arriving off-centre. The hook is
 * tighter because it is short - 64 degrees at each end - and because it is what lets the
 * loop be gentle: a line that tried to join the loop from the lane without swinging wide
 * first would have to spiral, and the tightest part of that spiral is what the car would
 * be judged on.
 */
export const TERMINUS_LOOP_M = 11;
export const TERMINUS_HOOK_M = 6;
/**
 * Where the flattened ground gives way to the dunes again. Long enough to be a slope a
 * car can drive off the pad at, rather than a step.
 */
export const TERMINUS_RIM_M = 14;

/**
 * Weight of the flattening at a point: 1 on the paved disc, falling to 0 by the rim.
 *
 * The road's straight, heading-zero runout covers the first 260 m (`roadcurve.ts`), so
 * the start frame is exactly +Z and the bulb's centre is the plain world point
 * `(0, -TERMINUS_CENTRE_M)`. No projection, no road sample: this is called for every
 * terrain vertex in the world and the common answer has to be free.
 */
export function terminusWeight(x: number, z: number): number {
  if (z > TERMINUS_PAD_M + TERMINUS_RIM_M - TERMINUS_CENTRE_M) return 0;
  const dz = z + TERMINUS_CENTRE_M;
  const r2 = x * x + dz * dz;
  const outer = TERMINUS_PAD_M + TERMINUS_RIM_M;
  if (r2 >= outer * outer) return 0;
  const r = Math.sqrt(r2);
  if (r <= TERMINUS_PAD_M) return 1;
  const t = 1 - (r - TERMINUS_PAD_M) / TERMINUS_RIM_M;
  return t * t * (3 - 2 * t);
}

/** True where the paving itself is, which is where the surface is asphalt. */
export function onTerminusPad(x: number, z: number): boolean {
  const dz = z + TERMINUS_CENTRE_M;
  return x * x + dz * dz <= TERMINUS_PAD_M * TERMINUS_PAD_M;
}
