/**
 * Teddy-bear passengers (game-design2.md §10, §11). Not people and not NPCs: stuffed
 * bears the boy imagines as passengers, with no lines and no voices.
 *
 * A party waits on the bench of a post's teddy shelter (contracts/shelters.ts,
 * world/shelter.ts): 1, 2 or 3 teddies rolled from the party's seed (`dressOffer`),
 * which the player cannot change. Each teddy taken off the bench is its own item
 * (`teddyItem`) with its own id and the party's id and size on it
 * (`ContractCargoItem.party`). The party is ONE contract however many of it are taken;
 * the party is paid once, and only if every teddy of it is seated at its destination (world/shelter.ts).
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
import { defaultProgress, type ContractKindDef } from '../types';

/** The party-size draw, from the offer's own seed. */
const PARTY_DOMAIN = 0x54444231; // 'TDB1'

/** Each harsh moment costs this share of the pay. */
const HARSH_PAY_SHARE = 0.1;
/** However a passenger was driven, a delivered teddy pays at least this share. */
const PASSENGER_PAY_FLOOR = 0.4;

/** How many teddies wait in this party: 1, 2 or 3, fixed by its seed. */
export function teddyPartySize(seed: number): number {
  return 1 + Math.min(2, Math.floor(hash01(seed, PARTY_DOMAIN) * 3));
}

/** The id of the teddy on bench place `seat` of party `partyId`. Saved: never changed. */
export function teddyId(partyId: string, seat: number): string {
  return `${partyId}:teddy:${seat}`;
}

/** The teddy on bench place `seat` of `party` (a shelter's offer) as an item, its ride not begun. */
export function teddyItem(party: ContractCargoItem, seat: number): ContractCargoItem {
  return { ...party, id: teddyId(party.id, seat), progress: defaultProgress() };
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
  dressOffer(offer) {
    offer.party = { id: offer.id, size: teddyPartySize(offer.generatedSeed) };
  },
};
