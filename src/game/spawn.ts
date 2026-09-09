/**
 * Spawning a complete car model from the pause menu.
 *
 * Pure state work, mirroring state.ts's layering: records the model, fuel and
 * transform, then adds the car through world.apply like every other mutation.
 * No three.js or Rapier imports — the caller materialises the Vehicle from the
 * returned CarState.
 */

import { carModel } from '../vehicle/carmodels';
import { oilCapacity, variant } from '../parts/registry';
import type { Item } from '../items/items';
import type { CarState, GameWorld } from './state';
import { bonnetWaterCapacity, createBonnetStorage } from '../vehicle/bonnet';
import { COLD_SOAK_C } from '../vehicle/cooling';

/** What the pause menu chose to spawn: a complete model catalogue id. */
export interface SpawnRequest {
  modelId: string;
}

/**
 * Builds a complete, serviceable car without deciding whether it is persistent.
 *
 * World spawns add the result to `GameWorld`; temporary traffic keeps it in its own
 * runtime world so ambient simulation works without traffic leaking into saves.
 */
export function createServiceableCarState(
  id: string,
  modelId: string,
  x: number,
  y: number,
  z: number,
  heading: number,
): CarState {
  const def = carModel(modelId);
  const engine = variant(def.engineId).engine;
  const half = heading / 2;
  const bonnet = createBonnetStorage(id, def.engineId, def.bodyClass, def.tankLitres);
  return {
    id,
    modelId,
    gizmos: {},
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    dirt: 0,
    scratches: 0,
    fuelLitres: def.tankLitres,
    fuelKind: engine?.fuel ?? null,
    waterLitres: bonnetWaterCapacity(bonnet),
    oilLitres: engine ? oilCapacity(engine) : 0,
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet,
    odometer: 0,
    x,
    y,
    z,
    qx: 0,
    qy: Math.sin(half),
    qz: 0,
    qw: Math.cos(half),
  };
}

/** Records a complete, fully fuelled car into state and returns it. */
export function spawnCarState(
  world: GameWorld,
  request: SpawnRequest,
  x: number,
  y: number,
  z: number,
  heading: number,
): CarState {
  const car = createServiceableCarState(
    world.runtimePartId(),
    request.modelId,
    x,
    y,
    z,
    heading,
  );
  world.apply({ t: 'car_add', car });
  return car;
}
