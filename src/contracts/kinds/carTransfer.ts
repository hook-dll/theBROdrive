/**
 * Car transfer (kind 18): the keys and registration for one specific car, which has
 * to be driven to the next post and handed over parked on its lay-by.
 *
 * The car is a complete, serviceable car spawned on the SOURCE post's lay-by the first
 * time the post's lever hands over its papers (`contracts/world.ts`), named after the
 * offer seed. It is an ordinary car from then on — you drive it, refuel it, load its
 * boot — and the delivery refuses while you are sitting in it or while it stands
 * more than `DELIVERY_RANGE_M` away.
 *
 * Its state on arrival is not judged: delivered is delivered, and it always pays its
 * signature sticker.
 *
 * The delivery consumes the car, so it also refuses while the boot holds anything —
 * handing a car over must not delete whatever the player left in it.
 */

import { contractCarId } from '../world';
import type { ContractKindDef } from '../types';

/** The parked car counts as delivered inside this radius of the post's lay-by, m. */
const DELIVERY_RANGE_M = 20;

export const carTransferKind: ContractKindDef = {
  kind: 'car_transfer',
  weight: 1,
  offerNames: ['car keys and papers', 'transfer papers', 'registration and keys', 'handover papers'],
  signatureSticker: 'number-07',
  acceptRefusal: (item, probe) => {
    const carId = contractCarId(item);
    const car = probe.car(carId);
    if (!car) return 'its car is not here';
    if (probe.drivingCarId === carId) return 'park it and step out to hand it over';
    const dx = probe.postX - car.x;
    const dz = probe.postZ - car.z;
    if (dx * dx + dz * dz > DELIVERY_RANGE_M * DELIVERY_RANGE_M) {
      return `park it on the post's lay-by, within ${DELIVERY_RANGE_M} m`;
    }
    if (car.storage.some((cell) => cell !== null)) return 'empty its boot before handing it over';
    if (car.cabin.some((place) => place !== null)) return 'take your things off its seats before handing it over';
    return null;
  },
  onDelivered: (item) => ({
    deltas: [{ t: 'car_remove', carId: contractCarId(item) }],
  }),
};
