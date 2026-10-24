/**
 * The contract kind registry. One entry per kind, from its own module under
 * `kinds/`; adding a kind means importing its definition here and nowhere else. The
 * helper functions are what the post machine (world/post.ts), the interaction prompts and the
 * runtime call.
 */

import { contractKindOf, type ContractCargoItem } from '../items/items';
import type { StickerKind } from '../items/stickercatalog';
import { carTransferKind } from './kinds/carTransfer';
import { thingKind } from './kinds/thing';
import { towingKind } from './kinds/towing';
import { teddyPartyIds, teddyPassengersKind } from './kinds/teddyPassengers';
import { trailerKind } from './kinds/trailer';
import { CONTRACT_KIND_IDS, type ContractKind, type ContractKindDef, type DeliveryEffect, type DeliveryProbe } from './types';

const CONTRACT_KINDS: readonly ContractKindDef[] = [
  thingKind,
  trailerKind,
  towingKind,
  carTransferKind,
  teddyPassengersKind,
];

const BY_KIND = Object.fromEntries(
  CONTRACT_KINDS.map((def) => [def.kind, def]),
) as Partial<Record<ContractKind, ContractKindDef>>;

/**
 * The module for an item's kind. A defensive fallback to the plain thing: every kind
 * has a module, so this only covers a future id without one.
 */
function contractKindDef(item: ContractCargoItem): ContractKindDef {
  return BY_KIND[contractKindOf(item)] ?? thingKind;
}

/**
 * The physical items the post machine releases for `offer`: one teddy per passenger
 * of a party, else the offer item itself. All of them go into the tray together.
 */
export function contractRelease(offer: ContractCargoItem): readonly ContractCargoItem[] {
  return contractKindDef(offer).release?.(offer) ?? [offer];
}

/** Finishes a freshly generated offer with what its kind adds (a passenger party). */
export function dressContractOffer(offer: ContractCargoItem): void {
  contractKindDef(offer).dressOffer?.(offer);
}

/** What posting one item does to its contract; see `contractPosting`. */
export interface ContractPosting {
  /** The contract the item belongs to (`contractIdOf`): what completes, pays and is raced. */
  readonly contractId: string;
  /** This item is the last of its contract still out: the contract completes and pays now. */
  readonly completes: boolean;
  /** Items of the contract still out after this one. */
  readonly left: number;
}

/**
 * Posting `item` at a post's slot, given the saved `completedContractIds`. An ordinary
 * contract completes with its one item. A passenger party is posted one teddy at a
 * time: each posted teddy's own id is recorded (without a kind, so the ledger does not
 * count it), and the teddy that finds every other one of its party already recorded
 * completes the party's contract.
 */
export function contractPosting(item: ContractCargoItem, completedIds: readonly string[]): ContractPosting {
  if (!item.party) return { contractId: item.id, completes: true, left: 0 };
  let left = 0;
  for (const id of teddyPartyIds(item.party)) {
    if (id !== item.id && !completedIds.includes(id)) left++;
  }
  return { contractId: item.party.id, completes: left === 0, left };
}

/** True for every declared kind id, so a saved item's kind can be validated. */
export function isContractKind(value: unknown): value is ContractKind {
  return typeof value === 'string' && CONTRACT_KIND_IDS[value as ContractKind] === true;
}

/**
 * Why this post may not accept the cargo, or null. The base rule — a post
 * never signs cargo from itself or one further down the road — applies to every
 * kind; a kind adds its own on top (a trailer load needs its trailer in the yard, a
 * car to hand over needs it parked empty).
 *
 * `probe` is the world at the accepting post, built by the post machine and
 * handed to the prompt and the commit alike.
 */
export function contractAcceptRefusal(
  item: ContractCargoItem,
  probe: DeliveryProbe,
): string | null {
  if (probe.targetPostIndex <= item.sourceCourierIndex) {
    return 'this post cannot sign for its own things';
  }
  // A two-stop race is signed from its finish on: handing it in at the first stop
  // would end a two-ruble race at the distance of a one-ruble one.
  if (item.raceLegs !== undefined && probe.targetPostIndex < item.sourceCourierIndex + item.raceLegs) {
    return 'this one races on to the next post';
  }
  return contractKindDef(item).acceptRefusal?.(item, probe) ?? null;
}

/**
 * The sticker a delivery pays: the kind's signature sticker, or the offer's
 * seed-random reward for a kind without one. Nothing on the way is scored.
 */
export function contractRewardSticker(item: ContractCargoItem): StickerKind {
  return contractKindDef(item).signatureSticker ?? item.rewardStickerKind;
}

/**
 * The world change a delivery also performs: consuming the trailer, the car or the
 * part the contract is about. The interaction code applies this AFTER the
 * `courier_storage` delta that writes the envelope and the completed id, so a crash
 * between the two halves leaves the cargo delivered and cannot pay twice.
 */
export function contractDeliveryEffect(item: ContractCargoItem, probe: DeliveryProbe): DeliveryEffect | null {
  return contractKindDef(item).onDelivered?.(item, probe) ?? null;
}
