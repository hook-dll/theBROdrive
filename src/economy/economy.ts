/**
 * The money of the drive: what a delivery pays, what a thing costs and how many
 * contracts a car carries.
 *
 * Money is rubles and kopecks, and every amount in the game is an integer number of
 * KOPECKS: the balance, the prices, the pay. The player's balance is `PlayerState.money`,
 * which is not an item: a money machine being worked debits or pays it directly
 * (`debit`, `credit`).
 * Everything else in this file is a pure function of its arguments and the saved state,
 * so a card and the action behind it can never disagree about a price.
 *
 * Pay and vending prices rise with the distance from home on a saturating curve,
 * `kmIndex`, about ×3 at most. Car prices do not.
 */

import type { CarState, GameWorld } from '../game/state';
import { passengerQuality } from '../contracts/kinds/teddyPassengers';
import { contractThing, type ContractCargoItem, type Item } from '../items/items';
import { variant, type PartKind } from '../parts/registry';
import { postStop } from '../world/poststops';

/** Kopecks in a ruble: every price below is written as rubles times this. */
export const RUB = 100;

/** How quickly pay and prices saturate with distance, km. */
const KM_INDEX_SCALE_KM = 150;

/**
 * The distance multiplier on pay and vending prices: 1 at home, about 1.5 at 50 km,
 * 2.3 at 300 km, and never above 3.
 */
export function kmIndex(km: number): number {
  return 1 + 2 * (1 - Math.exp(-Math.max(0, km) / KM_INDEX_SCALE_KM));
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * An amount as it is painted everywhere: `3р 50коп`, with a zero part left out
 * (`50коп`, `4р`); nothing at all reads `0коп`.
 */
export function formatMoney(kopecks: number): string {
  const total = Math.max(0, Math.round(kopecks));
  const rub = Math.floor(total / RUB);
  const kop = total % RUB;
  if (rub === 0) return `${kop}коп`;
  return kop === 0 ? `${rub}р` : `${rub}р ${kop}коп`;
}

/**
 * Takes `kopecks` from the player's money. False, and nothing taken, when it is less: a
 * machine short of its price gives nothing.
 */
export function debit(world: GameWorld, kopecks: number): boolean {
  const amount = Math.max(0, Math.round(kopecks));
  const balance = world.state.player.money;
  if (balance < amount) return false;
  if (amount > 0) world.apply({ t: 'money', kopecks: balance - amount });
  return true;
}

/** Adds `kopecks` to the player's money. */
export function credit(world: GameWorld, kopecks: number): void {
  const amount = Math.max(0, Math.round(kopecks));
  if (amount > 0) world.apply({ t: 'money', kopecks: world.state.player.money + amount });
}

// ---------------------------------------------------------------------------
// Delivery pay
// ---------------------------------------------------------------------------

/** Each passenger of a party past the first adds this share of the base pay. */
const EXTRA_PASSENGER_SHARE = 0.5;

/**
 * Kopecks one delivery pays: the thing's base pay at home (items/things.ts
 * `payKopecks`; a nine-kilometre hop burns about half a litre in the Oka, 20 kopecks of
 * petrol, so a three-ruble thing leaves most of it towards oil, filters and the next car)
 * × the SOURCE post stop's km index × the delivery's quality (0..1; a thing's condition,
 * a passenger party's ride, 1 for a haul), and for a party of
 * `passengers` teddies half the base again for each past the first. Never below one
 * kopeck: a delivered contract always pays something.
 */
export function deliveryPay(baseKopecks: number, sourceKm: number, quality: number, passengers = 1): number {
  const q = Math.min(1, Math.max(0, quality));
  const party = 1 + EXTRA_PASSENGER_SHARE * Math.max(0, passengers - 1);
  return Math.max(1, Math.round(baseKopecks * party * kmIndex(sourceKm) * q));
}

/**
 * What this cargo pays when a post signs it: `deliveryPay` at its source stop's
 * distance, with the thing's condition (contracts/runtime.ts) or a passenger party's ride
 * (contracts/kinds/teddyPassengers.ts `passengerQuality`, read off the teddy handed in
 * last) as the quality.
 */
export function contractPay(seed: number, item: ContractCargoItem): number {
  const thing = contractThing(item);
  const sourceKm = postStop(seed, item.sourceCourierIndex).s / 1000;
  const quality = item.party ? passengerQuality(item) : item.progress.condition ?? 1;
  return deliveryPay(thing.payKopecks, sourceKm, quality, item.party?.size ?? 1);
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Base prices at home, kopecks. The SHOP machines multiply by `kmIndex` of where they
 * stand (`itemPrice`); cars are priced flat (`carPrice`).
 */
export const PRICE_TABLE = {
  /**
   * A can: fifty kopecks for the can and forty for every litre it holds, the price of
   * the petrol it is for. Fluids are not sold: it is filled at a barrel.
   */
  can: 50,
  canPerLitre: 40,
  /** Parts by kind, new. A worn part sells for less (`itemPrice`). */
  part: {
    engine: 35 * RUB,
    gearbox: 18 * RUB,
    radiator: 9 * RUB,
    turbine: 30 * RUB,
    air_filter: 2 * RUB + 50,
  } as Readonly<Record<PartKind, number>>,
  bubble_gum: 15,
  spray_can: RUB + 20,
  sun_shades: 3 * RUB,
  sticker_envelope: 50,
  /**
   * Cars by model id, flat (never × km index): the coin table of the coin days × 1.25 in
   * whole rubles, 25 to 150, with the Oka at 30. Unlisted models: `CAR_PRICE_DEFAULT`.
   */
  car: {
    kit_vaz1111: 30 * RUB,
    kit_vaz2101: 38 * RUB,
    kit_vaz2103: 40 * RUB,
    kit_vaz2105: 43 * RUB,
    kit_vaz2106: 45 * RUB,
    kit_vaz2107: 48 * RUB,
    kit_azlk2141: 53 * RUB,
    kit_vaz2108: 55 * RUB,
    kit_vaz2109: 58 * RUB,
    kit_vaz21099: 60 * RUB,
    kit_gaz24: 63 * RUB,
    kit_vaz2115: 68 * RUB,
    kit_vaz2110: 69 * RUB,
    kit_vaz2112: 73 * RUB,
    kit_gaz31029: 75 * RUB,
    kit_vaz2121: 78 * RUB,
    kit_vaz2102: 75 * RUB,
    kit_vaz2104: 81 * RUB,
    kit_vaz2111: 94 * RUB,
    kit_uaz469: 100 * RUB,
    kit_vaz2131: 113 * RUB,
    kit_nexia: 113 * RUB,
    kit_astraf: 125 * RUB,
    kit_vectraa: 131 * RUB,
    kit_espero: 138 * RUB,
    kit_uaz2206: 150 * RUB,
  } as Readonly<Record<string, number>>,
} as const;

const CAR_PRICE_DEFAULT = 75 * RUB;

/**
 * What a SHOP machine at `km` asks for this item: its base price × the km index,
 * rounded to the kopeck, never under one. A part is priced by kind and scaled down by
 * its wear; a can by its size. Items no machine sells (contract cargo) price at 0.
 */
export function itemPrice(item: Item, km: number): number {
  const base = itemBasePrice(item);
  if (base <= 0) return 0;
  return Math.max(1, Math.round(base * kmIndex(km)));
}

function itemBasePrice(item: Item): number {
  switch (item.type) {
    case 'fluid_can':
      return PRICE_TABLE.can + item.capacity * PRICE_TABLE.canPerLitre;
    case 'part': {
      const wear = Math.max(item.part.dirt, item.part.rust);
      return PRICE_TABLE.part[variant(item.part.variantId).kind] * (1 - 0.5 * Math.min(1, Math.max(0, wear)));
    }
    case 'bubble_gum':
      return PRICE_TABLE.bubble_gum;
    case 'spray_can':
      return PRICE_TABLE.spray_can;
    case 'sun_shades':
      return PRICE_TABLE.sun_shades;
    case 'sticker_envelope':
      return PRICE_TABLE.sticker_envelope;
    default:
      return 0;
  }
}

/** A car's price, kopecks. Flat across the road: a car is a car wherever it stands. */
export function carPrice(modelId: string): number {
  return PRICE_TABLE.car[modelId] ?? CAR_PRICE_DEFAULT;
}

// ---------------------------------------------------------------------------
// Uniqueness
// ---------------------------------------------------------------------------

/** A car's uniqueness (game-design2.md §12): how many stickers it has earned. */
export function carUniqueness(car: CarState): number {
  return car.stickers.length;
}
