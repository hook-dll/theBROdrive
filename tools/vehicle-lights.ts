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
import { VehicleLightRig } from '../src/render/vehiclelights';
import { Vehicle } from '../src/vehicle/vehicle';
import { carModel } from '../src/vehicle/carmodels';
import { createBonnetStorage } from '../src/vehicle/bonnet';
import { WorldOrigin } from '../src/world/origin';

class BunProgressEvent extends Event implements ProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;

  constructor(type: string, init: ProgressEventInit = {}) {
    super(type, init);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

if (globalThis.ProgressEvent === undefined) globalThis.ProgressEvent = BunProgressEvent;

const MODEL_ID = 'proc_wedge';
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
    gizmos: {},
    stickers: [],
    ...lamps,
    dirt: 0,
    scratches: 0,
    coolantLitres: 10,
    bonnet: createBonnetStorage(
      `vehicle-lights:${index}`,
      carModel(MODEL_ID).engineId,
      carModel(MODEL_ID).bodyClass,
      carModel(MODEL_ID).tankLitres,
    ),
    oilLitres: 10,
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
 * Three loaders issue root-relative browser requests. Keep their real loading path
 * intact by serving public/ from this Bun process, then restore the global request
 * constructor before vehicle construction. `stop(true)` guarantees no server
 * remains after either a success or a failed preload.
 */
async function preloadModels(): Promise<void> {
  const publicRoot = new URL('../public/', import.meta.url);
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      if (pathname.includes('..')) return new Response('Not found', { status: 404 });
      const file = Bun.file(new URL(`.${pathname}`, publicRoot));
      return new Response(file);
    },
  });
  const NativeRequest = globalThis.Request;

  class AssetRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(
        typeof input === 'string' && input.startsWith('/') ? new URL(input, server.url).href : input,
        init,
      );
    }
  }

  globalThis.Request = AssetRequest;
  try {
    await preloadCarModels([MODEL_ID]);
  } finally {
    globalThis.Request = NativeRequest;
    server.stop(true);
  }
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

function litCount(lights: readonly THREE.SpotLight[]): number {
  return lights.filter((light) => light.intensity > 0).length;
}

function allZero(lights: readonly THREE.SpotLight[]): boolean {
  return lights.every((light) => light.intensity === 0);
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
  /** One rendered frame: offer every lit vehicle, exactly as main.ts does. */
  const projectFrame = (activeRig: VehicleLightRig): void => {
    activeRig.beginFrame();
    for (const vehicle of vehicles) {
      if (vehicle.hasLitLamps) vehicle.syncProjectedLights(activeRig);
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
    const identities = spotlights(scene);
    const targets = identities.map((light) => light.target);
    assertRigState(scene, rig, identities, targets, 'rig construction');
    check('rig construction: six slots exist', rig.lightCount === 6, `${rig.lightCount} slots`);
    check('rig construction: all slots start dark', allZero(identities), identities.map((light) => light.intensity).join(', '));

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

    // A second car lit beside it: both must project, which one shared six-slot
    // vehicle could not do.
    vehicles[1].cycleHeadlights();
    vehicles[1].syncVisuals(1);
    projectFrame(rig);
    assertRigState(scene, rig, identities, targets, 'two lit vehicles');
    check(
      'two lit vehicles: both project, none dropped',
      rig.beamCount === restoredBeams * 2 && litCount(spotlights(scene)) === rig.beamCount,
      `${rig.beamCount} beams from ${restoredBeams} each`,
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
      rig.beamCount === 0 && allZero(spotlights(scene)),
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

    while (vehicles.length > 0) vehicles.pop()!.dispose();
    rig.clear();
    assertRigState(scene, rig, identities, targets, 'vehicles disposed');
    check('vehicles disposed: every rig slot remains dark', allZero(spotlights(scene)), `${rig.beamCount} beams`);

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
