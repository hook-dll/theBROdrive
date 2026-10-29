/**
 * Teddy-bear passengers (game-design2.md §10, §11). Not people and not NPCs: stuffed
 * bears the boy imagines as passengers, with no lines and no voices.
 *
 * Teddies wait on the bench of a post's teddy shelter (contracts/shelters.ts,
 * world/shelter.ts): 1, 2 or 3 a round (`shelterTeddyCount`), rolled from the round's
 * seed, which the player cannot change. EACH TEDDY IS ITS OWN CONTRACT (contracts/offers.ts
 * `shelterTeddies`): its own id, destination, urgent clock and pay. Most ride to the next
 * town or the one after, now and then one further (`teddyHop`), so teddies of one bench
 * can be bound for different towns.
 *
 * Teddies ride only on passenger seats — the front passenger's and either half of the
 * rear bench (vehicle/cabin.ts `layPlace`) — never in the boot, under the bonnet, on the
 * floor or in the driver's seat. Nothing makes them fall off a seat: hard driving costs
 * the ride, never their place. While a teddy rides in the car the player drives, the
 * ride meter accounts it under its own id (`trackPassengerRide`), softened by that car's
 * comfort (§11.2, `comfortFactor`), and the comfort and harsh moments are kept on the
 * teddy, so a reload mid-trip keeps the ride so far (`passengerQuality`); it does not
 * change the pay (economy/economy.ts `contractPay`).
 */

import { hash01 } from '../../core/rng';
import type { CarState } from '../../game/state';
import type { ContractCargoItem, Item } from '../../items/items';
import type { RideMeter } from '../../trip/ride';
import { carModel, comfortFactor } from '../../vehicle/carmodels';
import type { ContractKindDef } from '../types';

/** A round's teddy count, from the round's seed: the draw the parties had, so a save's rounds keep their teddies. */
const COUNT_DOMAIN = 0x54444231; // 'TDB1'
/** A teddy's hop, from its own seed. */
const HOP_DOMAIN = 0x54444832; // 'TDH2'
/** Shares of the teddies riding one town on and two; the rest ride three. */
const HOP_ONE_SHARE = 0.55;
const HOP_TWO_SHARE = 0.35;

/** Each harsh moment costs this share of the pay. */
const HARSH_PAY_SHARE = 0.1;
/** However a passenger was driven, a delivered teddy pays at least this share. */
const PASSENGER_PAY_FLOOR = 0.4;

/** How many teddies wait on a shelter's bench in a round: 1, 2 or 3, fixed by the round's seed. */
export function shelterTeddyCount(roundSeed: number): number {
  return 1 + Math.min(2, Math.floor(hash01(roundSeed, COUNT_DOMAIN) * 3));
}

/**
 * How many posts past its shelter a teddy rides, from its own seed: the next town
 * (`HOP_ONE_SHARE`), the one after (`HOP_TWO_SHARE`), else the third.
 */
export function teddyHop(teddySeed: number): number {
  const u = hash01(teddySeed, HOP_DOMAIN);
  return u < HOP_ONE_SHARE ? 1 : u < HOP_ONE_SHARE + HOP_TWO_SHARE ? 2 : 3;
}

/**
 * The delivery's quality, 0..1, from the ride saved on a teddy: its comfort less a
 * share per harsh moment, never under the floor. A calm ride is full pay.
 */
export function passengerQuality(item: ContractCargoItem): number {
  const comfort = item.progress.comfort ?? 1;
  const harsh = item.progress.harsh ?? 0;
  return Math.max(PASSENGER_PAY_FLOOR, Math.min(1, comfort - HARSH_PAY_SHARE * harsh));
}

/** Teddy ids the ride meter accounts for at the moment (`trackPassengerRide`). */
const tracked = new Set<string>();
/** Teddy ids aboard the driven car this step, reused. */
const aboard = new Set<string>();

/**
 * One fixed step while the player drives `car`, after `ride.step`: every teddy on its
 * seats is accounted under its own id, starting from the ride already saved on it and
 * scaled by the car's comfort factor, and the ride so far is written back onto it. A
 * teddy that left this car (seated, taken out, or the player drives another) stops
 * being accounted; what it rode is kept on it.
 */
export function trackPassengerRide(ride: RideMeter, car: CarState): void {
  aboard.clear();
  for (const item of car.cabin) {
    if (item?.type !== 'contract_cargo' || item.thing !== 'teddies') continue;
    const key = item.id;
    aboard.add(key);
    if (!tracked.has(key)) {
      const scale = comfortFactor(carModel(car.modelId).comfort);
      ride.track(key, item.progress.comfort ?? 1, item.progress.harsh ?? 0, scale);
      tracked.add(key);
    }
    item.progress.comfort = ride.comfort(key);
    item.progress.harsh = ride.harsh(key);
  }
  for (const key of tracked) {
    if (aboard.has(key)) continue;
    ride.forget(key);
    tracked.delete(key);
  }
}

/** True for a passenger: what may ride only on a seat. */
export function isPassenger(item: Item | null | undefined): boolean {
  return item?.type === 'contract_cargo' && item.thing === 'teddies';
}

export const teddyPassengersKind: ContractKindDef = {
  kind: 'teddy_passengers',
};
