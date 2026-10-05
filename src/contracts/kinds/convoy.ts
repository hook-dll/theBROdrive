/**
 * Convoy escort (kind 16): the papers and the car they escort arrive together.
 *
 * The escort is a complete, ordinary car in the world — a real persistent `CarState`
 * with its own engine, fuel and damage — spawned beside the SOURCE courier the first
 * time the papers leave that courier's boot (`contracts/world.ts`). It is driven by
 * its OWN `Autopilot` (the follow controller in `main.ts`): while the papers are
 * aboard the car the player is driving, it keeps a headway behind him on the road
 * lane, matches his speed and stops when he stops; when he leaves it behind far
 * enough that it unloads, its pose is parked in state and it resumes, from where it
 * stands, when he comes back. Nothing teleports.
 *
 * WHAT THE SIGNATURE WATCHES.
 *
 * - the escort never took a heavy impact, m/s of unexplained speed loss, the same
 *   measure every car's own `lastImpact` uses. 4 m/s is a real shunt, the same order
 *   as the trailer kind's limit; kerb scuffs and the odd wing mirror are below it.
 * - it never fell more than `FALL_BEHIND_M` behind for more than `FALL_BEHIND_S`
 *   continuously. At road speed 80 m is five seconds of road, and twenty seconds of
 *   that is the player deliberately leaving rather than a slow corner or a jam he
 *   waited out. (Left behind past the streaming radius the escort is parked, and
 *   then the gap only grows; the timer keeps the bonus lost either way.)
 *
 * The delivery consumes the escort, so there is exactly one escort per contract and
 * nothing is left standing at the destination.
 */

import { contractCarId } from '../world';
import { defaultProgress, type ContractKindDef } from '../types';

/** The escort counts as delivered inside this radius of the courier, m. */
const DELIVERY_RANGE_M = 30;
/** Unexplained speed loss, m/s, that counts as a heavy impact on the escort. */
const IMPACT_LIMIT_MPS = 4;
/** Distance behind the player, m, past which the escort counts as falling behind. */
const FALL_BEHIND_M = 80;
/** Continuous seconds past that distance before the bonus is lost. */
const FALL_BEHIND_S = 20;

export const convoyKind: ContractKindDef = {
  kind: 'convoy',
  weight: 1,
  offerNames: ['convoy papers', 'escort order', 'convoy manifest', 'escort docket'],
  signatureSticker: 'sputnik',
  initialProgress: defaultProgress,
  acceptRefusal: (item, probe) => {
    const carId = contractCarId(item);
    const at = probe.carPosition(carId);
    if (!at) return 'its escort car is not here';
    const dx = probe.courierX - at.x;
    const dz = probe.courierZ - at.z;
    if (dx * dx + dz * dz > DELIVERY_RANGE_M * DELIVERY_RANGE_M) {
      return `bring the escort within ${DELIVERY_RANGE_M} m`;
    }
    return null;
  },
  step: (p, ctx) => {
    const car = ctx.carById?.(contractCarId(ctx.item)) ?? null;
    if (!car) {
      p.statusText = '';
      return;
    }
    if (car.impactMps > IMPACT_LIMIT_MPS && !p.violated) {
      p.violated = true;
      p.statusText = 'escort hit — bonus lost';
    }
    // The carrying car is the one the papers are in; the escort is meant to be
    // behind IT, whatever the player is driving today.
    if (ctx.car === null) {
      p.statusText = 'escort waiting';
      p.heat = 0;
      return;
    }
    const dx = ctx.car.absoluteX - car.absoluteX;
    const dz = ctx.car.absoluteZ - car.absoluteZ;
    const gap = Math.hypot(dx, dz);
    if (gap > FALL_BEHIND_M) {
      p.heat += ctx.dt;
      if (p.heat > FALL_BEHIND_S && !p.violated) {
        p.violated = true;
        p.statusText = 'convoy left behind — bonus lost';
      }
    } else {
      p.heat = 0;
      if (!p.violated) p.statusText = gap > 45 ? 'escort catching up' : 'escort close';
    }
  },
  conditionMet: (p) => !p.violated,
  onDelivered: (item) => ({
    deltas: [{ t: 'car_remove', carId: contractCarId(item) }],
  }),
};
