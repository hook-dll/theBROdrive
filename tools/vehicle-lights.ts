/**
 * Deterministic fixed vehicle-light-rig harness.
 *
 * Run with `bun tools/vehicle-lights.ts`. It opens a local public/ asset host only
 * long enough to use the real model preloader, then materialises several actual
 * parked vehicles while observing the Three scene's light objects directly.
 */

import * as THREE from 'three';
import { PhysicsWorld } from '../src/core/physics';
import { GameWorld, newWorldState, type CarState } from '../src/game/state';
import { disposeCarModelCache, preloadCarModels } from '../src/render/carmodel';
import { VehicleLightRig } from '../src/render/vehiclelights';
import { Vehicle } from '../src/vehicle/vehicle';
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

function carState(index: number): CarState {
  return {
    id: `vehicle-lights:${index}`,
    modelId: MODEL_ID,
    gizmos: {},
    stickers: [],
    fuelLitres: 40,
    coolantLitres: 10,
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

function allZero(lights: readonly THREE.SpotLight[]): boolean {
  return lights.every((light) => light.intensity === 0);
}

function assertRigState(
  scene: THREE.Scene,
  rig: VehicleLightRig,
  identities: readonly THREE.SpotLight[],
  targets: readonly THREE.Object3D[],
  visibility: readonly boolean[],
  phase: string,
): void {
  const current = spotlights(scene);
  check(`${phase}: rig reports six slots`, rig.lightCount === 6, `${rig.lightCount} slots`);
  check(`${phase}: scene has six vehicle SpotLights`, current.length === 6, `${current.length} lights`);
  check(
    `${phase}: light identities stay fixed`,
    current.length === identities.length && current.every((light, index) => light === identities[index]),
    `${current.length}/${identities.length} retained`,
  );
  check(
    `${phase}: all six distinct rig targets remain in scene`,
    targets.length === 6 &&
      new Set(targets).size === 6 &&
      targets.every((target) => sceneContains(scene, target)),
    `${targets.filter((target) => sceneContains(scene, target)).length}/${targets.length} targets`,
  );
  check(
    `${phase}: visibility remains unchanged`,
    current.length === visibility.length && current.every((light, index) => light.visible === visibility[index]),
    current.map((light) => String(light.visible)).join(', '),
  );
}

async function run(): Promise<void> {
  let physics: PhysicsWorld | null = null;
  let rig: VehicleLightRig | null = null;
  let rigDisposed = false;
  const vehicles: Vehicle[] = [];

  try {
    await preloadModels();
    physics = await PhysicsWorld.create();
    const scene = new THREE.Scene();
    const world = new GameWorld(newWorldState(1));
    const origin = new WorldOrigin();

    rig = new VehicleLightRig(scene);
    const identities = spotlights(scene);
    const targets = identities.map((light) => light.target);
    const visibility = identities.map((light) => light.visible);
    assertRigState(scene, rig, identities, targets, visibility, 'rig construction');
    check('rig construction: all slots start dark', allZero(identities), identities.map((light) => light.intensity).join(', '));

    for (let index = 0; index < VEHICLE_COUNT; index++) {
      const state = carState(index);
      world.state.cars[state.id] = state;
      const vehicle = new Vehicle(physics, world, state, scene, origin);
      vehicle.postStep();
      vehicle.syncVisuals(1);
      vehicles.push(vehicle);
    }
    assertRigState(scene, rig, identities, targets, visibility, 'parked vehicles created');
    check('parked vehicles: no projected light remains on', allZero(identities), identities.map((light) => light.intensity).join(', '));

    const firstDriver = vehicles[0];
    firstDriver.cycleHeadlights();
    firstDriver.syncVisuals(1);
    rig.clear();
    firstDriver.syncProjectedLights(rig);
    assertRigState(scene, rig, identities, targets, visibility, 'first active vehicle sync');
    check(
      'first active vehicle: headlight slots illuminate',
      identities[0].intensity > 0 && identities[1].intensity > 0,
      `${identities[0].intensity}, ${identities[1].intensity}`,
    );

    const secondDriver = vehicles[1];
    secondDriver.syncVisuals(1);
    rig.clear();
    secondDriver.syncProjectedLights(rig);
    assertRigState(scene, rig, identities, targets, visibility, 'active vehicle switch');
    check(
      'active vehicle switch: stale first-car light output clears',
      allZero(identities),
      identities.map((light) => light.intensity).join(', '),
    );

    secondDriver.cycleHeadlights();
    secondDriver.syncVisuals(1);
    rig.clear();
    secondDriver.syncProjectedLights(rig);
    assertRigState(scene, rig, identities, targets, visibility, 'second active vehicle sync');
    check(
      'second active vehicle: reused headlight slots illuminate',
      identities[0].intensity > 0 && identities[1].intensity > 0,
      `${identities[0].intensity}, ${identities[1].intensity}`,
    );

    rig.clear();
    assertRigState(scene, rig, identities, targets, visibility, 'on-foot clear');
    check('on-foot clear: every projected intensity is zero', allZero(identities), identities.map((light) => light.intensity).join(', '));

    while (vehicles.length > 0) vehicles.pop()!.dispose();
    assertRigState(scene, rig, identities, targets, visibility, 'vehicles disposed');
    check('vehicles disposed: every rig slot remains dark', allZero(identities), identities.map((light) => light.intensity).join(', '));

    rig.dispose();
    rigDisposed = true;
    check('rig disposal: no vehicle SpotLights remain', spotlights(scene).length === 0, `${spotlights(scene).length} lights`);
    check(
      'rig disposal: every rig target is removed',
      targets.every((target) => !sceneContains(scene, target)),
      `${targets.filter((target) => sceneContains(scene, target)).length}/${targets.length} targets remain`,
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
