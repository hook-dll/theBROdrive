/**
 * Deterministic active-runtime lifecycle harness.
 *
 * Run with `bun tools/runtime-lifecycle.ts`. It uses the same Rapier world,
 * floating origin, state, loose-part field, trailer field, and vehicle model
 * path as the game; only the static asset host is local to Bun so Three's
 * browser-oriented loaders can fetch the shipped GLBs.
 */

import * as THREE from 'three';
import { PhysicsWorld } from '../src/core/physics';
import { GameWorld, newWorldState, type CarState, type TrailerState } from '../src/game/state';
import { type Item } from '../src/items/items';
import { LoosePartField } from '../src/parts/loose';
import { preloadCarModels } from '../src/render/carmodel';
import { preloadTrailerModel } from '../src/render/trailermodel';
import { TRAILER_MODEL_FIT, TrailerField } from '../src/vehicle/trailer';
import { Vehicle } from '../src/vehicle/vehicle';
import { WorldOrigin, type RebaseShift } from '../src/world/origin';

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

const SEED = 0x5eed;
const LOAD_RADIUS = 800;
const UNLOAD_RADIUS = 1000;
const NEAR_CENTER = { x: 0, z: 0 };
const HYSTERESIS_CENTER = { x: 1000, z: 0 };
const FAR_CENTER = { x: 3000, z: 0 };
const TOW_CAR_ID = 'lifecycle:tow';
const TOW_MODEL_ID = 'proc_wedge';

let failures = 0;

function check(label: string, condition: boolean, detail: string): void {
  if (!condition) failures++;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label.padEnd(42)} ${detail}`);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function samePosition(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
): boolean {
  return (
    Math.abs(actual.x - expected.x) < 1e-6 &&
    Math.abs(actual.y - expected.y) < 1e-6 &&
    Math.abs(actual.z - expected.z) < 1e-6
  );
}

function carState(): CarState {
  return {
    id: TOW_CAR_ID,
    modelId: TOW_MODEL_ID,
    gizmos: {},
    stickers: [],
    fuelLitres: 40,
    dirt: 0,
    scratches: 0,
    coolantLitres: 10,
    oilLitres: 10,
    storage: [],
    odometer: 0,
    x: FAR_CENTER.x,
    y: 2,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  };
}

/**
 * Three loaders issue root-relative browser requests. Keep their real loading path
 * intact by serving public/ from this Bun process, then restore the global request
 * constructor before the physics harness starts. `stop(true)` guarantees no server
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
    await Promise.all([preloadTrailerModel(TRAILER_MODEL_FIT), preloadCarModels([TOW_MODEL_ID])]);
  } finally {
    globalThis.Request = NativeRequest;
    server.stop(true);
  }
}

function part(id: string) {
  return { id, variantId: 'wheel_steel_13', dirt: 0.2, rust: 0.1 };
}

function tool(id: string): Item {
  return { type: 'tool', id, tool: 'wrench', integrity: 0.85 };
}

function trailer(id: string, x: number, y: number, z: number): TrailerState {
  return { id, hitchedTo: null, cargoKg: 0, x, y, z, qx: 0, qy: 0, qz: 0, qw: 1 };
}

function colliderForPart(physics: PhysicsWorld, loose: LoosePartField, id: string): number | null {
  let found: number | null = null;
  physics.world.colliders.forEach((collider) => {
    if (loose.partIdForCollider(collider.handle) === id) found = collider.handle;
  });
  return found;
}

function colliderForItem(physics: PhysicsWorld, loose: LoosePartField, id: string): number | null {
  let found: number | null = null;
  physics.world.colliders.forEach((collider) => {
    if (loose.itemIdForCollider(collider.handle) === id) found = collider.handle;
  });
  return found;
}

await preloadModels().catch((error: unknown) => {
  check('production model preload', false, errorDetail(error));
});

if (failures === 0) {
  const physics = await PhysicsWorld.create();
  const world = new GameWorld(newWorldState(SEED));
  const scene = new THREE.Scene();
  const origin = new WorldOrigin();
  const loose = new LoosePartField(physics, world, scene, origin);
  const trailers = new TrailerField(physics, world, scene, origin);
  const activeVehicles = new Map<string, Vehicle>();
  const vehiclePosition = new THREE.Vector3();
  let tow: Vehicle | null = null;

  const reconcileVehicles = (center: { x: number; z: number }): void => {
    const towingCarIds = new Set<string>();
    for (const state of Object.values(world.state.trailers)) {
      if (state.hitchedTo !== null) towingCarIds.add(state.hitchedTo);
    }
    for (const [id, state] of Object.entries(world.state.cars)) {
      const vehicle = activeVehicles.get(id) ?? null;
      const isTowingCar = towingCarIds.has(id);
      if (vehicle) {
        if (isTowingCar) continue;
        vehicle.absoluteTranslation(vehiclePosition);
        const dx = vehiclePosition.x - center.x;
        const dz = vehiclePosition.z - center.z;
        if (dx * dx + dz * dz > UNLOAD_RADIUS * UNLOAD_RADIUS) {
          vehicle.pushState();
          vehicle.dispose();
          activeVehicles.delete(id);
        }
      } else {
        const dx = state.x - center.x;
        const dz = state.z - center.z;
        if (isTowingCar || dx * dx + dz * dz <= LOAD_RADIUS * LOAD_RADIUS) {
          activeVehicles.set(id, new Vehicle(physics, world, state, scene, origin));
        }
      }
    }
  };

  const nearPart = { id: 'lifecycle:near:part', x: 100, y: 2, z: 0 };
  const nearItem = { id: 'lifecycle:near:item', x: 160, y: 2, z: 20 };
  const farPart = { id: 'lifecycle:far:part', x: 3100, y: 2, z: 0 };
  const farItem = { id: 'lifecycle:far:item', x: 3160, y: 2, z: 20 };
  const nearTrailers = [
    trailer('lifecycle:near:trailer:a', 100, 2, 100),
    trailer('lifecycle:near:trailer:b', 180, 2, -80),
  ];
  const farTrailers = [
    trailer('lifecycle:far:trailer:a', 3100, 2, 100),
    trailer('lifecycle:far:trailer:b', 3180, 2, -80),
  ];
  const expectedLooseIds = [nearPart.id, nearItem.id, farPart.id, farItem.id].sort();
  const expectedTrailerIds = [...nearTrailers, ...farTrailers].map(({ id }) => id).sort();
  const expectedPositions = new Map<string, { x: number; y: number; z: number }>([
    [nearPart.id, nearPart],
    [nearItem.id, nearItem],
    [farPart.id, farPart],
    [farItem.id, farItem],
    ...[...nearTrailers, ...farTrailers].map(({ id, x, y, z }) => [id, { x, y, z }] as const),
  ]);

  const assertAuthoritativeState = (phase: string): void => {
    check(
      `${phase}: loose ids preserved`,
      [...Object.keys(world.state.looseParts), ...Object.keys(world.state.looseItems)].sort().join('|') ===
        expectedLooseIds.join('|'),
      expectedLooseIds.join(', '),
    );
    check(
      `${phase}: trailer ids preserved`,
      Object.keys(world.state.trailers).sort().join('|') === expectedTrailerIds.join('|'),
      expectedTrailerIds.join(', '),
    );
    for (const [id, expected] of expectedPositions) {
      const state =
        world.state.looseParts[id] ?? world.state.looseItems[id] ?? world.state.trailers[id];
      check(`${phase}: absolute pose ${id}`, state !== undefined && samePosition(state, expected), `${expected.x}, ${expected.y}, ${expected.z}`);
    }
  };

  const updateAt = (phase: string, center: { x: number; z: number }, expectedLoose: number, expectedTrailers: number): void => {
    reconcileVehicles(center);
    loose.updateActive(center.x, center.z, LOAD_RADIUS, UNLOAD_RADIUS);
    trailers.updateActive(
      center.x,
      center.z,
      (id) => activeVehicles.get(id) ?? null,
      LOAD_RADIUS,
      UNLOAD_RADIUS,
    );
    check(`${phase}: loose live count`, loose.liveCount === expectedLoose, `${loose.liveCount}`);
    check(`${phase}: trailer live count`, trailers.liveCount === expectedTrailers, `${trailers.liveCount}`);
    const bodyCount = physics.world.bodies.len();
    check(
      `${phase}: runtime body bound`,
      bodyCount === expectedLoose + expectedTrailers,
      `${bodyCount} bodies for ${expectedLoose + expectedTrailers} active runtimes`,
    );
    assertAuthoritativeState(phase);
  };

  try {
    // Seed state directly: none of these derived runtimes should exist until the
    // active field reconciles them around its first center.
    world.apply({ t: 'part_drop', part: part(nearPart.id), x: nearPart.x, y: nearPart.y, z: nearPart.z });
    world.apply({ t: 'item_drop', item: tool(nearItem.id), x: nearItem.x, y: nearItem.y, z: nearItem.z });
    world.apply({ t: 'part_drop', part: part(farPart.id), x: farPart.x, y: farPart.y, z: farPart.z });
    world.apply({ t: 'item_drop', item: tool(farItem.id), x: farItem.x, y: farItem.y, z: farItem.z });
    for (const state of [...nearTrailers, ...farTrailers]) world.apply({ t: 'trailer_add', trailer: state });

    check('dormant authoritative loose state', loose.liveCount === 0, `${loose.liveCount} runtimes`);
    check('dormant authoritative trailer state', trailers.liveCount === 0, `${trailers.liveCount} runtimes`);
    check('dormant runtime body count', physics.world.bodies.len() === 0, `${physics.world.bodies.len()} bodies`);

    updateAt('near materialisation', NEAR_CENTER, 2, 2);
    const nearPartCollider = colliderForPart(physics, loose, nearPart.id);
    const nearItemCollider = colliderForItem(physics, loose, nearItem.id);
    const nearTrailerRuntime = trailers.get(nearTrailers[0]!.id);
    const nearTrailerCollider = nearTrailerRuntime?.rigidBody.collider(0).handle ?? null;
    check('near part collider lookup', nearPartCollider !== null && loose.partIdForCollider(nearPartCollider) === nearPart.id, `${nearPartCollider}`);
    check('near item collider lookup', nearItemCollider !== null && loose.itemIdForCollider(nearItemCollider) === nearItem.id, `${nearItemCollider}`);
    check(
      'near trailer collider lookup',
      nearTrailerCollider !== null && trailers.trailerIdForCollider(nearTrailerCollider) === nearTrailers[0]!.id,
      `${nearTrailerCollider}`,
    );

    // 900 m from the first near part is outside the load radius but inside the
    // unload radius: the existing runtime must remain live rather than churn.
    updateAt('hysteresis retention', HYSTERESIS_CENTER, 2, 2);
    check('hysteresis point outside load radius', Math.hypot(nearPart.x - HYSTERESIS_CENTER.x, nearPart.z) > LOAD_RADIUS, '900 m');

    updateAt('far replacement', FAR_CENTER, 2, 2);
    check('dematerialised part lookup removed', nearPartCollider !== null && loose.partIdForCollider(nearPartCollider) === null, `${nearPartCollider}`);
    check('dematerialised item lookup removed', nearItemCollider !== null && loose.itemIdForCollider(nearItemCollider) === null, `${nearItemCollider}`);
    check(
      'dematerialised trailer lookup removed',
      nearTrailerCollider !== null && trailers.trailerIdForCollider(nearTrailerCollider) === null,
      `${nearTrailerCollider}`,
    );

    updateAt('near rematerialisation', NEAR_CENTER, 2, 2);
    const rematerialisedPartCollider = colliderForPart(physics, loose, nearPart.id);
    const rematerialisedItemCollider = colliderForItem(physics, loose, nearItem.id);
    const rematerialisedTrailer = trailers.get(nearTrailers[0]!.id);
    const rematerialisedTrailerCollider = rematerialisedTrailer?.rigidBody.collider(0).handle ?? null;
    check(
      'rematerialised part lookup',
      rematerialisedPartCollider !== null && loose.partIdForCollider(rematerialisedPartCollider) === nearPart.id,
      `${rematerialisedPartCollider}`,
    );
    check(
      'rematerialised item lookup',
      rematerialisedItemCollider !== null && loose.itemIdForCollider(rematerialisedItemCollider) === nearItem.id,
      `${rematerialisedItemCollider}`,
    );
    check(
      'rematerialised trailer is coupling-ready',
      rematerialisedTrailer !== null && !rematerialisedTrailer.coupled &&
        rematerialisedTrailerCollider !== null &&
        trailers.trailerIdForCollider(rematerialisedTrailerCollider) === nearTrailers[0]!.id,
      `${rematerialisedTrailer?.id ?? 'missing'}`,
    );
    // A live standing trailer follows its current physics pose for hysteresis. It
    // crosses the load boundary but remains the same runtime because it is still
    // inside the unload radius; stale saved coordinates must not trigger churn.
    const movedStandingTrailer = trailers.get(nearTrailers[1]!.id);
    movedStandingTrailer?.rigidBody.setTranslation({ x: 900, y: 2, z: -80 }, true);
    updateAt('live standing body hysteresis', NEAR_CENTER, 2, 2);
    check(
      'standing body crosses load boundary without churn',
      movedStandingTrailer !== null && trailers.get(nearTrailers[1]!.id) === movedStandingTrailer,
      `${movedStandingTrailer?.id ?? 'missing'}`,
    );

    // Repeating the same reconciliation must not create a second body or visual.
    updateAt('idempotent near reconciliation', NEAR_CENTER, 2, 2);

    // A real, preloaded catalogue vehicle proves the exceptional retention path:
    // a hitched trailer remains materialised even when both bodies are far from the
    // active center, and TrailerField restores the real Rapier coupling.
    const towState = carState();
    world.apply({ t: 'car_add', car: towState });
    const hitchedState = trailer('lifecycle:hitched', FAR_CENTER.x, 2, 0);
    hitchedState.hitchedTo = TOW_CAR_ID;
    world.apply({ t: 'trailer_add', trailer: hitchedState });
    // Authoritative coupling forces the far towing body into the active set before
    // TrailerField resolves the joint.
    reconcileVehicles(NEAR_CENTER);
    trailers.updateActive(
      NEAR_CENTER.x,
      NEAR_CENTER.z,
      (id) => activeVehicles.get(id) ?? null,
      LOAD_RADIUS,
      UNLOAD_RADIUS,
    );
    tow = activeVehicles.get(TOW_CAR_ID) ?? null;
    const hitchedRuntime = trailers.get(hitchedState.id);
    check('far towing car retained', tow !== null, `${activeVehicles.size} live cars`);
    check('far hitched trailer retained', hitchedRuntime !== null, `${trailers.liveCount} live trailers`);
    check('far hitched trailer coupled', hitchedRuntime?.coupled === true, `${hitchedRuntime?.coupled ?? false}`);
    check('far hitched trailer keeps state id', hitchedRuntime?.id === hitchedState.id, hitchedRuntime?.id ?? 'missing');
    check(
      'hitched runtime body bound',
      physics.world.bodies.len() === loose.liveCount + trailers.liveCount + 1,
      `${physics.world.bodies.len()} bodies`,
    );

    // Unhitching is authoritative: both the joint and the now-unneeded far towing
    // body can leave on the next reconciliation.
    world.apply({ t: 'trailer_hitch', trailerId: hitchedState.id, carId: null });
    reconcileVehicles(NEAR_CENTER);
    trailers.updateActive(
      NEAR_CENTER.x,
      NEAR_CENTER.z,
      (id) => activeVehicles.get(id) ?? null,
      LOAD_RADIUS,
      UNLOAD_RADIUS,
    );
    tow = null;
    check('unhitched far towing car unloads', !activeVehicles.has(TOW_CAR_ID), `${activeVehicles.size} live cars`);
    check('unhitched far trailer unloads', trailers.get(hitchedState.id) === null, `${trailers.liveCount} live trailers`);
    check('unhitched trailer joint removed', hitchedRuntime?.coupled === false, `${hitchedRuntime?.coupled ?? false}`);
    check(
      'unhitched runtime body bound',
      physics.world.bodies.len() === loose.liveCount + trailers.liveCount,
      `${physics.world.bodies.len()} bodies`,
    );

    trailers.dispose();
    trailers.dispose();
    loose.dispose();
    loose.dispose();
    tow?.dispose();
    tow = null;
    check('dispose releases all runtime bodies', physics.world.bodies.len() === 0, `${physics.world.bodies.len()} bodies`);

    let disposedListenerCalls = 0;
    const unregister = origin.register({
      rebase(_shift: RebaseShift): void {
        disposedListenerCalls++;
      },
    });
    unregister();
    unregister();
    origin.advance(2000, 0);
    check('origin disposer is idempotent', disposedListenerCalls === 0, `${disposedListenerCalls} callbacks`);
  } catch (error) {
    check('harness execution', false, errorDetail(error));
  } finally {
    trailers.dispose();
    loose.dispose();
    tow?.dispose();
    physics.world.free();
  }
}

console.log(failures === 0 ? 'all lifecycle checks passed' : `${failures} LIFECYCLE CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
