/**
 * tools/benchcar.ts
 *
 * The one bench car. Every tool that drives a real `Vehicle` needs a `CarState` to
 * build it from, and a dozen of them used to write that literal out by hand. The
 * copies drifted apart from the game and from each other: most still carried a
 * `damage` field the state had long since lost, one had no fuel at all, and each
 * filled the tank, radiator and sump to its own arbitrary 40/10/10 litres, so the
 * "same" car weighed a different amount in every bench.
 *
 * So there is one, and it is the game's: `createServiceableCarState`, the complete,
 * fully fuelled car the pause menu and the traffic spawner create. A bench car is
 * therefore at exactly its catalogue kerb mass, with the stock radiator's water and
 * the engine's own oil capacity, and any field the state gains reaches every bench
 * without anyone remembering to copy it.
 *
 * What a bench legitimately varies is WHERE the car stands and, for the cooling rig,
 * which radiator is fitted; both are options here. Anything else a bench wants to be
 * different (a deliberately oversized fuel load, say) it spreads over the result at
 * its own call site, where the reason can be written down beside it.
 *
 * Nothing here is part of the game bundle.
 */

import { createServiceableCarState } from '../src/game/spawn';
import type { CarState } from '../src/game/state';
import { bonnetWaterCapacity, createBonnetStorage } from '../src/vehicle/bonnet';
import { carModel } from '../src/vehicle/carmodels';

export interface BenchCarOptions {
  /** State id; also the bonnet parts' id prefix. Defaults to `'bench'`. */
  readonly id?: string;
  /** World position of the chassis origin, metres. Defaults to 1.2 m above the origin. */
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  /** Compass heading, radians. 0 faces +Z. */
  readonly heading?: number;
  /**
   * A radiator other than the stock one for this engine. The water level follows it:
   * a bench car is always full.
   */
  readonly radiatorVariantId?: string;
}

/** A complete, fully serviced catalogue car, placed where the bench wants it. */
export function benchCarState(modelId: string, options: BenchCarOptions = {}): CarState {
  const id = options.id ?? 'bench';
  const car = createServiceableCarState(
    id,
    modelId,
    options.x ?? 0,
    options.y ?? 1.2,
    options.z ?? 0,
    options.heading ?? 0,
  );
  if (options.radiatorVariantId === undefined) return car;
  const def = carModel(modelId);
  const bonnet = createBonnetStorage(
    id,
    def.engineId,
    def.bodyClass,
    def.tankLitres,
    options.radiatorVariantId,
  );
  return { ...car, bonnet, waterLitres: bonnetWaterCapacity(bonnet) };
}
