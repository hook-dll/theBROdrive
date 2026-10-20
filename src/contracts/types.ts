/**
 * The physical contract system's shared shapes.
 *
 * A contract is not a journal entry: it is a `contract_cargo` item that exists in
 * one physical place (a post's stock, a hand, a car boot, the ground). What makes
 * two of them different is `contractKind`, and every kind's behaviour lives in its
 * own module under `kinds/` behind `ContractKindDef` (registry.ts). This file holds
 * only what all of them share: the kind ids, the progress record that is saved ON
 * the item, and the delivery-time world view the kinds read.
 *
 * NOTHING IS SCORED ON THE WAY but the fragile radio's condition: knocks to the car
 * it rides in and drops to the ground wear it down, and the delivery pays that share
 * of its coins (economy/economy.ts `deliveryPay`). The other thing remembered on the
 * item is whether it has left its source post (`progress.started`), which the
 * rival race reads.
 *
 * `kind` ids are saved: never rename one.
 */

import type { CarState, WorldDelta } from '../game/state';
import type { ContractCargoItem } from '../items/items';
import type { StickerKind } from '../items/stickercatalog';

/** The catalog kinds. English snake_case ids, saved, never renamed. */
export type ContractKind =
  | 'parcel'
  | 'heavy_crate'
  | 'fragile_radio'
  | 'trailer_equipment'
  | 'oversize'
  | 'towing'
  | 'car_transfer'
  | 'teddy_passengers';

/** Every declared kind id, for the save validator. */
export const CONTRACT_KIND_IDS: Record<ContractKind, true> = {
  parcel: true,
  heavy_crate: true,
  fragile_radio: true,
  trailer_equipment: true,
  oversize: true,
  towing: true,
  car_transfer: true,
  teddy_passengers: true,
};

/** Where a contract cargo item currently is: `post` is an offer still in a post's stock. */
export type ContractPlace = 'post' | 'hand' | 'car' | 'loose';

/** What a contract remembers, saved on the item. */
export interface ContractProgress {
  /** Set the first time the cargo leaves its source post. */
  started: boolean;
  /**
   * A fragile radio's condition, 1 (as signed out) down to 0; the delivery's quality.
   * Absent on every other kind and on a radio not yet knocked.
   */
  condition?: number;
  /**
   * A passenger's ride so far (trip/ride.ts): comfort 1 (calm) down to 0, and the harsh
   * moments counted, while its party rode in the car the player drove. Written by
   * `trackPassengerRide` (kinds/teddyPassengers.ts); absent before the first drive.
   */
  comfort?: number;
  harsh?: number;
}

/** A fresh, unstarted contract. */
export function defaultProgress(): ContractProgress {
  return { started: false };
}

/**
 * A read-only look at the physical world at the post that would accept the
 * cargo, built by the delivery code and handed to BOTH the prompt and the commit.
 * That is what keeps a prompt honest: the sentence the player reads while aiming is
 * produced by the same function F will run.
 *
 * Every getter is a live read. A trailer or car that is materialised answers from
 * its physics body; a dormant one answers from its saved pose, so a contract object
 * three kilometres away still resolves.
 */
export interface DeliveryProbe {
  /** Index of the post being delivered to. */
  readonly targetPostIndex: number;
  /** Absolute position of that post's lay-by, where a haul is left (`laybyHaulLateral`). */
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

/**
 * The world changes a kind makes on a successful delivery, applied by the
 * interaction code in the same transaction as `courier_storage` (which writes the
 * envelope and the completed id FIRST, so a crash between the two halves cannot
 * pay twice).
 */
export interface DeliveryEffect {
  /** Structural world changes: `trailer_remove`, `car_remove`. */
  readonly deltas?: readonly WorldDelta[];
}

/** The registry entry for one kind: how it is offered, delivered and rewarded. */
export interface ContractKindDef {
  readonly kind: ContractKind;
  /** Relative chance of being drawn as a post offer. Parcel is the common one. */
  readonly weight: number;
  /** Cargo names this kind draws from, per offer. */
  readonly offerNames: readonly string[];
  /**
   * The sticker every delivery of this kind pays. `null` means the kind has no
   * signature and pays the offer's seed-random reward (parcel).
   */
  readonly signatureSticker: StickerKind | null;
  /** Cargo mass this kind adds to a car or a pair of hands, kg. Omitted = 12 kg. */
  readonly massKg?: (seed: number) => number;
  /**
   * Why this post may not accept the cargo, or null. Called after the base rule
   * (a post never signs cargo from itself or further down the road).
   */
  readonly acceptRefusal?: (item: ContractCargoItem, probe: DeliveryProbe) => string | null;
  /**
   * The world change this delivery also performs: consuming the trailer, car or
   * part the contract is about. Applied only after the post accepted the cargo,
   * in the same transaction as the envelope.
   */
  readonly onDelivered?: (item: ContractCargoItem, probe: DeliveryProbe) => DeliveryEffect | null;
  /**
   * Finishes a freshly generated offer of this kind: its look (`shape`) and, for a
   * passenger contract, its `party`. Called last by `generateContractOffer`.
   */
  readonly dressOffer?: (offer: ContractCargoItem) => void;
  /**
   * The physical items the post machine releases for this offer: a passenger party is
   * one teddy per passenger. Omitted = the offer item itself.
   */
  readonly release?: (offer: ContractCargoItem) => readonly ContractCargoItem[];
  /** The line shown when a delivery of this kind completes and pays `coins`; omitted = the generic one. */
  readonly deliveredText?: (item: ContractCargoItem, coins: number) => string;
}
