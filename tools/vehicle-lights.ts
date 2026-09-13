/**
 * Deterministic fixed vehicle-light-rig harness.
 *
 * Run with `bun tools/vehicle-lights.ts`. It opens a local public/ asset host only
 * long enough to use the real model preloader, then materialises several actual
 * parked vehicles while observing the Three scene's light objects directly.
 *
 * What it defends: a beam belongs to a LIT LAMP, not to the driven car. Every live
 * vehicle with a lamp on projects, including one restored straight from a save and
 * never driven; dark lamps claim no spotlight; and the pool of spotlights the
 * renderer sees never shrinks, so no light-count change can recompile the world.
 */

import * as THREE from 'three';
import { PhysicsWorld } from '../src/core/physics';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import { disposeCarModelCache, preloadCarModels } from '../src/render/carmodel';
import { ambientBeamGain, VehicleLightRig } from '../src/render/vehiclelights';
import { Vehicle } from '../src/vehicle/vehicle';
import { carModel } from '../src/vehicle/carmodels';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { COLD_SOAK_C } from '../src/vehicle/cooling';
import { WorldOrigin } from '../src/world/origin';
import { installAssetShim } from './assetshim';


const MODEL_ID = 'gt_vaz2110';
const VEHICLE_COUNT = 4;
let failures = 0;

function check(label: string, condition: boolean, detail: string): void {
  if (!condition) failures++;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
}

/** A parked car; `lamps` is what a save would have restored onto it. */
function carState(
  index: number,
  lamps: Pick<CarState, 'headlightMode' | 'taillightsOn' | 'reverseLightsOn'> = {
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
  },
): CarState {
  return {
    id: `vehicle-lights:${index}`,
    modelId: MODEL_ID,
    stickers: [],
    ...lamps,
    dirt: 0,
    scratches: 0,
    damage: [],
    waterLitres: 10,
    bonnet: createBonnetStorage(
      `vehicle-lights:${index}`,
      carModel(MODEL_ID).engineId,
      carModel(MODEL_ID).bodyClass,
      carModel(MODEL_ID).tankLitres,
    ),
    oilLitres: 10,
    engineTempC: COLD_SOAK_C,
    storage: [],
    odometer: 0,
    x: index * 12,
    y: 1.2,
    z: index * -7,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  };
}

/**
 * The real loading path, headless. `installAssetShim` is what teaches three's
 * loaders to read root-absolute model paths off the disk, resolves textures to a
 * blank (nothing here reads a pixel) and gives `FBXLoader` the `window` it sizes
 * its authoring cameras from before `carmodel.ts` throws them away.
 */
async function preloadModels(): Promise<void> {
  installAssetShim();
  await preloadCarModels([MODEL_ID]);
}

function spotlights(scene: THREE.Scene): THREE.SpotLight[] {
  const found: THREE.SpotLight[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.SpotLight) found.push(object);
  });
  return found;
}

function sceneContains(scene: THREE.Scene, object: THREE.Object3D): boolean {
  let found = false;
  scene.traverse((candidate) => {
    if (candidate === object) found = true;
  });
  return found;
}

const VISIBLY_LIT_INTENSITY = 1e-6;

function litCount(lights: readonly THREE.SpotLight[]): number {
  return lights.filter((light) => light.intensity > VISIBLY_LIT_INTENSITY).length;
}

function allDark(lights: readonly THREE.SpotLight[]): boolean {
  return lights.every((light) => light.intensity <= VISIBLY_LIT_INTENSITY);
}

/**
 * The rig's structural invariants. The pool may only grow, every original light
 * object and target must survive that growth, and no light may ever be hidden:
 * Three keys shader programs on the count of VISIBLE lights, so a slot that
 * disappears at dusk or when a car is parked recompiles every lit material.
 */
function assertRigState(
  scene: THREE.Scene,
  rig: VehicleLightRig,
  identities: readonly THREE.SpotLight[],
  targets: readonly THREE.Object3D[],
  phase: string,
): void {
  const current = spotlights(scene);
  check(
    `${phase}: scene light count matches the rig pool`,
    current.length === rig.lightCount,
    `${current.length} lights, ${rig.lightCount} slots`,
  );
  check(
    `${phase}: pool never shrinks below its initial six`,
    rig.lightCount >= identities.length && rig.lightCount >= 6,
    `${rig.lightCount} slots`,
  );
  check(
    `${phase}: original light identities stay fixed`,
    identities.every((light, index) => current[index] === light),
    `${identities.filter((light, index) => current[index] === light).length}/${identities.length} retained`,
  );
  check(
    `${phase}: every distinct rig target remains in scene`,
    new Set(current.map((light) => light.target)).size === current.length &&
      targets.every((target) => sceneContains(scene, target)),
    `${targets.filter((target) => sceneContains(scene, target)).length}/${targets.length} targets`,
  );
  check(
    `${phase}: no slot is ever hidden`,
    current.every((light) => light.visible),
    current.map((light) => String(light.visible)).join(', '),
  );
}

async function run(): Promise<void> {
  let physics: PhysicsWorld | null = null;
  let rig: VehicleLightRig | null = null;
  let rigDisposed = false;
  const vehicles: Vehicle[] = [];
  /**
   * One rendered frame: offer every lit vehicle, as main.ts does. These vehicles are
   * all parked with no camera, so each is offered the driven car's undimmed gain;
   * the ambient fade has its own scenario below.
   */
  const projectFrame = (activeRig: VehicleLightRig): void => {
    activeRig.beginFrame();
    for (const vehicle of vehicles) {
      if (vehicle.hasLitLamps) vehicle.syncProjectedLights(activeRig, 1);
    }
    activeRig.endFrame();
  };

  try {
    await preloadModels();
    physics = await PhysicsWorld.create();
    const scene = new THREE.Scene();
    const world = new GameWorld(newWorldState(1));
    const origin = new WorldOrigin();

    rig = new VehicleLightRig(scene);
    const blessingScene = new THREE.Scene();
    const blessingRig = new VehicleLightRig(blessingScene, 'blessing');
    check('blessing quality allocates eighteen lamp slots', blessingRig.lightCount === 18, `${blessingRig.lightCount} slots`);
    check('blessing quality triples headlight reach', blessingRig.headlightDistanceScale === 3, `${blessingRig.headlightDistanceScale}x`);
    blessingRig.dispose();
    const identities = spotlights(scene);
    const targets = identities.map((light) => light.target);
    assertRigState(scene, rig, identities, targets, 'rig construction');
    check('rig construction: six slots exist', rig.lightCount === 6, `${rig.lightCount} slots`);
    check('rig construction: all slots start dark', allDark(identities), identities.map((light) => light.intensity).join(', '));

    // Index 0 is restored from a save with its dipped beam and tail lamps already
    // on, and is never driven in this harness: the case that used to project nothing.
    for (let index = 0; index < VEHICLE_COUNT; index++) {
      const state =
        index === 0
          ? carState(index, { headlightMode: 'low', taillightsOn: true, reverseLightsOn: false })
          : carState(index);
      world.state.cars[state.id] = state;
      const vehicle = new Vehicle(physics, world, state, scene, origin);
      vehicle.postStep();
      vehicle.syncVisuals(1);
      vehicles.push(vehicle);
    }

    projectFrame(rig);
    assertRigState(scene, rig, identities, targets, 'restored save, on foot');
    check(
      'restored save: the loaded lamp state casts beams',
      rig.beamCount >= 2 && litCount(spotlights(scene)) === rig.beamCount,
      `${rig.beamCount} beams, ${litCount(spotlights(scene))} lit`,
    );
    check(
      'restored save: only the lit car claims slots',
      vehicles[0].hasLitLamps && vehicles.slice(1).every((vehicle) => !vehicle.hasLitLamps),
      vehicles.map((vehicle) => String(vehicle.hasLitLamps)).join(', '),
    );
    check(
      'restored save: pool did not grow for one lit car',
      rig.lightCount === 6,
      `${rig.lightCount} slots`,
    );
    const restoredBeams = rig.beamCount;

    // A second car lit beside it: both must project, up to the pool's fixed size.
    // Six slots is a hard ceiling by design (render/vehiclelights.ts): two fully lit
    // four-beam cars ask for eight, and the two farthest lamps lose their pool of
    // light on the ground while their lenses still glow.
    vehicles[1].cycleHeadlights();
    vehicles[1].syncVisuals(1);
    projectFrame(rig);
    assertRigState(scene, rig, identities, targets, 'two lit vehicles');
    const wanted = Math.min(restoredBeams * 2, 6);
    check(
      'two lit vehicles: both project, up to the pool ceiling',
      rig.beamCount === wanted && litCount(spotlights(scene)) === rig.beamCount,
      `${rig.beamCount} beams of ${restoredBeams * 2} asked for`,
    );
    check(
      'two lit vehicles: pool grew to carry them',
      rig.lightCount >= rig.beamCount,
      `${rig.lightCount} slots for ${rig.beamCount} beams`,
    );
    const grownCount = rig.lightCount;

    // Lamps off: the slots go dark by intensity, and the pool holds its size so no
    // shader permutation moves.
    vehicles[0].cycleHeadlights();
    vehicles[0].cycleHeadlights();
    vehicles[1].cycleHeadlights();
    vehicles[1].cycleHeadlights();
    for (const vehicle of vehicles) vehicle.syncVisuals(1);
    projectFrame(rig);
    assertRigState(scene, rig, identities, targets, 'lamps switched off');
    check(
      'lamps off: every slot is dark',
      rig.beamCount === 0 && allDark(spotlights(scene)),
      `${rig.beamCount} beams`,
    );
    check(
      'lamps off: pool holds its size',
      rig.lightCount === grownCount,
      `${rig.lightCount} slots, was ${grownCount}`,
    );

    // Relighting must reuse those same lights rather than allocate more.
    vehicles[2].cycleHeadlights();
    vehicles[2].syncVisuals(1);
    projectFrame(rig);
    assertRigState(scene, rig, identities, targets, 'third vehicle lit');
    check(
      'third vehicle lit: a never-driven neighbour projects too',
      rig.beamCount > 0 && rig.lightCount === grownCount,
      `${rig.beamCount} beams, ${rig.lightCount} slots`,
    );
    check(
      'third vehicle lit: its own state was persisted',
      world.state.cars['vehicle-lights:2']?.headlightMode === 'low',
      JSON.stringify(world.state.cars['vehicle-lights:2']),
    );

    // The ambient fade is what keeps another car's pool from arriving as a step.
    // Four lit cars, all offered at the gain of a car 200 m away: not one slot may
    // be claimed, because at that range the beam is worth nothing and a refusal or
    // a spawn there must be invisible. Then the same four at close range claim the
    // pool, and every claimed beam is dimmer than the driven car's own would be.
    for (const vehicle of vehicles) {
      vehicle.setHeadlights('low');
      vehicle.syncVisuals(1);
    }
    rig.beginFrame();
    for (const vehicle of vehicles) vehicle.syncProjectedLights(rig, ambientBeamGain(200));
    rig.endFrame();
    check(
      'far ambient cars: a faded beam claims no slot',
      ambientBeamGain(200) === 0 && rig.beamCount === 0 && allDark(spotlights(scene)),
      `gain ${ambientBeamGain(200)}, ${rig.beamCount} beams`,
    );
    rig.beginFrame();
    for (const vehicle of vehicles) vehicle.syncProjectedLights(rig, ambientBeamGain(20));
    rig.endFrame();
    const nearBeams = rig.beamCount;
    // Numbers, not light objects: the next frame overwrites the same slots.
    const fadedHeadlight = Math.max(
      ...spotlights(scene).map((light) => (light.distance > 100 ? light.intensity : 0)),
    );
    rig.beginFrame();
    vehicles[0].syncProjectedLights(rig, 1);
    rig.endFrame();
    const drivenHeadlight = Math.max(
      ...spotlights(scene).map((light) => (light.distance > 100 ? light.intensity : 0)),
    );
    check(
      'near ambient cars: beams project, dimmer than the driven car',
      nearBeams === rig.lightCount &&
        fadedHeadlight > 0 &&
        fadedHeadlight < drivenHeadlight * 0.5,
      `${fadedHeadlight.toFixed(2)} vs ${drivenHeadlight.toFixed(2)} driven`,
    );
    assertRigState(scene, rig, identities, targets, 'ambient fade');

    while (vehicles.length > 0) vehicles.pop()!.dispose();
    rig.clear();
    assertRigState(scene, rig, identities, targets, 'vehicles disposed');
    check('vehicles disposed: every rig slot remains dark', allDark(spotlights(scene)), `${rig.beamCount} beams`);

    const pooled = spotlights(scene);
    const pooledTargets = pooled.map((light) => light.target);
    rig.dispose();
    rigDisposed = true;
    check('rig disposal: no vehicle SpotLights remain', spotlights(scene).length === 0, `${spotlights(scene).length} lights`);
    check(
      'rig disposal: every rig target is removed',
      pooledTargets.every((target) => !sceneContains(scene, target)),
      `${pooledTargets.filter((target) => sceneContains(scene, target)).length}/${pooledTargets.length} targets remain`,
    );
  } finally {
    while (vehicles.length > 0) vehicles.pop()!.dispose();
    if (rig && !rigDisposed) rig.dispose();
    physics?.world.free();
    disposeCarModelCache();
  }
}

await run();
if (failures > 0) process.exitCode = 1;
