import { createBonnetStorage } from '../vehicle/bonnet';
import { carModel } from '../vehicle/carmodels';
import { COLD_SOAK_C } from '../vehicle/cooling';
import { variant } from '../parts/registry';
import type { CarState } from '../game/state';
import type { Item } from '../items/items';

/**
 * A serviceable car, standing where you put it.
 *
 * The dev scene, the lap bench and the traffic all need the same thing: a catalogue
 * body with a full tank, oil, water, an engine in the bonnet and nothing broken.
 * They had three copies of it, which is three places for a new required `CarState`
 * field to be forgotten in.
 */
export function playgroundCarState(
  id: string,
  modelId: string,
  x: number,
  y: number,
  z: number,
  heading: number,
): CarState {
  const def = carModel(modelId);
  return {
    id,
    modelId,
    gizmos: {},
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    fuelLitres: def.tankLitres,
    fuelKind: variant(def.engineId).engine?.fuel ?? null,
    dirt: 0,
    scratches: 0,
    waterLitres: 10,
    oilLitres: 10,
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage(id, def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0,
    x,
    y,
    z,
    qx: 0,
    qy: Math.sin(heading / 2),
    qz: 0,
    qw: Math.cos(heading / 2),
  };
}
