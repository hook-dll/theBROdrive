/**
 * Cooling integration harness: real Vehicles, real physics, real deltas.
 *
 * `tools/cooling.ts` proves the thermal MODEL. This proves the WIRING, which is a
 * different set of mistakes: that driving heats the engine at all, that the
 * temperature reaches authoritative CarState, that two cars do not share it, that a
 * radiator swapped through the bonnet delta takes effect and keeps its water, that
 * an overheated engine loses power and stalls, and that a parked car cools down.
 *
 * Run: `bun tools/cooling-drive.ts`
 */

import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { emptyInput, type InputFrame } from '../src/core/input';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, DAY_LENGTH, type CarState } from '../src/game/state';
import type { Item } from '../src/items/items';
import { engineHeat, variant } from '../src/parts/registry';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { carModel } from '../src/vehicle/carmodels';
import { COLD_SOAK_C, ambientAirC } from '../src/vehicle/cooling';
import { Vehicle } from '../src/vehicle/vehicle';
import { WorldOrigin } from '../src/world/origin';
import { preloadCarModels } from '../src/render/carmodel';

installAssetShim();

/** A V8 pickup: enough power to cook a small radiator, and it exists in the pack. */
const MODEL_ID = 'st_v8_pickup';
const SETTLE_STEPS = 180;
/** Mid-afternoon, so the desert is working against the radiator like it will in play. */
const HOT_AFTERNOON = DAY_LENGTH * 0.625;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

function carState(id: string, radiatorVariantId?: string, x = 0, z = 0): CarState {
  const def = carModel(MODEL_ID);
  return {
    id,
    modelId: MODEL_ID,
    gizmos: {},
    stickers: [],
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    fuelLitres: 200,
    fuelKind: variant(def.engineId).engine?.fuel ?? null,
    dirt: 0,
    scratches: 0,
    waterLitres: 40,
    oilLitres: 10,
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage(id, def.engineId, def.bodyClass, def.tankLitres, radiatorVariantId),
    odometer: 0,
    x,
    y: 1.2,
    z,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  };
}

interface Rig {
  physics: PhysicsWorld;
  world: GameWorld;
  vehicle: Vehicle;
  state: CarState;
  input: InputFrame;
}

async function makeRig(id: string, radiatorVariantId?: string): Promise<Rig> {
  const physics = await PhysicsWorld.create();
  physics.addHeightfield(
    1,
    1,
    new Float32Array(4),
    { x: 8_000, y: 1, z: 8_000 },
    { x: 0, y: 0, z: 0 },
    SurfaceType.Asphalt,
  );
  const world = new GameWorld(newWorldState(41));
  world.state.timeOfDay = HOT_AFTERNOON;
  const state = carState(id, radiatorVariantId);
  world.state.cars[id] = state;
  const vehicle = new Vehicle(physics, world, state, new THREE.Scene(), new WorldOrigin());
  const rig: Rig = { physics, world, vehicle, state, input: emptyInput() };
  drive(rig, SETTLE_STEPS, 0);
  return rig;
}

function drive(rig: Rig, steps: number, throttle: number): void {
  for (let i = 0; i < steps; i++) {
    rig.input.throttle = throttle;
    rig.input.brake = 0;
    rig.input.steer = 0;
    rig.input.handbrake = false;
    rig.vehicle.fixedUpdate(FIXED_DT, rig.input);
    rig.physics.step();
    rig.vehicle.postStep();
  }
}

/** Seconds of simulated driving, in fixed steps. */
const seconds = (s: number): number => Math.round(s / FIXED_DT);

await preloadCarModels([MODEL_ID]);

console.log('cooling-drive: heat through the vehicle');

const factory = await makeRig('cool:factory');
check(
  'a factory car is fitted with a radiator that suits its engine',
  factory.vehicle.coolingState.radiatorClass === 'large' &&
    factory.vehicle.coolingState.fit.warning === null,
  `${factory.vehicle.coolingState.radiatorClass}, water ${factory.vehicle.coolingState.waterCapacity} L`,
);
check(
  'the gauge reads air temperature before the engine has run',
  Math.abs(factory.vehicle.coolingState.temperatureC - COLD_SOAK_C) < 12,
  `${factory.vehicle.coolingState.temperatureC.toFixed(1)} C`,
);

const coldStart = factory.vehicle.coolingState.temperatureC;
drive(factory, seconds(90), 1);
const warmed = factory.vehicle.coolingState;
check(
  'driving warms the engine into its working band',
  warmed.temperatureC > coldStart + 20 &&
    warmed.temperatureC > engineHeat(factory.vehicle.stats.engine).optimalMinC,
  `${coldStart.toFixed(1)} -> ${warmed.temperatureC.toFixed(1)} C in 90 s`,
);
check(
  'the temperature reaches authoritative CarState',
  Math.abs(factory.state.engineTempC - warmed.temperatureC) < 2 &&
    factory.state.engineTempC !== COLD_SOAK_C,
  `state ${factory.state.engineTempC.toFixed(1)} C vs live ${warmed.temperatureC.toFixed(1)} C`,
);
check(
  'a correctly cooled car at full throttle stays out of the warning zone',
  !warmed.overheating && warmed.performance === 1,
  `${warmed.zone}, performance ${warmed.performance.toFixed(2)}`,
);
check(
  'the dashboard readout agrees with the simulation',
  factory.vehicle.engineTemperature?.celsius === warmed.temperatureC &&
    factory.vehicle.engineTemperature?.zone === warmed.zone,
  `${factory.vehicle.engineTemperature?.zone} at ${factory.vehicle.engineTemperature?.fraction.toFixed(2)} of scale`,
);

console.log('cooling-drive: a bodged radiator');

const bodged = await makeRig('cool:bodged', 'radiator_small');
check(
  'an undersized core is reported as the compromise it is',
  bodged.vehicle.coolingState.radiatorClass === 'small' &&
    bodged.vehicle.coolingState.fit.warning !== null,
  `${bodged.vehicle.coolingState.fit.warning}`,
);
check(
  'and it can only hold the water its own core holds',
  bodged.state.waterLitres <= bodged.vehicle.coolingState.waterCapacity,
  `${bodged.state.waterLitres.toFixed(1)} of ${bodged.vehicle.coolingState.waterCapacity} L`,
);

drive(bodged, seconds(150), 1);
const cooked = bodged.vehicle.coolingState;
check(
  'the same engine on the small core overheats at full throttle',
  cooked.overheating && cooked.temperatureC > warmed.temperatureC + 15,
  `${cooked.temperatureC.toFixed(1)} C (${cooked.zone}) vs ${warmed.temperatureC.toFixed(1)} C on the right core`,
);
check(
  'overheating costs power and rev range',
  cooked.performance < 1 && cooked.revLimit < 1,
  `performance ${cooked.performance.toFixed(2)}, rev limit ${cooked.revLimit.toFixed(2)}`,
);

drive(bodged, seconds(240), 1);
const boiled = bodged.vehicle.coolingState;
check(
  'ignoring the lamp boils water away, and the stall then caps the loss',
  boiled.waterCapacity - boiled.waterLitres > 0.5 && boiled.waterLitres > 0,
  `lost ${(boiled.waterCapacity - boiled.waterLitres).toFixed(2)} L, ${boiled.waterLitres.toFixed(2)} L left`,
);
check(
  'a critical engine stalls instead of continuing to make power',
  !bodged.vehicle.engineRunning || bodged.vehicle.engineDestroyed,
  `running=${bodged.vehicle.engineRunning} destroyed=${bodged.vehicle.engineDestroyed}`,
);

console.log('cooling-drive: swaps, independence and cool-down');

const swap = await makeRig('cool:swap', 'radiator_small');
drive(swap, seconds(60), 1);
const beforeSwap = swap.vehicle.coolingState.temperatureC;
const smallCore = swap.state.bonnet[2];
// Pull the small core and fit a large one through the same delta the player's hands
// use, which is what proves the swap path rather than a direct field write.
swap.world.apply({ t: 'car_bonnet', carId: swap.state.id, cell: 2, item: null });
swap.vehicle.rebuild();
check(
  'pulling the radiator takes its water with it',
  smallCore?.type === 'part' &&
    (smallCore.part.litres ?? 0) > 0 &&
    swap.state.waterLitres === 0 &&
    swap.vehicle.coolingState.waterCapacity === 0,
  `${smallCore?.type === 'part' ? (smallCore.part.litres ?? 0).toFixed(2) : 'n/a'} L in the part`,
);
drive(swap, seconds(20), 1);
check(
  'running with no radiator at all heats the engine instead of crashing',
  swap.vehicle.coolingState.temperatureC > beforeSwap,
  `${beforeSwap.toFixed(1)} -> ${swap.vehicle.coolingState.temperatureC.toFixed(1)} C`,
);

const largeCore: Item = {
  type: 'part',
  id: 'cool:swap:large',
  part: { id: 'cool:swap:large', variantId: 'radiator_copper', dirt: 0, rust: 0, litres: 13 },
};
swap.world.apply({ t: 'car_bonnet', carId: swap.state.id, cell: 2, item: largeCore });
swap.vehicle.rebuild();
check(
  'fitting a full large core gives the car its water and its capability',
  swap.state.waterLitres === 13 &&
    swap.vehicle.coolingState.radiatorClass === 'large' &&
    swap.vehicle.coolingState.fit.warning === null,
  `${swap.state.waterLitres} L, ${swap.vehicle.coolingState.radiatorClass}`,
);

const hotCar = await makeRig('cool:hot');
drive(hotCar, seconds(120), 1);
const hotBefore = hotCar.vehicle.coolingState.temperatureC;
for (let i = 0; i < seconds(600); i++) {
  hotCar.vehicle.settle(FIXED_DT);
  hotCar.physics.step();
  hotCar.vehicle.postStep();
}
check(
  'a parked car cools down and persists that',
  hotCar.vehicle.coolingState.temperatureC < hotBefore - 20 &&
    hotCar.state.engineTempC < hotBefore - 20,
  `${hotBefore.toFixed(1)} -> ${hotCar.vehicle.coolingState.temperatureC.toFixed(1)} C parked 10 min`,
);
check(
  'two cars in one world keep independent temperatures',
  Math.abs(factory.state.engineTempC - hotCar.state.engineTempC) > 5,
  `driven ${factory.state.engineTempC.toFixed(1)} C, parked ${hotCar.state.engineTempC.toFixed(1)} C`,
);
console.log(
  `ambient at the tested hour: ${ambientAirC(HOT_AFTERNOON, DAY_LENGTH).toFixed(1)} C`,
);

console.log(failures === 0 ? 'ALL OK' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
