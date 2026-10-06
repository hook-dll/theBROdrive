/**
 * The contract kind registry. One entry per kind, from its own module under
 * `kinds/`; adding a wave-2 kind means importing its definition here and nowhere
 * else. The helper functions are what the courier code, the interaction prompts and
 * the runtime call.
 */

import type { ContractCargoItem } from '../items/items';
import type { StickerKind } from '../items/stickercatalog';
import { baldTyresKind } from './kinds/baldTyres';
import { carTransferKind } from './kinds/carTransfer';
import { cleanDeliveryKind } from './kinds/cleanDelivery';
import { convoyKind } from './kinds/convoy';
import { desertSlalomKind } from './kinds/desertSlalom';
import { dontOverheatKind } from './kinds/dontOverheat';
import { fragileRadioKind } from './kinds/fragileRadio';
import { heavyCrateKind } from './kinds/heavyCrate';
import { longHaulKind } from './kinds/longHaul';
import { medicalThermoKind } from './kinds/medicalThermo';
import { nightCourierKind } from './kinds/nightCourier';
import { oneTankKind } from './kinds/oneTank';
import { oversizeKind } from './kinds/oversize';
import { parcelKind } from './kinds/parcel';
import { partOrderKind } from './kinds/partOrder';
import { photoErrandKind } from './kinds/photoErrand';
import { sandRouteKind } from './kinds/sandRoute';
import { towingKind } from './kinds/towing';
import { trailerEquipmentKind } from './kinds/trailerEquipment';
import { urgentFilmKind } from './kinds/urgentFilm';
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
  urgentFilmKind,
  medicalThermoKind,
  oneTankKind,
  dontOverheatKind,
  cleanDeliveryKind,
  longHaulKind,
  nightCourierKind,
  trailerEquipmentKind,
  oversizeKind,
  carTransferKind,
  partOrderKind,
  convoyKind,
  towingKind,
  baldTyresKind,
  sandRouteKind,
  desertSlalomKind,
  photoErrandKind,
];

const BY_KIND = Object.fromEntries(
  CONTRACT_KINDS.map((def) => [def.kind, def]),
) as Partial<Record<ContractKind, ContractKindDef>>;

/** Unimplemented kinds fall back to the ordinary parcel rather than crashing. */
export function contractKindDef(kind: ContractKind): ContractKindDef {
  return BY_KIND[kind] ?? parcelKind;
}

/** True for all twenty declared ids, implemented or not, so old saves still load. */
export function isContractKind(value: unknown): value is ContractKind {
  return typeof value === 'string' && CONTRACT_KIND_IDS[value as ContractKind] === true;
}

/**
 * Why this courier may not accept the cargo, or null. The base rule — a courier
 * never signs cargo from itself or one further down the road — applies to every
 * kind; a kind adds its own on top (long haul needs a lead of several couriers,
 * trailer equipment needs its trailer in the yard).
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
