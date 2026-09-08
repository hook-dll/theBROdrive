/**
 * Servicing: filling containers, wearing an engine out, and replacing it.
 *
 * `tools/cooling.ts` proves the thermal model and `tools/cooling-drive.ts` its
 * wiring. This proves the SERVICE rules a player actually operates:
 *
 *  - A container that is not fitted to anything can still be filled. An engine, a
 *    radiator or a tank lying in the world takes fluid where it lies, keeps it, and
 *    hands it to the car when it is installed; so does a can on the ground.
 *  - An engine is destroyed by being RUN wrecked, never by one bad moment: a dry
 *    sump or a temperature past the maximum has to be held for tens of seconds, and
 *    fixing it in time saves the block.
 *  - A replacement engine is a NEW engine. It is not destroyed, it does not inherit
 *    the temperature that killed the last one, and it runs.
 *
 * Run: `bun tools/service.ts`
 */

import * as THREE from 'three';
import { installAssetShim } from './assetshim';
import { FIXED_DT, PhysicsWorld } from '../src/core/physics';
import { emptyInput, type InputFrame } from '../src/core/input';
import { SurfaceType } from '../src/core/surfaces';
import { GameWorld, newWorldState, DAY_LENGTH, type CarState } from '../src/game/state';
import { Inventory, type Item } from '../src/items/items';
import { engineHeat, oilCapacity, variant, type PartInstance } from '../src/parts/registry';
import { LoosePartField } from '../src/parts/loose';
import { Interaction } from '../src/player/interaction';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { carModel } from '../src/vehicle/carmodels';
import { COLD_SOAK_C, EngineCoolingSystem, ambientAirC } from '../src/vehicle/cooling';
import { TrailerField } from '../src/vehicle/trailer';
import { Vehicle } from '../src/vehicle/vehicle';
import { FreightField } from '../src/world/freight';
import { WreckTrunkField } from '../src/world/wrecktrunks';
import { WorldOrigin } from '../src/world/origin';
import { Road } from '../src/world/road';
import { preloadCarModels } from '../src/render/carmodel';

installAssetShim();

const MODEL_ID = 'sa_uaz330364';
const HOT_AFTERNOON = DAY_LENGTH * 0.625;
let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
}

const seconds = (s: number): number => Math.round(s / FIXED_DT);

function carState(id: string, oilLitres: number): CarState {
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
    damage: [],
    waterLitres: 40,
    oilLitres,
    engineTempC: COLD_SOAK_C,
    storage: new Array<Item | null>(def.storageCells).fill(null),
    bonnet: createBonnetStorage(id, def.engineId, def.bodyClass, def.tankLitres),
    odometer: 0,
    x: 0,
    y: 1.2,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  };
}

async function flatWorld(): Promise<{ physics: PhysicsWorld; world: GameWorld }> {
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
  return { physics, world };
}

await preloadCarModels([MODEL_ID]);

// ---------------------------------------------------------------- pouring
console.log('service: pouring into parts that are not fitted');

const pourRig = await flatWorld();
const scene = new THREE.Scene();
const origin = new WorldOrigin();
const inventory = new Inventory();
const loose = new LoosePartField(pourRig.physics, pourRig.world, scene, origin);
const trailers = new TrailerField(pourRig.physics, pourRig.world, scene, origin);
const freight = new FreightField(
  pourRig.physics,
  pourRig.world,
  scene,
  origin,
  new Road(pourRig.world.state.seed),
);
const wreckTrunks = new WreckTrunkField(pourRig.world);
const interaction = new Interaction(
  pourRig.physics,
  pourRig.world,
  inventory,
  loose,
  trailers,
  freight,
  wreckTrunks,
  () => null,
  () => {},
  origin,
);

const engineVariantId = carModel(MODEL_ID).engineId;
/** An engine variant the loose-part mesh builder knows how to draw. */
const looseEngineVariantId = 'engine_zmz_24';
const looseEngine: PartInstance = {
  id: 'floor:engine',
  variantId: looseEngineVariantId,
  dirt: 0,
  rust: 0,
};
loose.spawn(looseEngine, 2, 0.5, 0);
const looseTank: PartInstance = { id: 'floor:tank', variantId: 'tank_40', dirt: 0, rust: 0 };
loose.spawn(looseTank, 2, 0.5, 4);
const groundCan = {
  type: 'fluid_can' as const,
  id: 'floor:can',
  fluid: 'oil' as const,
  capacity: 5,
  litres: 1,
};
loose.spawnItem(groundCan, 2, 0.5, 8);
loose.updateActive(0, 0, 200, 400);
pourRig.physics.step();

const oilCan = {
  type: 'fluid_can' as const,
  id: 'hand:oil',
  fluid: 'oil' as const,
  capacity: 5,
  litres: 5,
};
const petrolCan = {
  type: 'fluid_can' as const,
  id: 'hand:petrol',
  fluid: 'petrol' as const,
  capacity: 20,
  litres: 20,
};
const dieselCan = {
  type: 'fluid_can' as const,
  id: 'hand:diesel',
  fluid: 'diesel' as const,
  capacity: 20,
  litres: 20,
};
if (!inventory.add(oilCan) || !inventory.add(petrolCan) || !inventory.add(dieselCan)) {
  throw new Error('the pack refused a can');
}

function select(itemId: string): void {
  inventory.select(itemId);
  if (inventory.held?.id !== itemId) throw new Error(`could not hold ${itemId}`);
}

/** Aims at (targetX, y, targetZ) from one metre away and holds the trigger. */
function pourAt(steps: number, targetZ: number, use = true): string | null {
  const input: InputFrame = emptyInput();
  input.usePrimary = use;
  let prompt: string | null = null;
  const eyeX = 0.6;
  const eyeY = 0.9;
  const eyeZ = targetZ;
  const dx = 2 - eyeX;
  const dy = 0.5 - eyeY;
  const length = Math.hypot(dx, dy);
  for (let i = 0; i < steps; i++) {
    prompt = interaction.fixedUpdate(
      FIXED_DT,
      input,
      eyeX,
      eyeY,
      eyeZ,
      dx / length,
      dy / length,
      0,
      0,
    ).prompt;
  }
  return prompt;
}

select('hand:oil');
const enginePrompt = pourAt(1, 0, false);
check(
  'a loose engine offers the pour and reads its own level',
  enginePrompt !== null && enginePrompt.includes('pour oil') && enginePrompt.includes('oil 0.0/'),
  `${enginePrompt}`,
);

pourAt(seconds(3), 0);
const engineAfter = pourRig.world.state.looseParts['floor:engine']?.part;
check(
  'oil goes into an engine lying on the floor',
  (engineAfter?.litres ?? 0) > 3 && oilCan.litres < 2,
  `part ${(engineAfter?.litres ?? 0).toFixed(2)} L, can ${oilCan.litres.toFixed(2)} L`,
);

const engineCapacity = oilCapacity(variant(looseEngineVariantId).engine!);
pourAt(seconds(20), 0);
check(
  'a loose engine never takes more than its sump holds',
  (pourRig.world.state.looseParts['floor:engine']?.part.litres ?? 0) <= engineCapacity + 1e-6,
  `${(pourRig.world.state.looseParts['floor:engine']?.part.litres ?? 0).toFixed(2)} / ${engineCapacity.toFixed(2)} L`,
);

select('hand:petrol');
const wrongPrompt = pourAt(1, 0, false);
check(
  'petrol is refused by an engine sump, with a reason',
  wrongPrompt !== null && wrongPrompt.includes('does not go in there'),
  `${wrongPrompt}`,
);
const beforeWrong = pourRig.world.state.looseParts['floor:engine']?.part.litres ?? 0;
pourAt(seconds(2), 0);
check(
  'and pouring it changes nothing',
  (pourRig.world.state.looseParts['floor:engine']?.part.litres ?? 0) === beforeWrong,
  `${beforeWrong.toFixed(2)} L unchanged`,
);

pourAt(seconds(4), 4);
const tankFirst = pourRig.world.state.looseParts['floor:tank']?.part;
check(
  'a loose fuel tank fills and takes the identity of the fuel',
  (tankFirst?.litres ?? 0) > 4 && tankFirst?.fuelKind === 'petrol',
  `${(tankFirst?.litres ?? 0).toFixed(2)} L of ${tankFirst?.fuelKind}`,
);

select('hand:diesel');
pourAt(seconds(2), 4);
check(
  'diesel on top of petrol contaminates it, loose exactly as fitted',
  pourRig.world.state.looseParts['floor:tank']?.part.fuelKind === 'mixed',
  `${pourRig.world.state.looseParts['floor:tank']?.part.fuelKind}`,
);

select('hand:oil');
const canBefore = groundCan.litres;
const handBefore = oilCan.litres;
const canPrompt = pourAt(1, 8, false);
pourAt(seconds(6), 8);
const canNow = pourRig.world.state.looseItems['floor:can']?.item;
check(
  'a can on the ground can be topped up from a can in hand',
  canPrompt !== null
    && canPrompt.includes('pour oil')
    && canNow?.type === 'fluid_can'
    && Math.abs(canNow.litres - (canBefore + handBefore)) < 1e-6
    && oilCan.litres < 1e-6,
  `${canBefore.toFixed(2)} + ${handBefore.toFixed(2)} -> ${canNow?.type === 'fluid_can' ? canNow.litres.toFixed(2) : '?'} L, hand ${oilCan.litres.toFixed(2)} L`,
);

// A filled loose engine must hand its oil to the car when it is installed.
const receiver = carState('svc:receiver', 0);
pourRig.world.state.cars[receiver.id] = receiver;
const filledEngine = pourRig.world.state.looseParts['floor:engine']!.part;
const carriedOil = filledEngine.litres ?? 0;
pourRig.world.apply({ t: 'part_pickup', partId: filledEngine.id });
pourRig.world.apply({
  t: 'car_bonnet',
  carId: receiver.id,
  cell: 0,
  item: { type: 'part', id: filledEngine.id, part: filledEngine },
});
check(
  'installing a container hands the car the fluid it was filled with',
  Math.abs(receiver.oilLitres - carriedOil) < 1e-6 && carriedOil > 3,
  `${carriedOil.toFixed(2)} L in, car now ${receiver.oilLitres.toFixed(2)} L`,
);

// ------------------------------------------------------- oil starvation
console.log('service: an engine is wrecked by being run wrecked');

const dryRig = await flatWorld();
const dry = carState('svc:dry', 0);
dryRig.world.state.cars[dry.id] = dry;
const dryVehicle = new Vehicle(dryRig.physics, dryRig.world, dry, new THREE.Scene(), new WorldOrigin());
const dryInput = emptyInput();
function run(vehicle: Vehicle, rig: { physics: PhysicsWorld }, steps: number, throttle: number): void {
  for (let i = 0; i < steps; i++) {
    dryInput.throttle = throttle;
    vehicle.fixedUpdate(FIXED_DT, dryInput);
    rig.physics.step();
    vehicle.postStep();
  }
}

run(dryVehicle, dryRig, seconds(10), 1);
check(
  'ten seconds with a dry sump does not destroy the engine',
  !dryVehicle.engineDestroyed && dryVehicle.engineRunning,
  `running ${dryVehicle.engineRunning}, destroyed ${dryVehicle.engineDestroyed}`,
);

// A can arrives in time: the accumulated damage decays instead of killing it.
dryRig.world.apply({ t: 'car_fluid', carId: dry.id, fluid: 'oil', litres: 6 });
run(dryVehicle, dryRig, seconds(30), 1);
check(
  'topping it up in time saves it',
  !dryVehicle.engineDestroyed,
  `oil ${dry.oilLitres.toFixed(2)} L, destroyed ${dryVehicle.engineDestroyed}`,
);

dryRig.world.apply({ t: 'car_fluid', carId: dry.id, fluid: 'oil', litres: 0 });
run(dryVehicle, dryRig, seconds(45), 1);
check(
  'ignoring the oil lamp for long enough destroys it',
  dryVehicle.engineDestroyed,
  `destroyed ${dryVehicle.engineDestroyed} after 45 s dry`,
);

// ----------------------------------------------------------- overheating
console.log('service: overheating needs sustained abuse');

const engineSpec = variant(engineVariantId).engine!;
const heat = engineHeat(engineSpec);
const cooling = new EngineCoolingSystem(COLD_SOAK_C);
cooling.configure(engineSpec, null);
cooling.setTemperature(heat.maxC + 25);
let seizeSeconds = 0;
for (let i = 0; i < seconds(120); i++) {
  cooling.update(FIXED_DT, { load: 1, revs: 1, speedMps: 0, ambientC: 40, engineRunning: true });
  seizeSeconds += FIXED_DT;
  if (cooling.takeSeizure()) break;
}
check(
  'a cooked engine survives a scare and dies only after sustained abuse',
  seizeSeconds > 30 && seizeSeconds < 60,
  `seized after ${seizeSeconds.toFixed(1)} s above ${heat.maxC.toFixed(0)} C`,
);

const cooldown = new EngineCoolingSystem(COLD_SOAK_C);
cooldown.configure(engineSpec, null);
cooldown.setTemperature(heat.maxC + 25);
for (let i = 0; i < seconds(20); i++) {
  cooldown.update(FIXED_DT, { load: 1, revs: 1, speedMps: 0, ambientC: 40, engineRunning: true });
}
cooldown.setTemperature(heat.optimalMaxC);
let seizedAfterLift = false;
for (let i = 0; i < seconds(120); i++) {
  cooldown.update(FIXED_DT, { load: 0, revs: 0, speedMps: 20, ambientC: 40, engineRunning: true });
  if (cooldown.takeSeizure()) seizedAfterLift = true;
}
check(
  'lifting off before the limit keeps the engine',
  !seizedAfterLift,
  `20 s over the maximum then cooled: destroyed ${seizedAfterLift}`,
);

// ------------------------------------------------------- a fresh engine
console.log('service: a replacement engine is a new engine');

const swapRig = await flatWorld();
const swap = carState('svc:swap', 6);
swapRig.world.state.cars[swap.id] = swap;
const swapVehicle = new Vehicle(swapRig.physics, swapRig.world, swap, new THREE.Scene(), new WorldOrigin());
const swapInput = emptyInput();
function runSwap(steps: number, throttle: number): void {
  for (let i = 0; i < steps; i++) {
    swapInput.throttle = throttle;
    swapVehicle.fixedUpdate(FIXED_DT, swapInput);
    swapRig.physics.step();
    swapVehicle.postStep();
  }
}

// Wreck the fitted engine the way the game now wrecks one: run it dry long enough.
swapRig.world.apply({ t: 'car_fluid', carId: swap.id, fluid: 'oil', litres: 0 });
runSwap(seconds(45), 1);
check(
  'the fitted engine is destroyed by sustained abuse',
  swapVehicle.engineDestroyed,
  `destroyed ${swapVehicle.engineDestroyed} at ${swap.engineTempC.toFixed(1)} C`,
);
const cookedTemp = swap.engineTempC;

// Fit a fresh block, with oil in it, and refill the radiator.
const freshEngine: PartInstance = {
  id: 'svc:fresh-engine',
  variantId: engineVariantId,
  dirt: 0,
  rust: 0,
  litres: oilCapacity(engineSpec),
};
swapRig.world.apply({
  t: 'car_bonnet',
  carId: swap.id,
  cell: 0,
  item: { type: 'part', id: freshEngine.id, part: freshEngine },
});
swapRig.world.apply({ t: 'car_fluid', carId: swap.id, fluid: 'water', litres: 40 });
swapVehicle.rebuild();
const ambient = ambientAirC(swapRig.world.state.timeOfDay, DAY_LENGTH);
check(
  'the fresh engine is not destroyed and starts at air temperature',
  !swapVehicle.engineDestroyed && Math.abs(swap.engineTempC - ambient) < 1,
  `was ${cookedTemp.toFixed(1)} C, now ${swap.engineTempC.toFixed(1)} C (air ${ambient.toFixed(1)} C)`,
);
check(
  'and it arrived with the oil it was filled with',
  swap.oilLitres > 3,
  `${swap.oilLitres.toFixed(2)} L`,
);

runSwap(seconds(20), 1);
check(
  'the replacement runs, pulls, and stays intact',
  swapVehicle.engineRunning && !swapVehicle.engineDestroyed && swapVehicle.speedKmh > 15,
  `${swapVehicle.speedKmh.toFixed(1)} km/h at ${swap.engineTempC.toFixed(1)} C`,
);

console.log(failures === 0 ? 'all service checks passed' : `${failures} service check(s) FAILED`);
if (failures > 0) process.exitCode = 1;
