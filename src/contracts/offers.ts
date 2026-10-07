/**
 * Courier offer generation: four per courier, drawn deterministically from the world
 * seed. Parcel carries weight 4 against 1 for each other kind, so the common case
 * stays common and the special ones are a find rather than the norm.
 *
 * The offer is a plain `contract_cargo` item with its kind, name, seed-random
 * fallback reward and initial progress already on it; the courier code only decides
 * the slot id.
 *
 * `courierDefaultStorage` — the four offers plus what else a courier keeps in the
 * boot — lives here rather than in `world/couriers.ts` on purpose: it is contract
 * content, and `world/couriers.ts` must stay free of contract imports. `kinds/*`
 * reach the courier geometry through `contracts/world.ts`, and a contract import in
 * that leaf would close a module-init cycle (measured: offers read a
 * not-yet-initialised `CONTRACT_KINDS` depending on import order).
 */

import { hash, hash01 } from '../core/rng';
import { makeSponge, type ContractCargoItem, type Item } from '../items/items';
import { stickerKindForSeed } from '../items/stickercatalog';
import { courierId } from '../world/couriers';
import { TRUNK_CELL_COUNT, TRUNK_COLUMNS } from '../vehicle/trunk';
import { CONTRACT_KINDS } from './registry';
import type { ContractKindDef } from './types';

/** Offer draws stay on the courier domain the base system already used. */
const OFFER_DOMAIN = 0x4f464631; // 'OFF1'
const KIND_DOMAIN = 0x4f464b31; // 'OFK1'
const NAME_DOMAIN = 0x4f464e31; // 'OFN1'
/** Share of couriers with a sponge in the boot as well as the gum. */
const COURIER_SPONGE_CHANCE = 0.35;

/**
 * Total offer weight, summed on the first draw rather than at module load.
 *
 * This module is reachable from `world/poi.ts`, and `CONTRACT_KINDS` reaches back
 * here through a kind module: reading the table in this module's BODY made the loop
 * an evaluation-order trap — `Cannot access 'CONTRACT_KINDS' before initialization`
 * whenever an entry point reached the registry first (measured with
 * tools/tow-bench.ts, whose own imports land in that order). A lazy sum is a few
 * additions per generated offer and cannot be observed.
 */
function totalWeight(): number {
  let total = 0;
  for (const def of CONTRACT_KINDS) total += def.weight;
  return total;
}

function pickKind(seed: number, courierIndex: number, slot: number): ContractKindDef {
  let roll = hash01(seed, KIND_DOMAIN, courierIndex, slot) * totalWeight();
  for (const def of CONTRACT_KINDS) {
    roll -= def.weight;
    if (roll < 0) return def;
  }
  return CONTRACT_KINDS[0]!;
}

export function generateContractOffer(
  seed: number,
  courierIndex: number,
  slot: number,
): ContractCargoItem {
  const def = pickKind(seed, courierIndex, slot);
  const generatedSeed = hash(seed, OFFER_DOMAIN, courierIndex, slot);
  const nameIndex = Math.floor(hash01(seed, NAME_DOMAIN, courierIndex, slot) * def.offerNames.length);
  const massKg = def.massKg?.(generatedSeed);
  const item: ContractCargoItem = {
    type: 'contract_cargo',
    id: `courier:${courierIndex}:offer:${slot}`,
    sourceCourierIndex: courierIndex,
    contractKind: def.kind,
    cargoName: def.offerNames[nameIndex]!,
    rewardStickerKind: stickerKindForSeed(generatedSeed),
    generatedSeed,
    progress: def.initialProgress(generatedSeed),
  };
  if (massKg !== undefined) item.massKg = massKg;
  return item;
}

/**
 * What an untouched courier keeps in its boot: four offers on the top row, a pack of
 * gum on the bottom row, and now and then a sponge beside it. `CourierField`'s
 * `defaultStorage` is this; `WorldState.courierStorage` owns a full override after
 * the first edit, so nothing here runs twice.
 */
export function courierDefaultStorage(
  seed: number,
  index: number,
): readonly (Item | null)[] {
  const cells: (Item | null)[] = new Array(TRUNK_CELL_COUNT).fill(null);
  for (let slot = 0; slot < 4; slot++) {
    cells[slot] = generateContractOffer(seed, index, slot);
  }
  const bottom = TRUNK_CELL_COUNT - TRUNK_COLUMNS;
  const gumCell = bottom + Math.floor(hash01(seed, OFFER_DOMAIN, index, 10) * TRUNK_COLUMNS);
  cells[gumCell] = {
    type: 'bubble_gum',
    id: `${courierId(index)}:gum`,
    charges: 3 + Math.floor(hash01(seed, OFFER_DOMAIN, index, 11) * 3),
  };
  if (hash01(seed, OFFER_DOMAIN, index, 12) < COURIER_SPONGE_CHANCE) {
    const shift = 1 + Math.floor(hash01(seed, OFFER_DOMAIN, index, 13) * (TRUNK_COLUMNS - 1));
    const spongeCell = bottom + ((gumCell - bottom + shift) % TRUNK_COLUMNS);
    cells[spongeCell] = makeSponge(`${courierId(index)}:sponge`, hash01(seed, OFFER_DOMAIN, index, 14));
  }
  return cells;
}
