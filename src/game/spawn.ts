/**
 * Spawning a complete car model from the pause menu.
 *
 * Pure state work, mirroring state.ts's layering: records the model, fuel and
 * transform, then adds the car through world.apply like every other mutation.
 * No three.js or Rapier imports — the caller materialises the Vehicle from the
 * returned CarState.
 */

import { carModel } from '../vehicle/carmodels';
import { coolantCapacity, oilCapacity, variant } from '../parts/registry';
import type { Item } from '../items/items';
import type { CarState, GameWorld } from './state';

/** What the pause menu chose to spawn: a complete model catalogue id. */
export interface SpawnRequest {
  modelId: string;
}

/**
 * Records a complete, fully fuelled car into state and returns it. The caller
 * materialises the Vehicle (physics + scene) from the CarState.
 */
export function spawnCarState(
  world: GameWorld,
  request: SpawnRequest,
  x: number,
  y: number,
  z: number,
  heading: number,
): CarState {
  const def = carModel(request.modelId);
  const engine = variant(def.engineId).engine;
  const half = heading / 2;
  const car: CarState = {
    // Runtime ids come from the world's own counter, shared with runtime parts,
    // so spawned ids can never collide with generated or saved ones.
    id: world.runtimePartId(),
    modelId: request.modelId,
    gizmos: {},
    stickers: [],
    // A complete model has no parts to age; fuel is its only fillable resource,
    // so a spawn leaves the showroom with a full tank — and full of both the
    // fluids it needs, because this is a dev tool and a dry one would just be a
    // chore before every test.
    fuelLitres: def.tankLitres,
    coolantLitres: engine ? coolantCapacity(engine) : 0,
    oilLitres: engine ? oilCapacity(engine) : 0,
    storage: new Array<Item | null>(def.storageCells).fill(null),
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
