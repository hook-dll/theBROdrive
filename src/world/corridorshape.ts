import { VarietyChannel, varietyEventAt, varietyWeightAt } from './director';

/**
 * THE CORRIDOR SHAPE: the ground beside the road doing something, on a schedule.
 *
 * Three of the variety director's horizon kinds are one idea — the cross-section of
 * the corridor stops being flat for half a kilometre:
 *
 *   cut          the ground each side climbs to a crest above the road, the sky
 *                narrows and the horizon closes in
 *   embankment   the ground each side falls away, the road rides a bank and the
 *                view opens
 *   outcrop      a belt where the rock shelves come in off the plain and crowd the
 *                roadside instead of sitting out where they cannot be read
 *
 * THE ROAD DOES NOT MOVE. That is the whole design and it is not a compromise: the
 * spine is the reference traffic, the autopilot, the POI placement, the pole line and
 * the road mesh all derive from, and a cut that lowered the road would have to move
 * every one of them and would still fold wherever two passes of the road came near
 * each other. A cut here is the GROUND RISING beside an unchanged ribbon, an
 * embankment the ground falling away from it. The asphalt edge keeps exactly the
 * height it had, because nothing below is even allowed to reach it.
 *
 * WHERE THIS RIDES, AND WHY IT IS NOT IN THE BASE FIELD. `terrain.ts` composes ground
 * height out of a base (the landscape plus dune relief) and a detail layer. This is in
 * the DETAIL layer, and all three of the reasons are load-bearing:
 *
 *   Resolution. The base is drawn off the field lattice's lateral rings, and across
 *   the laterals this feature uses those rings are 2.5 m apart at 10 m out, 6.1 m at
 *   20 m, 8.3 m at 25 m, 11.2 m at 35 m and 12 m from 43 m to 79 m — after which the
 *   next ring is 1500 m. A seven-metre crest chorded on 12 m rings misses its own
 *   surface by more than half a metre per facet, which is a visible fold in a bank
 *   the player drives past at thirty metres. The detail layer is resampled per
 *   refined-grid vertex at 2.67 m and per desert-tile vertex at 3 m, where the same
 *   crest misses by under a decimetre.
 *
 *   Arclength. This is the first terrain term whose height depends SHARPLY on `s` —
 *   a ramp moves seven metres in seventy. The base field is also evaluated from
 *   world position, where the arclength comes from `RoadDistance.ownerAt`, a
 *   NEAREST-NODE lookup on a 50 m lattice: it steps, so a base-layer feature would
 *   step with it. Every caller of the detail layer passes a real road frame — a mesh
 *   row's own `s`, or a projection — or passes a lateral distance beyond this
 *   feature's reach, where it is zero and the arclength cannot matter.
 *
 *   Seams. The detail layer must be zero where the refined grid stitches to the
 *   coarse mesh (`DETAIL_REACH`) and where it tucks under the asphalt. This feature
 *   is zero at both by construction, so it needs no help from either seam and adds
 *   no new one.
 *
 * `CORRIDOR_REACH_M` is 62 m and that is not a free number either: it is terrain.ts's
 * `DETAIL_HOLD`, before which the two detail functions are identical, and it is inside
 * the 70 m gate at which `deserttiledata.ts` stops projecting the road exactly. Both
 * would otherwise be a step. `tools/corridor-shape.ts` checks it against the real one.
 */

/**
 * Metres outside the asphalt that nothing here may touch.
 *
 * The verge is 3.5 m of loose shoulder, the pole line stands at 3.1 m and birds perch
 * between 0.7 and 2.4 m out. A batter that started at the paint would bury all three
 * on a cut and leave them in the air on an embankment, so the ground holds its
 * unmodified height across the whole of it and the slope starts outside.
 */
export const CORRIDOR_KEEP_M = 4;

/**
 * Lateral distance at which every part of this has returned to the open desert.
 * MUST equal `DETAIL_HOLD` in terrain.ts — see the header.
 */
export const CORRIDOR_REACH_M = 62;

/**
 * Metres of lateral over which a batter climbs from the verge to its full height, and
 * the lateral at which it starts giving that height back.
 *
 * Full height therefore lands between 27 m and 31 m from the centreline depending on
 * how wide the asphalt is there, and holds to 34 m: a crest band the driver reads
 * against the sky rather than a ridge line that happens to be a point. 20 m of rise on
 * a 7 m crest is a 35% batter — steep enough to be a cut face, gentle enough that a car
 * that leaves the road climbs it instead of stopping dead against it. Real cut slopes
 * are nearer 67%; that version looked like a trench and hid the desert entirely.
 */
const BATTER_RISE_M = 20;
const BATTER_FADE_START_M = 34;

/**
 * The outcrop belt's own profile. It comes in closer than a batter (full by 16 m out)
 * and holds further (to 46 m), because the whole point of the kind is rock ARRIVING at
 * the roadside: a belt that faded where a batter fades would read as the same landform
 * with lumps on it.
 */
const BELT_RISE_M = 12;
const BELT_FADE_START_M = 46;

/**
 * Crest and trough, metres, as a base plus the event's own roll.
 *
 * A cut's 3 m floor already closes the horizon at thirty metres out (7 m at 30 m is
 * thirteen degrees above the eye line) and its 7 m ceiling is a ridge the road is
 * genuinely cut through. The embankment is deliberately shallower: the same depth
 * downward reads as a quarry, and what the kind is for is the view opening, which the
 * first two metres already do.
 */
const CUT_BASE_M = 3;
const CUT_PER_DRAW_M = 4;
const BANK_BASE_M = 2;
const BANK_PER_DRAW_M = 3;

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * The lateral profile every kind here shares: nothing across the verge, a smoothstep
 * up to full, and a smoothstep back to the open desert.
 *
 * The inner end is measured from the ASPHALT EDGE (`over`) because that is what the
 * verge, the poles and the birds are measured from, and the edge moves with
 * `Road.halfWidthAt`. The outer end is measured from the CENTRELINE (`dist`) because
 * that is what the mesh seams and the tile gate are measured from, and those do not
 * move. Mixing the two is the only way both ends land where they have to.
 */
function flank(over: number, dist: number, riseM: number, fadeStartM: number): number {
  const rise = smoothstep01((over - CORRIDOR_KEEP_M) / riseM);
  if (dist <= fadeStartM) return rise;
  return rise * (1 - smoothstep01((dist - fadeStartM) / (CORRIDOR_REACH_M - fadeStartM)));
}

/**
 * Metres to add to the ground beside the road at one point: positive inside a cut,
 * negative inside an embankment, zero everywhere else.
 *
 * `dist` is lateral distance from the centreline and `halfWidth` the asphalt's own
 * half-width at `s`; both sides of the road get the same shape, because a prism cut
 * with one wall is a landslide.
 *
 * Hot: this is called once per terrain detail sample. The lateral band is rejected
 * before the schedule is consulted, and the schedule's own lookup is memoised on the
 * window, so a vertex outside the feature costs two comparisons.
 */
export function corridorBatterAt(
  seed: number,
  s: number,
  dist: number,
  halfWidth: number,
): number {
  const over = dist - halfWidth;
  if (over <= CORRIDOR_KEEP_M || dist >= CORRIDOR_REACH_M) return 0;
  const event = varietyEventAt(seed, VarietyChannel.Horizon, s);
  if (event === null) return 0;
  let amplitude: number;
  if (event.kind === 'cut') amplitude = CUT_BASE_M + event.draw * CUT_PER_DRAW_M;
  else if (event.kind === 'embankment') amplitude = -(BANK_BASE_M + event.draw * BANK_PER_DRAW_M);
  else return 0;
  // The director's weight is already smoothstepped across the ramp, so the only
  // gradient along the road is the one the ramp asks for: at the crest of the tallest
  // cut, 7 m over a 70 m ramp, 15 cm per metre of road. That is a ridge nose, not a
  // step, and `tools/corridor-shape.ts` measures that it stays one.
  return amplitude * varietyWeightAt(seed, event.kind, s) * flank(over, dist, BATTER_RISE_M, BATTER_FADE_START_M);
}

/**
 * Strength of the rock-outcrop belt at one point, in [0, 1].
 *
 * Returned as a weight rather than a height because the rock field itself lives in
 * `terrain.ts` — this schedules the belt, terrain.ts decides what rock does inside it.
 *
 * Both sides, and no roll on which one: the belt's asymmetry is already in the rock
 * field, which is a world-space noise and so puts different slabs left and right of
 * any given kilometre. Leaning it would also have meant carrying a SIGNED lateral
 * through the detail layer, which takes a distance from every caller it has.
 */
export function outcropBeltAt(
  seed: number,
  s: number,
  dist: number,
  halfWidth: number,
): number {
  const over = dist - halfWidth;
  if (over <= CORRIDOR_KEEP_M || dist >= CORRIDOR_REACH_M) return 0;
  const event = varietyEventAt(seed, VarietyChannel.Horizon, s);
  if (event === null || event.kind !== 'outcrop') return 0;
  return varietyWeightAt(seed, 'outcrop', s) * flank(over, dist, BELT_RISE_M, BELT_FADE_START_M);
}
