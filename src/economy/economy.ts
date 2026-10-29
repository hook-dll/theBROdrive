/**
 * The money of the drive: what a delivery pays, what a thing costs, what a kilometre
 * earns and how many contracts a car carries.
 *
 * Money is SHELLS (economy/shells.ts): one kind, each worth one, a plain count in
 * `PlayerState.shells`, which is not an item: a machine being worked takes its price out
 * of the jar directly (`debit`), pay goes in (`credit`). Every amount — a price, pay, a
 * fine — is a whole number of shells, shown in game text as its figure and the shell
 * (`formatPay`).
 *
 * The player earns a shell for every whole kilometre he rides in a car (`payDriving`)
 * and the route's kilometres for a delivery (`contractPay`). A job that closes WITHOUT
 * DELIVERY — its fragile thing broken, handed back or its load returned at another post,
 * its load or a teddy left behind — costs `FINE_SHELLS` (`fine`), once per job.
 * Handed back at the post it was taken at (the boy changed his mind), or an ordinary
 * thing broken, it only pays nothing. Prices are small and flat down the whole road:
 * nothing scales with the distance from home.
 * Everything here but the writers (`debit`, `credit`, `payDriving`, `fine`) is a pure
 * function of its arguments and the saved state, so a card and the action behind it can
 * never disagree about a price.
 */

import type { GameWorld } from '../game/state';
import { offerDestinationIndex } from '../contracts/offers';
import { isLate, URGENT_PAY_FACTOR } from '../contracts/types';
import type { ContractCargoItem, Item } from '../items/items';
import { variant, type PartKind } from '../parts/registry';
import { postStop } from '../world/poststops';
import { addShells, shellToken, takeShells } from './shells';

// ---------------------------------------------------------------------------
// The jar
// ---------------------------------------------------------------------------

/**
 * An amount of shells — a price, pay, a stake, a prize — as it goes into any text the
 * game paints: a shell token (economy/shells.ts), drawn as its figure and the shell by
 * every painter of that text — the HUD (ui/shellsprites.ts), the boards and the cards.
 */
export function formatPay(count: number): string {
  return shellToken(count);
}

/** A fine as it goes into game text: "−3" and the shell, or that the jar had none to take. */
export function formatFine(count: number): string {
  return count > 0 ? `−${formatPay(count)}` : 'no shells to take';
}

/** Takes `count` shells out of the player's jar. False, and nothing taken, when he has fewer. */
export function debit(world: GameWorld, count: number): boolean {
  const have = world.state.player.shells;
  if (have < count) return false;
  if (count > 0) world.apply({ t: 'shells', shells: have - count });
  return true;
}

/**
 * Pays `count` shells into the player's jar; a full jar loses a shell over the rim for
 * each one that goes in (`addShells`). `driveM` is the driving left over after the
 * kilometres this pays for (`payDriving`), written in the same delta so a kilometre can
 * never be paid twice.
 */
export function credit(world: GameWorld, count: number, driveM?: number): void {
  const n = Math.max(0, Math.round(count));
  if (n <= 0) return;
  const adding = addShells(world.state.player.shells, n);
  world.apply({ t: 'shells', shells: adding.shells, driveM, spilled: adding.spilled });
}

/** Metres of riding in a car that earn one shell. */
export const METRES_PER_SHELL = 1000;

/**
 * Pays the whole kilometres the player has ridden in a car since the last one was paid
 * (`PlayerState.driveM`, raised by the odometer of the car he sits in, game/state.ts),
 * a shell each. Called every frame; nothing happens below a kilometre.
 */
export function payDriving(world: GameWorld): void {
  const driven = world.state.player.driveM;
  const km = Math.floor(driven / METRES_PER_SHELL);
  if (km > 0) credit(world, km, driven - km * METRES_PER_SHELL);
}

/** Shells a job closed without delivery costs (`fine`). */
export const FINE_SHELLS = 3;

/**
 * Takes `count` shells out of the player's jar as a FINE. Never below empty — there is
 * no debt — so it returns the shells actually taken. The one rule it serves: a job that
 * closes undelivered costs `FINE_SHELLS`, and each caller fines in the same step as the
 * saved closing it fines for (`completedContractIds`, a broken thing's `progress.broken`),
 * after it, so a reload finds the job closed and never fines again.
 */
export function fine(world: GameWorld, count: number): number {
  const have = world.state.player.shells;
  const taken = takeShells(have, count);
  if (taken === 0) return 0;
  world.apply({ t: 'shells', shells: have - taken, fined: taken });
  return taken;
}

// ---------------------------------------------------------------------------
// Delivery pay
// ---------------------------------------------------------------------------

/**
 * Shells a delivery pays when it is handed in: the kilometres of its route, from its
 * source post to the post it is bound for (`offerDestinationIndex`), rounded, never under
 * one — and twice that for an urgent contract on time (late, the plain pay). Each teddy
 * is paid this for its own route when it gets off (world/shelter.ts). The thing's
 * condition, the car's stickers and the distance from home change nothing.
 */
export function contractPay(seed: number, item: ContractCargoItem): number {
  const km = (postStop(seed, offerDestinationIndex(item)).s - postStop(seed, item.sourceCourierIndex).s) / 1000;
  const pay = Math.max(1, Math.round(km));
  return item.urgentS !== undefined && !isLate(item) ? pay * URGENT_PAY_FACTOR : pay;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** Prices in shells, flat down the whole road. */
export const PRICE_TABLE = {
  /** An empty can by its litres. It is filled at a pump. */
  can: { 5: 1, 10: 2, 20: 3 } as Readonly<Record<number, number>>,
  /** A pump's fill, any amount: paid once as the pouring begins (world/pumps.ts). */
  pumpFill: 1,
  /** Parts by kind, new or worn alike. */
  part: {
    engine: 10,
    gearbox: 7,
    radiator: 5,
    turbine: 9,
    air_filter: 2,
  } as Readonly<Record<PartKind, number>>,
  bubble_gum: 1,
  spray_can: 3,
  sun_shades: 4,
  /** One try at a claw machine (world/claw.ts), won or not. */
  clawTry: 2,
} as const;

/**
 * Lot cars ranked by their old price table (the Oka cheapest at 300, the UAZ-2206
 * dearest at 1500), which `carShells` maps onto `CAR_SHELLS_MIN`..`CAR_SHELLS_MAX`,
 * keeping each model's place between them.
 */
const CAR_RANK: Readonly<Record<string, number>> = {
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
  kit_e34: 1420,
  kit_w124: 1450,
  kit_uaz2206: 1500,
};
const CAR_RANK_DEFAULT = 750;
const CAR_RANK_MIN = 300;
const CAR_RANK_MAX = 1500;
const CAR_SHELLS_MIN = 5;
const CAR_SHELLS_MAX = 10;

/**
 * Shells a machine asks for this item: its count in `PRICE_TABLE`, by kind for a part
 * and by size for a can. Zero for items no machine sells (contract cargo, a claw
 * machine's figurine: its tries are paid, `PRICE_TABLE.clawTry`, not the prize).
 */
export function itemShells(item: Item): number {
  switch (item.type) {
    case 'fluid_can':
      return PRICE_TABLE.can[item.capacity] ?? 0;
    case 'part':
      return PRICE_TABLE.part[variant(item.part.variantId).kind] ?? 0;
    case 'bubble_gum':
      return PRICE_TABLE.bubble_gum;
    case 'spray_can':
      return PRICE_TABLE.spray_can;
    case 'sun_shades':
      return PRICE_TABLE.sun_shades;
    default:
      return 0;
  }
}

/**
 * Shells a lot car of `modelId` costs: `CAR_SHELLS_MIN`..`CAR_SHELLS_MAX` by its place
 * in the old price ranking, the cheapest five and the dearest ten. Flat across the road.
 */
export function carShells(modelId: string): number {
  const rank = CAR_RANK[modelId] ?? CAR_RANK_DEFAULT;
  const t = Math.min(1, Math.max(0, (rank - CAR_RANK_MIN) / (CAR_RANK_MAX - CAR_RANK_MIN)));
  return Math.round(CAR_SHELLS_MIN + t * (CAR_SHELLS_MAX - CAR_SHELLS_MIN));
}
