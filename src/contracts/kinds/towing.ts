/**
 * A broken toy car to the repair (game-design2.md §7.3, §7.8): one specific immobilised
 * car, which has to be delivered to the next post ON THE BAR — pulled there behind a
 * working car.
 *
 * The car waits in the SOURCE post's pick-up slot (contracts/hauls.ts, contracts/world.ts
 * `spawnHaulLoad`), named after its contract, with NO ENGINE in its bay: it cannot idle,
 * it cannot be driven, and the only way to move it is the car-to-car tow bar of kind 17's
 * subsystem (`vehicle/cartow.ts`); putting it on the bar takes it. It is handed in by
 * backing it into the destination post's bay on the bar (contracts/haulbays.ts), which
 * drops the bar.
 *
 * How it got there is not judged: the bar may come off on the way and the car may
 * arrive battered. Delivered is delivered.
 *
 * The car stays with the post once handed in, and is cleared away with whatever is in
 * it, so the hand-in refuses while its boot or seats hold anything of the player's.
 */

import type { ContractKindDef } from '../types';
import { carEmptyRefusal } from './carTransfer';

export const towingKind: ContractKindDef = {
  kind: 'towing',
  acceptRefusal: carEmptyRefusal,
};
