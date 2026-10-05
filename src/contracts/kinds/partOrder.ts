/**
 * Part order (kind 19): the slip names one specific part, and the courier signs only
 * with that part standing in its boot cells or in the player's hands.
 *
 * THE PART IS PICKED FROM WHAT THE WORLD ACTUALLY STOCKS. The catalogue is filtered
 * to the five kinds that a wreck bonnet or a breaker's yard can yield —
 * `BONNET_SLOT_KINDS`, the very cells `world/poi.ts` fills — so every order is
 * obtainable somewhere on the road before it is ever written. Gearboxes and the
 * loose odds are left out because nothing spawns them.
 *
 * The slip's own label carries the part name (`statusText`, set at generation from
 * the seed), so the boot, the hand and the prompt all read what is being asked for.
 *
 * The signature is for condition: a part wiped into the good band pays, one pulled
 * out of a wreck and handed over rusty pays the ordinary sticker. The thresholds sit
 * on the sponge's own rates — 0.7 dirt/s and 0.28 rust/s — so a typical salvage find
 * is a couple of seconds of work, while a genuinely rotten part is not worth it.
 */

import { pick } from '../../core/rng';
import { ALL_VARIANTS, variant } from '../../parts/registry';
import type { PartItem } from '../../items/items';
import { BONNET_SLOT_KINDS } from '../../vehicle/bonnet';
import { defaultProgress, type ContractKindDef, type DeliveryProbe } from '../types';

/** 'PTO1'. */
const VARIANT_DOMAIN = 0x50544f31;
/** Rust (0..1) and dirt that still count as "in good condition". */
const RUST_LIMIT = 0.25;
const DIRT_LIMIT = 0.5;

/** The five bonnet kinds as a membership table, so the filter needs no Set. */
const ORDERABLE_KINDS: Record<string, true> = Object.fromEntries(
  BONNET_SLOT_KINDS.map((kind) => [kind, true]),
);
/**
 * Every variant a wreck or a yard can stock: the five bonnet kinds, across all body
 * classes. `ALL_VARIANTS` keeps the roster engines too, which are fitted to cars in
 * the catalogue and therefore appear in wrecks of those models.
 */
const ORDERABLE_VARIANTS = ALL_VARIANTS.filter((candidate) => ORDERABLE_KINDS[candidate.kind] === true);

/**
 * The variant this slip asks for. Exported because it is part of the kind's own
 * contract: the label on the slip and the part a courier checks are the same draw.
 */
export function orderVariantId(seed: number): string {
  return pick(ORDERABLE_VARIANTS, seed, VARIANT_DOMAIN).id;
}

interface FoundPart {
  readonly item: PartItem;
  /** True when it came out of the player's pack rather than the courier's cells. */
  readonly inPack: boolean;
}

/** The first part of this variant in the pack, then in the courier's cells. */
function findOrderPart(variantId: string, probe: DeliveryProbe): FoundPart | null {
  for (const item of probe.carried) {
    if (item?.type === 'part' && item.part.variantId === variantId) {
      return { item, inPack: true };
    }
  }
  for (const item of probe.courierCells) {
    if (item?.type === 'part' && item.part.variantId === variantId) {
      return { item, inPack: false };
    }
  }
  return null;
}

export const partOrderKind: ContractKindDef = {
  kind: 'part_order',
  weight: 1,
  offerNames: ['parts order slip', 'spares requisition', 'workshop order sheet', 'parts note'],
  signatureSticker: 'turbo',
  initialProgress: (seed) => ({
    ...defaultProgress(),
    // The slip names what it is for, and only the kind can compute that.
    statusText: `for ${variant(orderVariantId(seed)).label}`.slice(0, 40),
  }),
  acceptRefusal: (item, probe) => {
    const variantId = orderVariantId(item.generatedSeed);
    const found = findOrderPart(variantId, probe);
    const label = variant(variantId).label;
    if (!found) return `this order is for a ${label} — bring one`;
    if (found.item.part.destroyed) return `the ${label} you brought is destroyed`;
    return null;
  },
  step: () => {},
  conditionMet: (p, ctx) => {
    const found = findOrderPart(orderVariantId(ctx.item.generatedSeed), ctx.probe);
    if (!found || found.item.part.destroyed) return false;
    return found.item.part.rust <= RUST_LIMIT && found.item.part.dirt <= DIRT_LIMIT;
  },
  onDelivered: (item, probe) => {
    const found = findOrderPart(orderVariantId(item.generatedSeed), probe);
    if (!found) return null;
    return found.inPack
      ? { consumeCarried: [found.item.id] }
      : { consumeCourierItems: [found.item.id] };
  },
};
