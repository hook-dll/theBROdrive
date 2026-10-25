/**
 * A toy car to a friend (game-design2.md §7.3, §7.8): one specific car, which has to be
 * driven to the next post and parked in its bay.
 *
 * The car is a complete, serviceable car waiting in the SOURCE post's bay before its card
 * is taken (contracts/world.ts `spawnHaulLoad`), named after the offer seed. Taken, it is
 * an ordinary car — you drive it, refuel it, load its boot. It is handed in by reversing
 * it into the destination post's bay (contracts/haulbays.ts) and stepping out: the hand-in
 * refuses while the player sits in it.
 *
 * Its state on arrival is not judged: delivered is delivered.
 *
 * The car stays with the post once handed in, and is cleared away with whatever is in
 * it, so the hand-in also refuses while its boot or seats hold anything.
 */

import { haulLoadId } from '../world';
import type { ContractKindDef, DeliveryProbe } from '../types';
import type { ContractCargoItem } from '../../items/items';

/** Why a haul's car may not be handed over yet for what is left in it, or null. */
export function carEmptyRefusal(item: ContractCargoItem, probe: DeliveryProbe): string | null {
  const car = probe.car(haulLoadId(item));
  if (!car) return null;
  if (car.storage.some((cell) => cell !== null)) return 'empty its boot before handing it over';
  if (car.cabin.some((place) => place !== null)) return 'take your things off its seats before handing it over';
  return null;
}

export const carTransferKind: ContractKindDef = {
  kind: 'car_transfer',
  acceptRefusal: (item, probe) => {
    if (probe.drivingCarId === haulLoadId(item)) return 'step out to hand it over';
    return carEmptyRefusal(item, probe);
  },
};
