/**
 * Car transfer (kind 18): the keys and registration for one specific car, which has
 * to be driven to the next courier and handed over parked.
 *
 * The car is a complete, serviceable car spawned beside the SOURCE courier the first
 * time its papers leave that courier's boot (`contracts/world.ts`), named after the
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

/** The parked car counts as delivered inside this radius of the courier, m. */
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
    const dx = probe.courierX - car.x;
    const dz = probe.courierZ - car.z;
    if (dx * dx + dz * dz > DELIVERY_RANGE_M * DELIVERY_RANGE_M) {
      return `park it within ${DELIVERY_RANGE_M} m of the courier`;
    }
    if (car.storage.some((cell) => cell !== null)) return 'empty its boot before handing it over';
    return null;
  },
  onDelivered: (item) => ({
    deltas: [{ t: 'car_remove', carId: contractCarId(item) }],
  }),
};
