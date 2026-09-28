/**
 * Cooling integration harness: real Vehicles, real physics, real deltas.
 *
 * `tools/cooling.ts` proves the thermal MODEL. This proves the WIRING, which is a
 * different set of mistakes: that driving heats the engine at all, that a low
 * radiator cooks a car that a full one cannot, that a turbo raises the temperature,
 * that the temperature reaches authoritative CarState, that two cars do not share
 * it, that a radiator swapped through the bonnet delta takes effect and keeps its
 * water, that an overheated engine loses power and stalls, and that a parked car
 * cools down.
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
import { engineHeat } from '../src/parts/registry';
import { benchCarState } from './benchcar';
import { Vehicle } from '../src/vehicle/vehicle';
import { WorldOrigin } from '../src/world/origin';
import { preloadCarModels } from '../src/render/carmodel';
import { COLD_SOAK_C, ambientAirC } from '../src/vehicle/cooling';

installAssetShim();

/** A UAZ van: enough load on its engine to cook a low radiator, and it exists in the pack. */
const MODEL_ID = 'sa_uaz330364';
const SETTLE_STEPS = 180;
/** Mid-afternoon, so the desert is working against the radiator like it will in play. */
const HOT_AFTERNOON = DAY_LENGTH * 0.625;

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} ${detail}`);
}

/** `waterFill` is a fraction of the fitted core: 1 is full, 0.2 is a car on fumes. */
function carState(id: string, waterFill: number, x = 0, z = 0): CarState {
  const car = benchCarState(MODEL_ID, { id, x, z });
  return {
    ...car,
    // Several tanks' worth, on purpose: the overheat and cool-down runs are long,
    // and running dry mid-check would stall the engine for the wrong reason.
    fuelLitres: 200,
    waterLitres: car.waterLitres * waterFill,
  };
}

interface Rig {
  physics: PhysicsWorld;
  world: GameWorld;
  vehicle: Vehicle;
  state: CarState;
  input: InputFrame;
}

/** Fits a turbocharger through the same delta the player's hands use. */
function fitTurbo(rig: Rig): void {
  const part: Item = {
    type: 'part',
    id: `${rig.state.id}:turbo`,
    part: { id: `${rig.state.id}:turbo`, variantId: 'turbine_standard', dirt: 0, rust: 0 },
  };
  rig.world.apply({ t: 'car_bonnet', carId: rig.state.id, cell: 1, item: part });
  rig.vehicle.rebuild();
}

async function makeRig(
  id: string,
  options: { waterFill?: number; turbo?: boolean } = {},
): Promise<Rig> {
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
  const state = carState(id, options.waterFill ?? 1);
  world.state.cars[id] = state;
  const vehicle = new Vehicle(physics, world, state, new THREE.Scene(), new WorldOrigin());
  const rig: Rig = { physics, world, vehicle, state, input: emptyInput() };
  if (options.turbo) fitTurbo(rig);
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
  'a factory car ships with the one core, full of water',
  factory.vehicle.coolingState.waterCapacity === 9 &&
    factory.vehicle.coolingState.waterFraction > 0.999,
  `${factory.vehicle.coolingState.waterLitres.toFixed(2)} of ${factory.vehicle.coolingState.waterCapacity} L`,
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
  'a full radiator at full throttle stays out of the warning zone',
  !warmed.overheating && warmed.performance === 1,
  `${warmed.zone}, performance ${warmed.performance.toFixed(2)}`,
);
check(
  'the dashboard readout agrees with the simulation',
  factory.vehicle.engineTemperature?.celsius === warmed.temperatureC &&
    factory.vehicle.engineTemperature?.zone === warmed.zone,
  `${factory.vehicle.engineTemperature?.zone} at ${factory.vehicle.engineTemperature?.fraction.toFixed(2)} of scale`,
);

console.log('cooling-drive: a low radiator');

const lowCar = await makeRig('cool:low', { waterFill: 0.2 });
drive(lowCar, seconds(300), 1);
const cooked = lowCar.vehicle.coolingState;
check(
  'a car on a fifth-full core overheats at full throttle',
  cooked.overheating && cooked.temperatureC > warmed.temperatureC + 15,
  `${cooked.temperatureC.toFixed(1)} C (${cooked.zone}) vs ${warmed.temperatureC.toFixed(1)} C full`,
);
check(
  'overheating costs power and rev range',
  cooked.performance < 1 && cooked.revLimit < 1,
  `performance ${cooked.performance.toFixed(2)}, rev limit ${cooked.revLimit.toFixed(2)}`,
);

// Keep the foot in until the stall that a critical engine earns, or half an hour.
for (let i = 0; i < seconds(1800) && lowCar.vehicle.engineRunning; i++) drive(lowCar, 1, 1);
const boiled = lowCar.vehicle.coolingState;
check(
  'ignoring the lamp boils water away, and the stall then caps the loss',
  boiled.waterCapacity - boiled.waterLitres > 0.5 && boiled.waterLitres > 0,
  `lost ${(boiled.waterCapacity - boiled.waterLitres).toFixed(2)} L, ${boiled.waterLitres.toFixed(2)} L left`,
);
check(
  'a critical engine stalls instead of continuing to make power',
  !lowCar.vehicle.engineRunning || lowCar.vehicle.engineDestroyed,
  `running=${lowCar.vehicle.engineRunning} destroyed=${lowCar.vehicle.engineDestroyed}`,
);

console.log('cooling-drive: a turbo raises the equilibrium');

const naturallyAspirated = await makeRig('cool:na', { waterFill: 0.4 });
const turbocharged = await makeRig('cool:turbo', { waterFill: 0.4, turbo: true });
drive(naturallyAspirated, seconds(180), 1);
drive(turbocharged, seconds(180), 1);
const naTemp = naturallyAspirated.vehicle.coolingState.temperatureC;
const turboTemp = turbocharged.vehicle.coolingState.temperatureC;
check(
  'the same drive runs hotter with a turbo fitted',
  turboTemp > naTemp + 5,
  `turbo ${turboTemp.toFixed(1)} C vs naturally aspirated ${naTemp.toFixed(1)} C`,
);

console.log('cooling-drive: swaps, independence and cool-down');

const swap = await makeRig('cool:swap', { waterFill: 1 });
drive(swap, seconds(60), 1);
const beforeSwap = swap.vehicle.coolingState.temperatureC;
const radiator = swap.state.bonnet[2];
// Pull the radiator and fit it back through the same delta the player's hands use,
// which is what proves the swap path rather than a direct field write.
swap.world.apply({ t: 'car_bonnet', carId: swap.state.id, cell: 2, item: null });
swap.vehicle.rebuild();
check(
  'pulling the radiator takes its water with it',
  radiator?.type === 'part' &&
    (radiator.part.litres ?? 0) > 0 &&
    swap.state.waterLitres === 0 &&
    swap.vehicle.coolingState.waterCapacity === 0,
  `${radiator?.type === 'part' ? (radiator.part.litres ?? 0).toFixed(2) : 'n/a'} L in the part`,
);
drive(swap, seconds(20), 1);
check(
  'running with no radiator at all heats the engine instead of crashing',
  swap.vehicle.coolingState.temperatureC > beforeSwap,
  `${beforeSwap.toFixed(1)} -> ${swap.vehicle.coolingState.temperatureC.toFixed(1)} C`,
);

const refittedRadiator: Item = {
  type: 'part',
  id: 'cool:swap:radiator',
  part: { id: 'cool:swap:radiator', variantId: 'radiator', dirt: 0, rust: 0, litres: 9 },
};
swap.world.apply({ t: 'car_bonnet', carId: swap.state.id, cell: 2, item: refittedRadiator });
swap.vehicle.rebuild();
drive(swap, 1, 1);
check(
  'fitting a full core gives the car its water back',
  swap.state.waterLitres === 9 &&
    swap.vehicle.coolingState.waterCapacity === 9 &&
    swap.vehicle.coolingState.waterEffect === 1,
  `${swap.state.waterLitres} L, effect ${swap.vehicle.coolingState.waterEffect.toFixed(2)}`,
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
  'two cars keep independent temperatures',
  Math.abs(factory.state.engineTempC - hotCar.state.engineTempC) > 5,
  `driven ${factory.state.engineTempC.toFixed(1)} C, parked ${hotCar.state.engineTempC.toFixed(1)} C`,
);
console.log(
  `ambient at the tested hour: ${ambientAirC(HOT_AFTERNOON, DAY_LENGTH).toFixed(1)} C`,
);

console.log(failures === 0 ? 'ALL OK' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
