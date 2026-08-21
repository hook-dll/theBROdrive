/**
 * Spawning a fully assembled car from the pause menu.
 *
 * Pure state work, mirroring state.ts's layering: builds the part list, fuel and
 * transform, then records the car through world.apply like every other mutation.
 * No three.js or Rapier imports — the caller materialises the Vehicle from the
 * returned CarState.
 */

import type { BodyClass, PartInstance, PartKind } from '../parts/registry';
import { body, variant, variantsOfKind } from '../parts/registry';
import type { CarState, GameWorld } from './state';

export interface SpawnRequest {
  bodyId: string;
  /** 0xRRGGBB paint. */
  paintColor: number;
  /** 0 = ruined, 1 = factory fresh; applied to every fitted part. */
  condition: number;
}

/**
 * Curated, period-plausible paints for a sun-bleached desert road game. Every
 * body's stock colour is represented so "default" always reads as factory.
 */
export const PAINT_COLORS: readonly { label: string; value: number }[] = [
  { label: 'Faded Brick Red', value: 0x8a3a2e },
  { label: 'Bleached Sand', value: 0xc2a86e },
  { label: 'Desert Khaki', value: 0x9a8a3a },
  { label: 'Army Green', value: 0x5a6b4a },
  { label: 'Dusty Blue', value: 0x4a5a72 },
  { label: 'Rust Brown', value: 0x7a5230 },
  { label: 'Chalk White', value: 0xc9c2b4 },
  { label: 'Charcoal', value: 0x3a3a40 },
];

/**
 * Selection rule: the top of the range for the body class, so a spawned car is
 * genuinely pleasant instead of a barely-rolling pile. Engines — the biggest
 * petrol for cars, the torquey truck diesel for truck/bus; gearboxes — the
 * tallest (most ratios) that fits the class; wheels — the balanced class road
 * wheel, all four matching; tanks — the largest that fits the class.
 */
const ENGINE_BY_CLASS: Record<BodyClass, string> = {
  car: 'engine_v8_5000',
  truck: 'engine_d6_6600',
  bus: 'engine_d6_6600',
};
const GEARBOX_BY_CLASS: Record<BodyClass, string> = {
  car: 'gearbox_manual5',
  truck: 'gearbox_truck6',
  bus: 'gearbox_truck6',
};
const WHEEL_BY_CLASS: Record<BodyClass, string> = {
  car: 'wheel_steel_15',
  truck: 'wheel_truck_19',
  bus: 'wheel_truck_19',
};
const TANK_BY_CLASS: Record<BodyClass, string> = {
  car: 'tank_65',
  truck: 'tank_140',
  bus: 'tank_140',
};

/**
 * First variant of `kind` that physically fits the class (stable ALL_VARIANTS
 * order). Returns null when nothing fits — e.g. no hood, trunk or mirror variant
 * exists for the bus; those are non-essential slots, so the car stays drivable.
 */
function trimVariant(kind: PartKind, bodyClass: BodyClass): string | null {
  const fits = variantsOfKind(kind, bodyClass);
  return fits.length > 0 ? fits[0]!.id : null;
}

/**
 * Records a fully assembled, fully fuelled car into state and returns it. The
 * caller materialises the Vehicle (physics + scene) from the CarState.
 */
export function spawnAssembledCar(
  world: GameWorld,
  request: SpawnRequest,
  x: number,
  y: number,
  z: number,
  heading: number,
): CarState {
  const def = body(request.bodyId);
  const condition = Math.min(1, Math.max(0, request.condition));

  // Invert conditionScore's weighting (1 - (dirt*0.25 + rust*0.5 + wear*0.35)):
  // every part loses `loss` of condition, split dirt = rust = loss and
  // wear = loss * 5/7, because 0.25 + 0.5 + (5/7)*0.35 = 1. The weighted sum then
  // comes back out as exactly `loss`, so conditionScore lands on `condition`.
  // Loss 0 means literally spotless: all three fields are zero.
  const loss = 1 - condition;
  const dirt = loss;
  const rust = loss;
  const wear = loss * (5 / 7);

  const slots: Record<string, PartInstance> = {};
  for (const slot of def.slots) {
    let variantId: string | null = null;
    switch (slot.kind) {
      case 'engine': variantId = ENGINE_BY_CLASS[def.bodyClass]; break;
      case 'gearbox': variantId = GEARBOX_BY_CLASS[def.bodyClass]; break;
      case 'wheel': variantId = WHEEL_BY_CLASS[def.bodyClass]; break;
      case 'fuel_tank': variantId = TANK_BY_CLASS[def.bodyClass]; break;
      default: variantId = trimVariant(slot.kind, def.bodyClass);
    }
    if (variantId === null) continue; // no variant fits this class (e.g. bus hood)
    slots[slot.id] = {
      id: world.runtimePartId(),
      variantId,
      dirt,
      rust,
      wear,
    };
  }

  // Fully fuelled: the tank holds exactly what the fitted tank's capacity is.
  const capacity = variant(TANK_BY_CLASS[def.bodyClass]).capacity ?? 0;
  const half = heading / 2;
  const car: CarState = {
    // Runtime ids come from the world's own counter, shared with runtime parts,
    // so spawned ids can never collide with generated or saved ones.
    id: world.runtimePartId(),
    bodyId: request.bodyId,
    paintColor: request.paintColor,
    slots,
    fuelLitres: capacity,
    odometer: 0,
    x,
    y,
    z,
    qx: 0,
    qy: Math.sin(half),
    qz: 0,
    qw: Math.cos(half),
  };
  world.apply({ t: 'car_add', car });
  return car;
}
