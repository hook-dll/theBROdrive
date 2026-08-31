import type { Item, PartItem } from '../items/items';
import { variant, type BodyClass, type EngineSpec, type FuelType, type PartInstance } from '../parts/registry';

/** Every car exposes the same four service positions, left to right. */
export const BONNET_SLOT_KINDS = ['engine', 'turbine', 'coolant_tank', 'fuel_tank'] as const;
export const BONNET_SLOT_COUNT = BONNET_SLOT_KINDS.length;
export type BonnetPartKind = (typeof BONNET_SLOT_KINDS)[number];

export function bonnetSlotKind(cell: number): BonnetPartKind | null {
  return BONNET_SLOT_KINDS[cell] ?? null;
}

export function bonnetPart(cells: readonly (Item | null)[], cell: number): PartInstance | null {
  const item = cells[cell];
  if (item?.type !== 'part') return null;
  const expected = bonnetSlotKind(cell);
  return expected !== null && variant(item.part.variantId).kind === expected ? item.part : null;
}

export function bonnetAccepts(cell: number, item: Item | null): item is PartItem {
  if (item?.type !== 'part') return false;
  return variant(item.part.variantId).kind === bonnetSlotKind(cell);
}

function servicePart(carId: string, suffix: string, variantId: string): PartItem {
  return {
    type: 'part',
    id: `${carId}:service:${suffix}`,
    part: { id: `${carId}:service:${suffix}`, variantId, dirt: 0, rust: 0 },
  };
}

/**
 * Factory state for a roadworthy car. The turbine position starts empty: forced
 * induction is optional, while the engine and both reservoirs are required.
 */
export function createBonnetStorage(
  carId: string,
  engineVariantId: string,
  bodyClass: BodyClass,
  tankCapacity: number,
): (Item | null)[] {
  const tankVariant = bodyClass === 'bus' || bodyClass === 'truck'
    ? 'tank_140'
    : tankCapacity <= 45
      ? 'tank_40'
      : 'tank_65';
  return [
    servicePart(carId, 'engine', engineVariantId),
    null,
    servicePart(carId, 'coolant-tank', 'coolant_tank_standard'),
    servicePart(carId, 'fuel-tank', tankVariant),
  ];
}

/** Drops malformed or wrongly typed saved cells without letting them poison service rules. */
export function normalizeBonnetStorage(cells: readonly (Item | null)[]): (Item | null)[] {
  const normalized = new Array<Item | null>(BONNET_SLOT_COUNT).fill(null);
  for (let cell = 0; cell < BONNET_SLOT_COUNT; cell++) {
    const item = cells[cell] ?? null;
    if (bonnetAccepts(cell, item)) normalized[cell] = item;
  }
  return normalized;
}


/** Pure service gate shared by simulation and behavioral checks. */
export function bonnetCanRun(
  cells: readonly (Item | null)[],
  fuelLitres: number,
  fuelKind: FuelType | 'mixed' | null,
): boolean {
  const engine = bonnetPart(cells, 0);
  return (
    engine !== null &&
    bonnetPart(cells, 3) !== null &&
    fuelLitres > 0 &&
    fuelKind === variant(engine.variantId).engine?.fuel
  );
}


/** Catastrophic internals: barely enough crank torque to move, never repairable. */
export function destroyedEngineSpec(engine: EngineSpec): EngineSpec {
  return {
    ...engine,
    peakPowerKw: Math.min(engine.peakPowerKw * 0.08, 5),
    peakTorqueNm: Math.min(engine.peakTorqueNm * 0.18, 24),
    bsfc: engine.bsfc * 2.5,
    brakingCoeff: Math.min(engine.brakingCoeff * 0.2, 0.02),
  };
}
export type EngineFailureReason = 'coolant' | 'oil';

/** Called only for a running engine; turbine presence intentionally has no bearing. */
export function engineFailureReason(
  cells: readonly (Item | null)[],
  coolantLitres: number,
  oilLitres: number,
): EngineFailureReason | null {
  if (bonnetPart(cells, 0)?.destroyed) return null;
  if (bonnetPart(cells, 2) === null || coolantLitres <= 0) return 'coolant';
  if (oilLitres <= 0) return 'oil';
  return null;
}
