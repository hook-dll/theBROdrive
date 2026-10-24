/**
 * Teddy-bear passengers (game-design2.md §10, §11). Not people and not NPCs: stuffed
 * bears the boy imagines as passengers, with no lines and no voices.
 *
 * Each offer rolls its party from its seed, 1, 2 or 3 teddies, and the player cannot
 * change it. The post machine releases the party as that many physical teddies
 * (`release`), each its own item with its own id and the party's id and size on it
 * (`ContractCargoItem.party`). The party is ONE contract: one delivery in the ledger
 * and one pay.
 *
 * Teddies ride only on passenger seats — the front passenger's and either half of the
 * rear bench (vehicle/cabin.ts `layPlace`) — never in the boot, under the bonnet, on the
 * floor or in the driver's seat. Nothing makes them fall off a seat: hard driving costs
 * the ride, never their place. While the party rides in the car the player drives, the
 * ride meter accounts it under the party's id (`trackPassengerRide`) and the comfort and
 * harsh moments are kept on each teddy, so a reload mid-trip keeps the ride so far.
 *
 * Delivery is one teddy at a time through the destination post's slot
 * (registry.ts `contractPosting`): the last one in completes the party and pays
 * `contractPay` scaled by the ride (`passengerQuality`).
 */

import { hash01 } from '../../core/rng';
import type { CarState } from '../../game/state';
import type { CargoParty, ContractCargoItem, Item } from '../../items/items';
import type { RideMeter } from '../../trip/ride';
import { defaultProgress, type ContractKindDef } from '../types';

/** The party-size draw, from the offer's own seed. */
const PARTY_DOMAIN = 0x54444231; // 'TDB1'

/** One stuffed bear, kg. */
const TEDDY_MASS_KG = 0.6;

/** Each harsh moment costs this share of the pay. */
const HARSH_PAY_SHARE = 0.1;
/** However the passengers were driven, a delivered party pays at least this share. */
const PASSENGER_PAY_FLOOR = 0.4;

/** How many teddies ride on this offer: 1, 2 or 3, fixed by its seed. */
export function teddyPartySize(seed: number): number {
  return 1 + Math.min(2, Math.floor(hash01(seed, PARTY_DOMAIN) * 3));
}

/** The ids of every teddy of a party, in the order the post machine releases them. */
export function teddyPartyIds(party: CargoParty): string[] {
  const ids: string[] = [];
  for (let k = 0; k < party.size; k++) ids.push(`${party.id}:teddy:${k}`);
  return ids;
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

/** Party ids the ride meter accounts for at the moment (`trackPassengerRide`). */
const tracked = new Set<string>();
/** Party ids aboard the driven car this step, reused. */
const aboard = new Set<string>();

/**
 * One fixed step while the player drives `car`, after `ride.step`: every party with a
 * teddy on its seats is accounted under its id, starting from the ride already saved
 * on it, and the ride so far is written back onto each of its teddies aboard. A party
 * that left this car (handed in, taken out, or the player drives another) stops being
 * accounted; what it rode is kept on its teddies.
 */
export function trackPassengerRide(ride: RideMeter, car: CarState): void {
  aboard.clear();
  for (const item of car.cabin) {
    if (item?.type !== 'contract_cargo' || !item.party) continue;
    const key = item.party.id;
    if (!aboard.has(key)) {
      aboard.add(key);
      if (!tracked.has(key)) {
        ride.track(key, item.progress.comfort ?? 1, item.progress.harsh ?? 0);
        tracked.add(key);
      }
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
  return item?.type === 'contract_cargo' && item.contractKind === 'teddy_passengers';
}

export const teddyPassengersKind: ContractKindDef = {
  kind: 'teddy_passengers',
  weight: 2,
  offerNames: ['teddy passengers', 'teddy bears on a trip', 'bears to visit', 'teddy party'],
  signatureSticker: null,
  massKg: () => TEDDY_MASS_KG,
  dressOffer(offer) {
    offer.shape = 'teddy';
    offer.party = { id: offer.id, size: teddyPartySize(offer.generatedSeed) };
  },
  release(offer) {
    // Each teddy is the offer itself (destination, race legs, reward) under its own id.
    const party = offer.party ?? { id: offer.id, size: teddyPartySize(offer.generatedSeed) };
    return teddyPartyIds(party).map((id): ContractCargoItem => ({
      ...offer,
      id,
      cargoName: 'teddy passenger',
      shape: 'teddy',
      party,
      massKg: TEDDY_MASS_KG,
      progress: defaultProgress(),
    }));
  },
};
