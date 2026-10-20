/**
 * The money of the drive: what a delivery pays, what a thing costs and how many
 * contracts a car carries.
 *
 * The coin item (`CoinItem`, items/items.ts) is the currency and the pack is the
 * purse: coins stack into one pile there, and `Inventory.spendCoins` takes from it.
 * Everything in this file is a pure function of its arguments and the saved state, so
 * a prompt and the action behind it can never disagree about a price.
 *
 * Pay and vending prices rise with the distance from home on a saturating curve,
 * `kmIndex`, about ×3 at most. Car prices do not.
 */

import type { WorldState } from '../game/state';
import type { ContractKind } from '../contracts/types';
import { passengerQuality } from '../contracts/kinds/teddyPassengers';
import type { ContractCargoItem, Inventory, Item } from '../items/items';
import { variant, type PartKind } from '../parts/registry';
import { postStop } from '../world/poststops';

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
// Coins
// ---------------------------------------------------------------------------

/** Coins in the player's pack. The pile is one stack (`Inventory.add`). */
export function coinsHeld(state: WorldState): number {
  let total = 0;
  for (const item of state.player.carried) if (item.type === 'coin') total += item.value;
  return total;
}

/**
 * Takes `n` coins out of the pack. False, and nothing taken, when the pack holds
 * fewer. The pack is authoritative in-session, so this goes through `Inventory` and
 * its listener mirrors the change into state.
 */
export function spendCoins(inventory: Inventory, n: number): boolean {
  return inventory.spendCoins(Math.round(n));
}

/**
 * Puts `n` coins into the pack, onto the pile already carried or into a free slot.
 * Returns the coin item when the pack had no room for it, so the caller can leave it
 * where it was earned (a courier's boot cell, the ground); null when it went in.
 */
export function giveCoins(inventory: Inventory, n: number, id: string): Item | null {
  const value = Math.round(n);
  if (value < 1) return null;
  const coin: Item = { type: 'coin', id, value };
  return inventory.add(coin) ? null : coin;
}

// ---------------------------------------------------------------------------
// Delivery pay
// ---------------------------------------------------------------------------

/**
 * Base pay of one delivery by kind, coins at home (km index 1). Per delivery, not
 * per km. A nine-kilometre hop burns about half a litre in the Oka (0.6 coin of
 * petrol, `PRICE_TABLE`), so a parcel leaves three coins or so towards oil, filters
 * and the next car; the bigger kinds pay for the bigger car they need.
 */
export const DELIVERY_BASE_PAY: Readonly<Record<ContractKind, number>> = {
  parcel: 4,
  heavy_crate: 6,
  fragile_radio: 7,
  trailer_equipment: 10,
  oversize: 12,
  towing: 10,
  car_transfer: 10,
  teddy_passengers: 4,
};

/** Each passenger of a party past the first adds this share of the kind's base pay. */
const EXTRA_PASSENGER_SHARE = 0.5;

/**
 * Coins one delivery pays: base by kind × the SOURCE post stop's km index × the
 * delivery's quality (0..1; a fragile radio's condition, a passenger party's ride,
 * 1 for every other kind), and for a party of `passengers` teddies half the base again
 * for each past the first. Never below one coin: a delivered contract always pays
 * something.
 */
export function deliveryPay(kind: ContractKind, sourceKm: number, quality: number, passengers = 1): number {
  const q = Math.min(1, Math.max(0, quality));
  const party = 1 + EXTRA_PASSENGER_SHARE * Math.max(0, passengers - 1);
  return Math.max(1, Math.round(DELIVERY_BASE_PAY[kind] * party * kmIndex(sourceKm) * q));
}

/**
 * What this cargo pays when a post signs it: `deliveryPay` at its source stop's
 * distance, with a fragile radio's condition or a passenger party's ride
 * (contracts/kinds/teddyPassengers.ts `passengerQuality`, read off the teddy handed in
 * last) as the quality.
 */
export function contractPay(seed: number, item: ContractCargoItem): number {
  const sourceKm = postStop(seed, item.sourceCourierIndex).s / 1000;
  const quality = item.contractKind === 'fragile_radio'
    ? item.progress.condition ?? 1
    : item.contractKind === 'teddy_passengers' ? passengerQuality(item) : 1;
  return deliveryPay(item.contractKind, sourceKm, quality, item.party?.size ?? 1);
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Base prices at home, coins. The МАГАЗИН machines multiply by `kmIndex` of where they
 * stand (`itemPrice`); cars are priced flat (`carPrice`).
 */
export const PRICE_TABLE = {
  /** An empty can: a coin, plus a little for every litre it holds. Fluids are not sold. */
  can: 1,
  canPerLitre: 0.1,
  /** Parts by kind, new. A worn part sells for less (`itemPrice`). */
  part: { engine: 30, gearbox: 15, radiator: 8, turbine: 25, air_filter: 3 } as Readonly<Record<PartKind, number>>,
  bubble_gum: 1,
  spray_can: 3,
  sun_shades: 4,
  sticker_envelope: 4,
  /** Cars by model id, flat (never × km index). Unlisted models: `CAR_PRICE_DEFAULT`. */
  car: {
    kit_vaz1111: 20,
    kit_vaz2101: 30,
    kit_vaz2103: 32,
    kit_vaz2105: 34,
    kit_vaz2106: 36,
    kit_vaz2107: 38,
    kit_azlk2141: 42,
    kit_vaz2108: 44,
    kit_vaz2109: 46,
    kit_vaz21099: 48,
    kit_gaz24: 50,
    kit_vaz2115: 54,
    kit_vaz2110: 55,
    kit_vaz2112: 58,
    kit_gaz31029: 60,
    kit_vaz2121: 62,
    kit_vaz2102: 60,
    kit_vaz2104: 65,
    kit_vaz2111: 75,
    kit_uaz469: 80,
    kit_uaz469_police: 80,
    kit_vaz2131: 90,
    kit_nexia: 90,
    kit_astraf: 100,
    kit_vectraa: 105,
    kit_espero: 110,
    kit_uaz2206: 120,
  } as Readonly<Record<string, number>>,
} as const;

const CAR_PRICE_DEFAULT = 60;

/**
 * What a МАГАЗИН machine at `km` asks for this item: its base price × the km index,
 * rounded, never under one coin. A part is priced by kind and scaled down by its
 * wear; a can by its size. Items no machine sells (the postcard, contract cargo,
 * coins) price at 0.
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

/** A car's price, coins. Flat across the road: a car is a car wherever it stands. */
export function carPrice(modelId: string): number {
  return PRICE_TABLE.car[modelId] ?? CAR_PRICE_DEFAULT;
}

// ---------------------------------------------------------------------------
// Contract slots
// ---------------------------------------------------------------------------

/** Estates carry two contracts at once, the van three; everything else one. */
const CONTRACT_SLOTS: Readonly<Record<string, number>> = {
  kit_vaz2102: 2,
  kit_vaz2104: 2,
  kit_vaz2111: 2,
  kit_vaz2131: 2,
  kit_uaz2206: 3,
};

/** How many contracts one car of this model may carry, boot and cabin together; a teddy party is one. */
export function contractSlotsFor(modelId: string): number {
  return CONTRACT_SLOTS[modelId] ?? 1;
}
