/**
 * Towing (kind 17): the papers for one specific immobilised car, which has to be
 * delivered to the next courier ON THE BAR — pulled there behind a working car.
 *
 * The car is spawned beside the SOURCE courier the first time its papers leave that
 * courier's boot (`contracts/world.ts`), named after the offer seed, with NO ENGINE
 * in its bay: it cannot idle, it cannot be driven, and the only way to move it is
 * the car-to-car tow bar of kind 17's subsystem (`vehicle/cartow.ts`).
 *
 * WHAT THE SIGNATURE WATCHES.
 *
 * Two things, and both are the reason the kind exists as a physical act rather than
 * as "a car within 20 m":
 *
 * - the bar was ON and stayed on. The papers commission a TOW, so from the moment
 *   the towed car has been hitched once, letting go of the bar — the player's hand
 *   or the joint shearing under a snag — ends the bonus. The delivery still pays the
 *   ordinary sticker. (The bar is never unhitched by the game itself mid-route; it
 *   is dropped only here, at the commit, and after the reward has been read.)
 * - the car arrived in one piece. The measure is `CarState.scratches`, the shell's
 *   own cosmetic damage, raised only by impacts above 1.8 m/s and capped per impact,
 *   and the car leaves the works at zero — the same arrival bar the car-transfer
 *   kind uses. A rough arrival (a real shunt or two) keeps the bonus; a crash does
 *   not.
 *
 * The delivery consumes the car, so it also refuses while the car's boot holds
 * anything: handing over a car must not delete whatever the player left in it.
 */

import { contractCarId } from '../world';
import { defaultProgress, type ContractKindDef } from '../types';

/** The towed car counts as delivered inside this radius of the courier, m. */
const DELIVERY_RANGE_M = 20;
/** Cosmetic shell damage (0..1) that still counts as "arrived in one piece". */
const SCRATCHES_LIMIT = 0.45;

export const towingKind: ContractKindDef = {
  kind: 'towing',
  weight: 1,
  offerNames: ['tow papers', 'recovery papers', 'breakdown tow order', 'tow docket'],
  signatureSticker: 'learner',
  initialProgress: defaultProgress,
  acceptRefusal: (item, probe) => {
    const carId = contractCarId(item);
    const car = probe.car(carId);
    const at = probe.carPosition(carId);
    if (!car || !at) return 'its car is not here';
    const dx = probe.courierX - at.x;
    const dz = probe.courierZ - at.z;
    if (dx * dx + dz * dz > DELIVERY_RANGE_M * DELIVERY_RANGE_M) {
      return `bring it within ${DELIVERY_RANGE_M} m — on the bar is fine`;
    }
    if (car.storage.some((cell) => cell !== null)) return 'empty its boot before handing it over';
    return null;
  },
  step: (p, ctx) => {
    const car = ctx.carById?.(contractCarId(ctx.item)) ?? null;
    if (!car) {
      p.statusText = '';
      return;
    }
    if (car.towedBy !== null) {
      // The flag, not a count: the coupling was seen at least once, so its absence
      // later is the tow being let go rather than a hitch not made yet.
      p.heat = 1;
      p.statusText = 'on the bar';
    } else if (p.heat > 0 && !p.violated) {
      p.violated = true;
      p.statusText = 'tow let go — bonus lost';
      return;
    } else {
      p.statusText = '';
    }
    if (car.upsideDown && !p.violated) {
      p.violated = true;
      p.statusText = 'towed car on its roof — bonus lost';
    }
  },
  conditionMet: (p, ctx) => {
    const car = ctx.probe.car(contractCarId(ctx.item));
    return !p.violated && car !== null && car.scratches <= SCRATCHES_LIMIT;
  },
  onDelivered: (item) => {
    const carId = contractCarId(item);
    return {
      // Uncoupled first, then consumed: the bar's joint must be gone before its
      // towed body is disposed, and both are applied in this order.
      deltas: [
        { t: 'car_tow', carId, towerId: null },
        { t: 'car_remove', carId },
      ],
    };
  },
};
