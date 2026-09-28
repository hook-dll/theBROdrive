import type { Item, PartItem } from '../items/items';
import {
  oilCapacity,
  variant,
  type BodyClass,
  type EngineSpec,
  type PartInstance,
  type RadiatorSpec,
} from '../parts/registry';

/** Every car exposes the same five service positions, left to right. */
export const BONNET_SLOT_KINDS = ['engine', 'turbine', 'radiator', 'fuel_tank', 'air_filter'] as const;
export const BONNET_SLOT_COUNT = BONNET_SLOT_KINDS.length;
export type BonnetPartKind = (typeof BONNET_SLOT_KINDS)[number];
/** The air filter's cell, the one position added after the first four. */
export const AIR_FILTER_CELL = 4;

export function bonnetSlotKind(cell: number): BonnetPartKind | null {
  return BONNET_SLOT_KINDS[cell] ?? null;
}

/**
 * Which of the car's three reservoirs the container in this slot owns.
 *
 * One table rather than a `kind === 'radiator'` test at each call site: the level
 * readout, the pour, and the transfer that keeps a removed container's fluid with it
 * (see the `car_bonnet` delta in game/state.ts) must all agree about which slot
 * holds what, and a turbine slot holding nothing is part of that agreement.
 */
export type BonnetFluidChannel = 'oil' | 'water' | 'fuel';

export function bonnetSlotFluid(cell: number): BonnetFluidChannel | null {
  switch (bonnetSlotKind(cell)) {
    case 'engine':
      return 'oil';
    case 'radiator':
      return 'water';
    case 'fuel_tank':
      return 'fuel';
    default:
      return null;
  }
}

/**
 * What a container part holds and how much of it, whether or not it is fitted.
 *
 * A detached engine, radiator or tank keeps its fluid in `PartInstance.litres`
 * (see parts/registry.ts), so a part lying on the workshop floor can be filled
 * before it is bolted in. This resolves the same three capacities the fitted
 * readouts use, from the part alone: the bonnet is not consulted, because there
 * may not be one.
 */
export interface PartContainer {
  readonly channel: BonnetFluidChannel;
  readonly capacity: number;
}

export function partContainer(part: PartInstance): PartContainer | null {
  const spec = variant(part.variantId);
  switch (spec.kind) {
    case 'engine':
      return spec.engine ? { channel: 'oil', capacity: oilCapacity(spec.engine) } : null;
    case 'radiator':
      return spec.radiator ? { channel: 'water', capacity: spec.radiator.capacity } : null;
    case 'fuel_tank':
      return spec.capacity ? { channel: 'fuel', capacity: spec.capacity } : null;
    default:
      return null;
  }
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

function servicePart(carId: string, suffix: string, variantId: string, clog?: number): PartItem {
  const id = `${carId}:service:${suffix}`;
  const part: PartInstance = { id, variantId, dirt: 0, rust: 0 };
  if (clog !== undefined) part.clog = clog;
  return { type: 'part', id, part };
}

/** The air filter a car leaves the factory with, `clog` worn. */
export function factoryAirFilter(carId: string, clog = 0): PartItem {
  return servicePart(carId, 'air-filter', 'air_filter', clog);
}

/**
 * The tank a body of this class and capacity leaves the factory with.
 *
 * Shared by `stockBonnetVariants` and the fresh-car build below so the two cannot
 * disagree: a car's MASS is measured against this set, and a disagreement would
 * make every car start life heavier or lighter than its own kerb weight.
 */
function stockTankVariant(bodyClass: BodyClass, tankCapacity: number): string {
  if (tankCapacity <= 45) return 'tank_40';
  if (tankCapacity <= 65) return 'tank_65';
  if (bodyClass === 'truck' || bodyClass === 'bus') return 'tank_140';
  return 'tank_65';
}

/** The parts a roadworthy car of this model leaves the factory with, by bonnet cell. */
export function stockBonnetVariants(
  engineVariantId: string,
  bodyClass: BodyClass,
  tankCapacity: number,
): readonly (string | null)[] {
  return [engineVariantId, null, 'radiator', stockTankVariant(bodyClass, tankCapacity), 'air_filter'];
}

/**
 * Factory state for a roadworthy car. The turbocharger position starts empty: forced
 * induction is something the player finds and fits, while the engine, both
 * reservoirs and the air filter are required.
 */
export function createBonnetStorage(
  carId: string,
  engineVariantId: string,
  bodyClass: BodyClass,
  tankCapacity: number,
  /** How worn the fitted air filter already is: a roadside find has been driven. */
  airFilterClog = 0,
): (Item | null)[] {
  const stock = stockBonnetVariants(engineVariantId, bodyClass, tankCapacity);
  return [
    servicePart(carId, 'engine', stock[0]!),
    null,
    servicePart(carId, 'radiator', stock[2]!),
    servicePart(carId, 'fuel-tank', stock[3]!),
    factoryAirFilter(carId, airFilterClog),
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


/**
 * Pure service gate shared by simulation and behavioral checks: an engine, a tank
 * with fuel in it, and an air filter. A clogged filter still runs (it only costs
 * power); a missing one does not start.
 */
export function bonnetCanRun(cells: readonly (Item | null)[], fuelLitres: number): boolean {
  return (
    bonnetPart(cells, 0) !== null &&
    bonnetPart(cells, 3) !== null &&
    bonnetPart(cells, AIR_FILTER_CELL) !== null &&
    fuelLitres > 0
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
export type EngineFailureReason = 'oil' | 'overheat';

/**
 * Whether a RUNNING engine is currently being damaged, and by what. Oil only here;
 * heat is reported by `EngineCoolingSystem` through the same destruction path.
 *
 * This is a CONDITION, not a verdict. Neither cause kills an engine the moment it
 * appears: the caller accumulates time under it (`Vehicle`'s oil-starvation timer,
 * `SEIZE_SECONDS` for heat) and only destroys the block once the engine has been
 * run like that for long enough to wreck it. Water is not listed at all — no water
 * means no heat rejection, so it arrives as overheating, with a gauge and a lamp to
 * warn about it on the way.
 *
 * A destroyed engine reports nothing: there is no second failure to find.
 */
export function engineFailureReason(
  cells: readonly (Item | null)[],
  oilLitres: number,
): EngineFailureReason | null {
  if (bonnetPart(cells, 0)?.destroyed) return null;
  if (oilLitres <= 0) return 'oil';
  return null;
}

/** The fitted radiator's cooling spec, or null when the slot is empty. */
export function bonnetRadiator(cells: readonly (Item | null)[]): RadiatorSpec | null {
  const part = bonnetPart(cells, 2);
  return part ? variant(part.variantId).radiator ?? null : null;
}

/**
 * Water the car can hold, litres: whatever the fitted radiator holds and nothing
 * without one. Every level readout and every fill resolves through this, so a car
 * with no radiator cannot be poured into rather than silently accepting water into
 * a slot with no core in it.
 */
export function bonnetWaterCapacity(cells: readonly (Item | null)[]): number {
  return bonnetRadiator(cells)?.capacity ?? 0;
}

/** The fitted air filter, or null when the slot is empty. */
export function bonnetAirFilter(cells: readonly (Item | null)[]): PartInstance | null {
  return bonnetPart(cells, AIR_FILTER_CELL);
}

/** Whether the fitted turbocharger is there to boost the engine. */
export function bonnetHasTurbo(cells: readonly (Item | null)[]): boolean {
  return bonnetPart(cells, 1) !== null;
}
