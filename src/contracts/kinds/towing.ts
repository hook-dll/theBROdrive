/**
 * A broken toy car to the repair (game-design2.md §7.3): the papers for one specific
 * immobilised car, which has to be delivered to the next post ON THE BAR — pulled there
 * behind a working car.
 *
 * The car is spawned on the SOURCE post's lay-by the first time the post's lever
 * hands over its papers (`contracts/world.ts`), named after the offer seed, with NO ENGINE
 * in its bay: it cannot idle, it cannot be driven, and the only way to move it is
 * the car-to-car tow bar of kind 17's subsystem (`vehicle/cartow.ts`).
 *
 * How it got there is not judged: the bar may come off on the way and the car may
 * arrive battered. Delivered is delivered, and it always pays its signature sticker.
 *
 * The delivery consumes the car, so it also refuses while the car's boot holds
 * anything: handing over a car must not delete whatever the player left in it.
 */

import { contractCarId } from '../world';
import type { ContractKindDef } from '../types';

/** The towed car counts as delivered inside this radius of the post's lay-by, m. */
const DELIVERY_RANGE_M = 20;

export const towingKind: ContractKindDef = {
  kind: 'towing',
  signatureSticker: 'learner',
  acceptRefusal: (item, probe) => {
    const carId = contractCarId(item);
    const car = probe.car(carId);
    const at = probe.carPosition(carId);
    if (!car || !at) return 'its car is not here';
    const dx = probe.postX - at.x;
    const dz = probe.postZ - at.z;
    if (dx * dx + dz * dz > DELIVERY_RANGE_M * DELIVERY_RANGE_M) {
      return `bring it onto the post's lay-by, within ${DELIVERY_RANGE_M} m — on the bar is fine`;
    }
    if (car.storage.some((cell) => cell !== null)) return 'empty its boot before handing it over';
    if (car.cabin.some((place) => place !== null)) return 'take your things off its seats before handing it over';
    return null;
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
