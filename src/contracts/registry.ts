/**
 * The contract kind registry. One entry per kind, from its own module under
 * `kinds/`; adding a kind means importing its definition here and nowhere else. The
 * helper functions are what the courier code, the interaction prompts and the
 * runtime call.
 */

import type { ContractCargoItem } from '../items/items';
import type { StickerKind } from '../items/stickercatalog';
import { carTransferKind } from './kinds/carTransfer';
import { fragileRadioKind } from './kinds/fragileRadio';
import { heavyCrateKind } from './kinds/heavyCrate';
import { oversizeKind } from './kinds/oversize';
import { parcelKind } from './kinds/parcel';
import { towingKind } from './kinds/towing';
import { trailerEquipmentKind } from './kinds/trailerEquipment';
import {
  CONTRACT_KIND_IDS,
  type ContractKind,
  type ContractKindDef,
  type DeliveryContext,
  type DeliveryEffect,
  type DeliveryProbe,
} from './types';

/** Order matters: offers walk this list against their weights. */
export const CONTRACT_KINDS: readonly ContractKindDef[] = [
  parcelKind,
  heavyCrateKind,
  fragileRadioKind,
  trailerEquipmentKind,
  oversizeKind,
  towingKind,
  carTransferKind,
];

const BY_KIND = Object.fromEntries(
  CONTRACT_KINDS.map((def) => [def.kind, def]),
) as Partial<Record<ContractKind, ContractKindDef>>;

/**
 * The module for a declared kind. A defensive fallback to the ordinary parcel: every
 * id that reaches here has a module, so this only covers a future id without one.
 */
export function contractKindDef(kind: ContractKind): ContractKindDef {
  return BY_KIND[kind] ?? parcelKind;
}

/** True for every declared kind id, so a saved item's kind can be validated. */
export function isContractKind(value: unknown): value is ContractKind {
  return typeof value === 'string' && CONTRACT_KIND_IDS[value as ContractKind] === true;
}

/**
 * Why this courier may not accept the cargo, or null. The base rule — a courier
 * never signs cargo from itself or one further down the road — applies to every
 * kind; a kind adds its own on top (trailer equipment needs its trailer in the yard,
 * car transfer needs its car parked empty).
 *
 * `probe` is the world at the accepting courier, built by the delivery code and
 * handed to the prompt and the commit alike.
 */
export function contractAcceptRefusal(
  item: ContractCargoItem,
  probe: DeliveryProbe,
): string | null {
  if (probe.targetCourierIndex <= item.sourceCourierIndex) {
    return 'this courier cannot sign its own parcel';
  }
  // A two-stop race is signed from its finish on: handing it in at the first stop
  // would end a two-coin race at the distance of a one-coin one.
  if (item.raceLegs !== undefined && probe.targetCourierIndex < item.sourceCourierIndex + item.raceLegs) {
    return 'this one races on to the next courier';
  }
  return contractKindDef(item.contractKind).acceptRefusal?.(item, probe) ?? null;
}

/**
 * The sticker a delivery pays. A kind with a signature pays it when its own
 * condition held, and the offer's seed-random reward otherwise: a delivery never
 * fails, it just pays the ordinary sticker.
 */
export function contractRewardSticker(
  item: ContractCargoItem,
  delivery: DeliveryContext,
): StickerKind {
  const def = contractKindDef(item.contractKind);
  if (def.signatureSticker && def.conditionMet(item.progress, delivery)) {
    return def.signatureSticker;
  }
  return item.rewardStickerKind;
}

/**
 * The world change a delivery also performs: consuming the trailer, the car or the
 * part the contract is about. The interaction code applies this AFTER the
 * `courier_storage` delta that writes the envelope and the completed id, so a crash
 * between the two halves leaves the cargo delivered and cannot pay twice.
 */
export function contractDeliveryEffect(
  item: ContractCargoItem,
  probe: DeliveryProbe,
  delivery: DeliveryContext,
): DeliveryEffect | null {
  return contractKindDef(item.contractKind).onDelivered?.(item, probe, delivery) ?? null;
}
