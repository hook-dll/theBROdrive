/**
 * The money of the drive: what a delivery pays, what a thing costs and how many
 * contracts a car carries.
 *
 * Money is whole RUBLES, and every amount in the game is an integer number of them: the
 * balance, the prices, the pay. There are no kopecks; a ruble is the smallest calcite
 * ball, ten of them one middle ball, ten middle ones one big (economy/money.ts). The player's balance is `PlayerState.money`,
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
import { isLate, URGENT_BONUS } from '../contracts/types';
import { contractThing, type ContractCargoItem, type Item } from '../items/items';
import { variant, type PartKind } from '../parts/registry';
import { postStop } from '../world/poststops';
import { moneyToken } from './money';

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
 * An amount as it goes into any text the game paints: a money token
 * (economy/money.ts), drawn as calcite balls by every painter of that text — the HUD
 * (ui/balls.ts), the boards and the cards.
 */
export function formatMoney(rubles: number): string {
  return moneyToken(rubles);
}

/**
 * Takes `rubles` from the player's money. False, and nothing taken, when it is less: a
 * machine short of its price gives nothing.
 */
export function debit(world: GameWorld, rubles: number): boolean {
  const amount = Math.max(0, Math.round(rubles));
  const balance = world.state.player.money;
  if (balance < amount) return false;
  if (amount > 0) world.apply({ t: 'money', rubles: balance - amount });
  return true;
}

/** Adds `rubles` to the player's money. */
export function credit(world: GameWorld, rubles: number): void {
  const amount = Math.max(0, Math.round(rubles));
  if (amount > 0) world.apply({ t: 'money', rubles: world.state.player.money + amount });
}

// ---------------------------------------------------------------------------
// Delivery pay
// ---------------------------------------------------------------------------

/** Each passenger of a party past the first adds this share of the base pay. */
const EXTRA_PASSENGER_SHARE = 0.5;

/**
 * Rubles one delivery pays: the thing's base pay at home (items/things.ts `pay`; a
 * nine-kilometre hop burns about half a litre in the Oka, 2 rubles of petrol, so a
 * thirty-ruble thing leaves most of it towards oil, filters and the next car)
 * × the SOURCE post stop's km index × the delivery's quality (0..1; a thing's condition,
 * a passenger party's ride, 1 for a haul), and for a party of
 * `passengers` teddies half the base again for each past the first. Never below one
 * ruble: a delivered contract always pays something.
 */
export function deliveryPay(baseRubles: number, sourceKm: number, quality: number, passengers = 1): number {
  const q = Math.min(1, Math.max(0, quality));
  const party = 1 + EXTRA_PASSENGER_SHARE * Math.max(0, passengers - 1);
  return Math.max(1, Math.round(baseRubles * party * kmIndex(sourceKm) * q));
}

/**
 * What this cargo pays when a post signs it: `deliveryPay` at its source stop's
 * distance, with the thing's condition (contracts/runtime.ts) or a passenger party's ride
 * (contracts/kinds/teddyPassengers.ts `passengerQuality`, read off the teddy handed in
 * last) as the quality, × the uniqueness bonus of the delivering car with `stickers`
 * (`uniquenessBonus`), and an urgent contract on time `URGENT_BONUS` more (late, the
 * plain pay).
 */
export function contractPay(seed: number, item: ContractCargoItem, stickers: number): number {
  const thing = contractThing(item);
  const sourceKm = postStop(seed, item.sourceCourierIndex).s / 1000;
  const quality = item.party ? passengerQuality(item) : item.progress.condition ?? 1;
  const pay = Math.round(deliveryPay(thing.pay, sourceKm, quality, item.party?.size ?? 1) * (1 + uniquenessBonus(stickers)));
  return item.urgentS !== undefined && !isLate(item) ? Math.round(pay * (1 + URGENT_BONUS)) : pay;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Base prices at home, rubles. The SHOP machines multiply by `kmIndex` of where they
 * stand (`itemPrice`); cars are priced flat (`carPrice`).
 */
export const PRICE_TABLE = {
  /**
   * A can: five rubles for the can and four for every litre it holds, the price of the
   * petrol it is for. Fluids are not sold: it is filled at a barrel.
   */
  can: 5,
  canPerLitre: 4,
  /** Parts by kind, new. A worn part sells for less (`itemPrice`). */
  part: {
    engine: 350,
    gearbox: 180,
    radiator: 90,
    turbine: 300,
    air_filter: 25,
  } as Readonly<Record<PartKind, number>>,
  bubble_gum: 2,
  spray_can: 12,
  sun_shades: 30,
  sticker_envelope: 5,
  /**
   * Cars by model id, flat (never × km index): the coin table of the coin days × 12.5,
   * 250 to 1500 rubles, with the Oka at 300. Unlisted models: `CAR_PRICE_DEFAULT`.
   */
  car: {
    kit_vaz1111: 300,
    kit_vaz2101: 380,
    kit_vaz2103: 400,
    kit_vaz2105: 430,
    kit_vaz2106: 450,
    kit_vaz2107: 480,
    kit_azlk2141: 530,
    kit_vaz2108: 550,
    kit_vaz2109: 580,
    kit_vaz21099: 600,
    kit_gaz24: 630,
    kit_vaz2115: 680,
    kit_vaz2110: 690,
    kit_vaz2112: 730,
    kit_gaz31029: 750,
    kit_vaz2121: 780,
    kit_vaz2102: 750,
    kit_vaz2104: 810,
    kit_vaz2111: 940,
    kit_uaz469: 1000,
    kit_vaz2131: 1130,
    kit_nexia: 1130,
    kit_astraf: 1250,
    kit_vectraa: 1310,
    kit_espero: 1380,
    kit_uaz2206: 1500,
  } as Readonly<Record<string, number>>,
} as const;

const CAR_PRICE_DEFAULT = 750;

/**
 * What a SHOP machine at `km` asks for this item: its base price × the km index,
 * rounded to the ruble, never under one. A part is priced by kind and scaled down by
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

/** A car's price, rubles. Flat across the road: a car is a car wherever it stands. */
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

/** Stickers on the post's lay-by car that open its fifth card, the special things. */
export const SPECIAL_CARD_STICKERS = 3;
/** Stickers from which the fifth card may offer a relic too. */
export const RELIC_STICKERS = 8;
/** Pay bonus per sticker of the delivering car, and its cap: +3% each, +30% at most (10 stickers). */
const STICKER_BONUS = 0.03;
const STICKER_BONUS_CAP = 0.3;

/** The share a car with `stickers` adds to a delivery's pay (`contractPay`). */
export function uniquenessBonus(stickers: number): number {
  return Math.min(STICKER_BONUS_CAP, STICKER_BONUS * Math.max(0, stickers));
}

/** The card line that explains `uniquenessBonus`, or null without stickers: "+12% for 4 stickers". */
export function uniquenessBonusText(stickers: number): string | null {
  if (stickers <= 0) return null;
  return `+${Math.round(uniquenessBonus(stickers) * 100)}% for ${stickers} sticker${stickers === 1 ? '' : 's'}`;
}
