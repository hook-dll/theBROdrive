/**
 * The physical contract system's shared shapes.
 *
 * A contract is not a journal entry: a thing's is a `contract_cargo` item that exists in
 * one physical place (a post's stock, a hand, a car boot, the ground), and a haul's is its
 * load, a trailer or a car, with the card it was taken on kept in `WorldState.hauls`
 * (game-design2.md §7.8). What it is, is its THING (items/things.ts): one of the boy's
 * things, whose place decides the machinery it rides on — its `ContractKind`, whose
 * behaviour lives in its own module under `kinds/` behind `ContractKindDef`
 * (registry.ts). This file holds only what all of them share: the kind ids, the progress
 * record that is saved ON the item, and the hand-in world view the kinds read.
 *
 * NOTHING IS SCORED ON THE WAY but a thing's condition: knocks to the car it rides in,
 * drops to the ground and harsh driving wear it down (contracts/runtime.ts); its pay does
 * not (economy/economy.ts `contractPay`). Below `BROKEN_BELOW` it is broken: the contract
 * is closed undelivered (and fined) and the thing stays a souvenir.
 */

import type { CarState } from '../game/state';
import type { ContractCargoItem } from '../items/items';

/**
 * The machinery a thing rides on: a thing carried by hand (boot, seat, bench), a
 * trailer load, a towed car, a car driven over, teddy passengers. Counted by id in the
 * saved delivery ledger: never rename one.
 */
export type ContractKind = 'thing' | 'trailer' | 'towing' | 'car_transfer' | 'teddy_passengers';

/** Every declared kind id, for the save validator. */
export const CONTRACT_KIND_IDS: Record<ContractKind, true> = {
  thing: true,
  trailer: true,
  towing: true,
  car_transfer: true,
  teddy_passengers: true,
};

/**
 * Where a contract is now: `post` is an offer still in a post's stock, `machine` a thing
 * TAKE gave into the post machine's grid and the player has not taken out yet
 * (`WorldState.machineGrids`), `haul` a haul taken and not yet handed in
 * (`WorldState.hauls`), the rest where a thing's item lies.
 */
export type ContractPlace = 'post' | 'machine' | 'hand' | 'car' | 'loose' | 'haul';

/** What a contract remembers, saved on the item. */
export interface ContractProgress {
  /**
   * A thing's condition, 1 (as signed out) down to 0; the delivery's quality. Absent on
   * a thing not yet worn, and always on teddies (their quality is the ride) and hauls
   * (the load is not scored).
   */
  condition?: number;
  /**
   * Set once, the moment the condition fell below `BROKEN_BELOW`: the contract is closed
   * there and then. No post signs for it; the thing stays the player's, a broken souvenir
   * (`isBrokenThing`), and no longer wears.
   */
  broken?: true;
  /**
   * A passenger's ride so far (trip/ride.ts): comfort 1 (calm) down to 0, and the harsh
   * moments counted (each scaled by the carrying car's comfort factor), while it rode in
   * the car the player drove. Written by `trackPassengerRide` (kinds/teddyPassengers.ts);
   * absent before the first drive.
   */
  comfort?: number;
  harsh?: number;
  /**
   * An urgent contract's clock: simulation seconds since TAKE (`ContractRuntime.tick`).
   * It runs only in the fixed step while the game runs — never while paused, in a menu,
   * or under the watch's fast-forward — and is saved here so a reload keeps it. A teddy's
   * runs from the moment it was taken off the bench, each teddy its own. Absent on a
   * contract that is not urgent or not yet taken.
   */
  elapsedS?: number;
}

/** Below this condition a thing is broken (game-design2.md §11.1). */
export const BROKEN_BELOW = 0.3;

/** An urgent delivery on time is paid this many times its pay (§7.5). */
export const URGENT_PAY_FACTOR = 2;

/** Seconds left on an urgent contract's clock, negative once late; null when it is not urgent. */
export function urgentRemainingS(item: { readonly urgentS?: number; readonly progress: ContractProgress }): number | null {
  if (item.urgentS === undefined) return null;
  return item.urgentS - (item.progress?.elapsedS ?? 0);
}

/** An urgent contract whose clock has run out: no urgent bonus, base pay. */
export function isLate(item: { readonly urgentS?: number; readonly progress: ContractProgress }): boolean {
  const left = urgentRemainingS(item);
  return left !== null && left < 0;
}

/** A clock reading as `m:ss` (`LATE` once run out), for the card, the label and the HUD. */
export function formatClock(seconds: number): string {
  if (seconds < 0) return 'LATE';
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** A fresh contract: nothing worn, ridden or timed yet. */
export function defaultProgress(): ContractProgress {
  return {};
}

/**
 * A read-only look at the physical world where a contract is handed in, built by the
 * hand-in code and handed to BOTH the prompt and the commit. That is what keeps a
 * prompt honest: the sentence the player reads is produced by the same function the
 * hand-in will run.
 *
 * Every getter is a live read. A trailer or car that is materialised answers from
 * its physics body; a dormant one answers from its saved pose, so a contract object
 * three kilometres away still resolves.
 */
export interface DeliveryProbe {
  /** Index of the post being delivered to. */
  readonly targetPostIndex: number;
  /** Absolute middle of that post's hand-in slot (world/haulbay.ts `postParkingSlot`). */
  readonly postX: number;
  readonly postZ: number;
  /** The car the player sits in (any seat), or null on foot. */
  readonly drivingCarId: string | null;
  /** Absolute X/Z of a trailer, live or saved; null when no such trailer exists. */
  readonly trailerPosition: (trailerId: string) => { readonly x: number; readonly z: number } | null;
  /**
   * Absolute X/Z of a car, live when it is materialised and from its saved pose
   * otherwise. A moving towed car answers from its body: the saved pose is up to a
   * transform-emit interval stale, which at road speed is metres.
   */
  readonly carPosition: (carId: string) => { readonly x: number; readonly z: number } | null;
  /** Saved car by id, or null. Pose, damage and boot contents all read from it. */
  readonly car: (carId: string) => CarState | null;
}

/** The registry entry for one kind: how it is handed in. */
export interface ContractKindDef {
  readonly kind: ContractKind;
  /**
   * The kind's own reason the contract may not be handed in now, or null. A thing's is
   * asked at the post's grid after the base rule (a post never signs for cargo from
   * itself or further down the road); a haul's when its load stands right in a bay
   * (contracts/haulbays.ts), before the bay decides delivery or return.
   */
  readonly acceptRefusal?: (item: ContractCargoItem, probe: DeliveryProbe) => string | null;
  /**
   * Finishes a freshly generated offer of this kind: a passenger party's `party`.
   * Called last by `makeContract`.
   */
  readonly dressOffer?: (offer: ContractCargoItem) => void;
}
