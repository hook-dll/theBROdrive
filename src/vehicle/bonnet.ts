import type { Item, PartItem } from '../items/items';
import {
  variant,
  type BodyClass,
  type EngineSpec,
  type FuelType,
  type PartInstance,
  type RadiatorClass,
  type RadiatorSpec,
} from '../parts/registry';
import { preferredRadiatorClass } from './cooling';

/** Every car exposes the same four service positions, left to right. */
export const BONNET_SLOT_KINDS = ['engine', 'turbine', 'radiator', 'fuel_tank'] as const;
export const BONNET_SLOT_COUNT = BONNET_SLOT_KINDS.length;
export type BonnetPartKind = (typeof BONNET_SLOT_KINDS)[number];

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

/**
 * True when this part has a SERVICE HOME on the car and is therefore not junk.
 *
 * The cosmetic anchors (`GizmoAnchor`, render/carmodel.ts) accept any part, because
 * a mirror or a bumper has nowhere else to go and hanging one off the roof is the
 * point. An ENGINE is not that: it belongs in a bonnet slot, so previewing it at
 * every anchor on the car — bonnet, flanks, roof — advertised eleven wrong places to
 * put it and one right one that is not an anchor at all. The four kinds a bonnet slot
 * takes are excluded from anchor mounting for exactly that reason; nothing else is.
 */
export function hasServiceSlot(variantId: string): boolean {
  const kind = variant(variantId).kind;
  return BONNET_SLOT_KINDS.some((slot) => slot === kind);
}

function servicePart(carId: string, suffix: string, variantId: string): PartItem {
  return {
    type: 'part',
    id: `${carId}:service:${suffix}`,
    part: { id: `${carId}:service:${suffix}`, variantId, dirt: 0, rust: 0 },
  };
}

/** The radiator class a given class of engine leaves the factory with. */
const FACTORY_RADIATOR: Readonly<Record<RadiatorClass, string>> = {
  small: 'radiator_small',
  standard: 'radiator_standard',
  large: 'radiator_copper',
};

/**
 * Factory state for a roadworthy car. The turbine position starts empty: forced
 * induction is optional, while the engine and both reservoirs are required.
 *
 * The radiator is chosen to SUIT THE ENGINE (`preferredRadiatorClass`) rather than
 * being one standard core for all forty-six bodies. A car that left a factory was
 * cooled adequately; the undersized-radiator failure is something the player
 * creates by swapping parts or inherits from a car somebody else has been at.
 */
export function createBonnetStorage(
  carId: string,
  engineVariantId: string,
  bodyClass: BodyClass,
  tankCapacity: number,
  /**
   * Forces a specific radiator instead of the engine's own class. This is how a
   * roadside find can arrive with somebody else's bodge already fitted.
   */
  radiatorVariantId?: string,
): (Item | null)[] {
  const tankVariant = bodyClass === 'bus' || bodyClass === 'truck'
    ? 'tank_140'
    : tankCapacity <= 45
      ? 'tank_40'
      : 'tank_65';
  const engine = variant(engineVariantId).engine;
  const radiatorVariant =
    radiatorVariantId ??
    (engine ? FACTORY_RADIATOR[preferredRadiatorClass(engine)] : 'radiator_standard');
  return [
    servicePart(carId, 'engine', engineVariantId),
    null,
    servicePart(carId, 'radiator', radiatorVariant),
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
export type EngineFailureReason = 'oil' | 'overheat';

/**
 * Instant, unsurvivable engine failures for a RUNNING engine. Oil only.
 *
 * Dry water used to be here beside it and destroyed the engine on the spot. It is
 * gone because the cooling system now models what actually happens: no water means
 * no heat rejection, the temperature runs away over the next half minute, the lamp
 * lights, power falls off, the engine stalls, and only then — if the player has
 * driven through all of it — does it seize (`EngineCoolingSystem`, vehicle/cooling.ts,
 * reports `overheat` through the same destruction path). Oil has no such gauge, so
 * running the sump dry stays immediate.
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
