import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

import { hash, hash01, pick } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { ROAD_LENGTH } from './road';
import type { GameWorld } from '../game/state';
import {
  ENGINE_VARIANTS,
  GEARBOX_VARIANTS,
  TANK_VARIANTS,
  WHEEL_VARIANTS,
  variantsOfKind,
  type FuelType,
  type PartInstance,
  type PartKind,
  type PartVariant,
} from '../parts/registry';
import type { FuelCanItem, ToolItem, ToolKind } from '../items/items';
import { makeFlatMaterial } from '../render/materials';
import { carModelMeasure, createStaticCarModel } from '../render/carmodel';
import { CAR_MODELS, type CarModelDef } from '../vehicle/carmodels';
import type { ChunkContext, ChunkContent, ChunkProvider } from './chunks';
import type { LoosePartField } from '../parts/loose';

/**
 * Points of interest: the roadside stops that give the drive a reason to continue.
 *
 * POIs are pure functions of the integer seed. A POI at km 300 is computed from its
 * slot index alone — never by walking the 249 slots before it — so chunk streaming
 * can materialise any stretch of road in any order and a save always restores the
 * exact same stop.
 *
 * Loot is materialised exactly once, keyed by the POI's slot index. `poi_looted`
 * is the idempotency guard: on any later rebuild the generation below is skipped
 * entirely, survivors live in `world.state.looseParts` / `looseItems`, and anything
 * the player already took is simply absent.
 */

/** Metres of arclength between POI slots. */
const POI_SPACING = 1200;
/** Fraction of slots that contain a POI; the rest read as empty desert. */
const POI_OCCUPANCY = 0.55;
/** Domain tag for the POI hash stream, distinct from every other subsystem. */
const POI_DOMAIN = 0x504f4931; // 'POI1'

/** Kind distribution is intentionally front-loaded on the scavenging stops. */
const KIND_WRECK = 0.4;
const KIND_GAS = 0.58;
const KIND_TYRE = 0.76;
const KIND_CAMP = 0.9;

export type PoiKind = 'roadside_wrecks' | 'gas_stop' | 'workshop' | 'tyre_pile' | 'camp';

export interface Poi {
  /** Slot index; equals the POI's identity in `WorldState.lootedPois`. Stable forever. */
  readonly index: number;
  /** Arclength of the stop, metres from the house. */
  readonly s: number;
  /** Signed lateral offset from the centreline; negative is left of travel. */
  readonly lateral: number;
  readonly kind: PoiKind;
  /** Deterministic per-POI variation seed for shape and loot. */
  readonly variantSeed: number;
}

/**
 * POIs whose slot falls in [fromS, toS). `index` is the slot index itself, so it is
 * stable across sessions and directly usable as a `lootedPois` entry. Pure and
 * order-independent: no road or terrain sampling happens here.
 */
export function poisBetween(seed: number, fromS: number, toS: number): Poi[] {
  const result: Poi[] = [];
  const firstIndex = Math.max(1, Math.ceil(fromS / POI_SPACING));
  // `toS - 1e-6` keeps a POI exactly on the upper boundary in the next chunk.
  const lastIndex = Math.floor((toS - 1e-6) / POI_SPACING);

  for (let i = firstIndex; i <= lastIndex; i++) {
    const s = i * POI_SPACING;
    if (s <= 0 || s > ROAD_LENGTH) continue;

    if (hash01(seed, POI_DOMAIN, i) >= POI_OCCUPANCY) continue;

    const kindRoll = hash01(seed, POI_DOMAIN, i, 1);
    let kind: PoiKind;
    if (kindRoll < KIND_WRECK) kind = 'roadside_wrecks';
    else if (kindRoll < KIND_GAS) kind = 'gas_stop';
    else if (kindRoll < KIND_TYRE) kind = 'tyre_pile';
    else if (kindRoll < KIND_CAMP) kind = 'camp';
    else kind = 'workshop';

    const side = hash01(seed, POI_DOMAIN, i, 2) < 0.5 ? -1 : 1;
    const lateral = side * (12 + hash01(seed, POI_DOMAIN, i, 3) * 28);

    result.push({
      index: i,
      s,
      lateral,
      kind,
      variantSeed: hash(seed, POI_DOMAIN, i, 4),
    });
  }
  return result;
}

/** Running sub-index so every generated part/item in a POI gets a distinct id. */
interface LootCounter {
  sub: number;
}

/** Anchor in XZ plus the road heading, before any terrain sampling. */
interface Anchor {
  x: number;
  z: number;
  heading: number;
}

/** Ground position in XZ at a POI's arclength, before terrain sampling. */
function anchorXZ(ctx: ChunkContext, poi: Poi): Anchor {
  const sample = ctx.road.sampleAt(poi.s);
  const p = ctx.road.offsetPoint(poi.s, poi.lateral);
  return { x: p.x, z: p.z, heading: sample.heading };
}

/** Rotate a local (right, forward) offset into a world XZ offset at `yaw`. */
function rotateXZ(lx: number, lz: number, yaw: number): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: c * lx + s * lz, z: -s * lx + c * lz };
}

/** Terrain-grounded placement at a local offset from the anchor. */
function placeAt(
  ctx: ChunkContext,
  poi: Poi,
  anchor: Anchor,
  lx: number,
  lz: number,
  yaw: number,
): { x: number; y: number; z: number } {
  const o = rotateXZ(lx, lz, yaw);
  const x = anchor.x + o.x;
  const z = anchor.z + o.z;
  return { x, y: ctx.terrain.heightAt(x, z, poi.s), z };
}

/** Terrain-grounded position offset along the road instead of in local space. */
function groundPoint(
  ctx: ChunkContext,
  poi: Poi,
  sDelta: number,
  latDelta: number,
): { x: number; y: number; z: number } {
  const s = poi.s + sDelta;
  const p = ctx.road.offsetPoint(s, poi.lateral + latDelta);
  return { x: p.x, y: ctx.terrain.heightAt(p.x, p.z, s), z: p.z };
}

/** Matrix from an upright-ish pose. `yaw` about Y, then `roll`/`pitch` tilts. */
function poseMatrix(
  x: number,
  y: number,
  z: number,
  yaw: number,
  roll: number,
  pitch: number,
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
}

/** Apply a matrix's transform to an Object3D without mutating its geometry. */
function setFromMatrix(obj: THREE.Object3D, matrix: THREE.Matrix4): void {
  obj.position.setFromMatrixPosition(matrix);
  obj.quaternion.setFromRotationMatrix(matrix);
  obj.scale.setFromMatrixScale(matrix);
}

/** Bake a BufferGeometry's triangles through `matrix` into Rapier trimesh data. */
function geometryToTrimesh(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): { vertices: Float32Array; indices: Uint32Array } {
  const pos = geometry.getAttribute('position');
  const vertCount = pos.count;
  const vertices = new Float32Array(vertCount * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < vertCount; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    vertices[i * 3] = v.x;
    vertices[i * 3 + 1] = v.y;
    vertices[i * 3 + 2] = v.z;
  }
  const index = geometry.getIndex();
  let indices: Uint32Array;
  if (index) {
    indices = new Uint32Array(index.count);
    for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);
  } else {
    indices = new Uint32Array(vertCount);
    for (let i = 0; i < vertCount; i++) indices[i] = i;
  }
  return { vertices, indices };
}

/**
 * Static collider for a primitive. The streamer owns cleanup: it walks the returned
 * `bodies` array and calls `physics.removeBody`, which forgets the surface and
 * removes the fixed body plus its collider.
 */
function addStaticCollider(
  ctx: ChunkContext,
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  surface: SurfaceType,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): void {
  if (!ctx.hasPhysics) return;
  const t = geometryToTrimesh(geometry, matrix);
  const collider = ctx.physics.addStaticTrimesh(t.vertices, t.indices, surface);
  colliders.push(collider);
  const parent = collider.parent();
  if (parent) bodies.push(parent);
}

/** Visual mesh + matching static collider, sharing one (unmutated) geometry. */
function addStaticMesh(
  ctx: ChunkContext,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrix: THREE.Matrix4,
  surface: SurfaceType,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): void {
  const mesh = new THREE.Mesh(geometry, material);
  setFromMatrix(mesh, matrix);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  addStaticCollider(ctx, geometry, matrix, surface, bodies, colliders);
}

/** Visual-only mesh (door paint, tools, logs): no collider, nothing to bump into. */
function addVisual(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrix: THREE.Matrix4,
  group: THREE.Group,
): void {
  const mesh = new THREE.Mesh(geometry, material);
  setFromMatrix(mesh, matrix);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/**
 * Condition stats for a generated part. `quality` in [0,1]: 0 is junkyard filth,
 * 1 is workshop-clean. Each stat is uniform in [quality*lo, hi], so a clean part is
 * genuinely clean rather than merely "less bad than the wreck across the road".
 */
function rollCondition(
  variantSeed: number,
  sub: number,
  quality: number,
): { dirt: number; rust: number; wear: number } {
  return {
    dirt: 0.03 * quality + hash01(variantSeed, sub, 31) * (0.03 + 0.9 * (1 - quality)),
    rust: 0.02 * quality + hash01(variantSeed, sub, 32) * (0.02 + 0.82 * (1 - quality)),
    wear: 0.02 * quality + hash01(variantSeed, sub, 33) * (0.02 + 0.75 * (1 - quality)),
  };
}

function makePart(
  world: GameWorld,
  poi: Poi,
  variantId: string,
  quality: number,
  counter: LootCounter,
): PartInstance {
  const sub = counter.sub++;
  const c = rollCondition(poi.variantSeed, sub, quality);
  return {
    id: world.generatedPartId('poi_part', poi.index, sub),
    variantId,
    dirt: c.dirt,
    rust: c.rust,
    wear: c.wear,
  };
}

function makeFuelCan(
  world: GameWorld,
  poi: Poi,
  fuel: FuelType,
  litres: number,
  capacity: number,
  counter: LootCounter,
): FuelCanItem {
  const sub = counter.sub++;
  return { type: 'fuel_can', id: world.generatedPartId('poi_item', poi.index, sub), fuel, capacity, litres };
}

function makeTool(
  world: GameWorld,
  poi: Poi,
  tool: ToolKind,
  counter: LootCounter,
): ToolItem {
  const sub = counter.sub++;
  return {
    type: 'tool',
    id: world.generatedPartId('poi_item', poi.index, sub),
    tool,
    integrity: 0.8 + hash01(poi.variantSeed, sub, 41) * 0.2,
  };
}

const TOOL_KINDS: readonly ToolKind[] = ['brush', 'sponge', 'wrench'];

/** Deterministic weighted pick. Weights are relative; nothing needs to sum to 1. */
function weightedPick<T>(items: readonly T[], weights: readonly number[], ...key: number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let roll = hash01(...key) * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ---------------------------------------------------------------------------
// Kind builders. Each builds its scenery unconditionally and its loot only when
// `shouldLoot` is set, so an emptied POI keeps its structure but never restocks.
// ---------------------------------------------------------------------------

function buildPoi(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  loose: LoosePartField,
): void {
  const counter: LootCounter = { sub: 0 };
  const shouldLoot = ctx.hasPhysics && !ctx.world.state.lootedPois.includes(poi.index);

  switch (poi.kind) {
    case 'roadside_wrecks':
      buildWrecks(ctx, poi, group, bodies, colliders, loose, counter, shouldLoot);
      break;
    case 'gas_stop':
      buildGasStop(ctx, poi, group, bodies, colliders, loose, counter, shouldLoot);
      break;
    case 'workshop':
      buildWorkshop(ctx, poi, group, bodies, colliders, loose, counter, shouldLoot);
      break;
    case 'tyre_pile':
      buildTyrePile(ctx, poi, loose, counter, shouldLoot);
      break;
    case 'camp':
      buildCamp(ctx, poi, group, bodies, colliders, loose, counter, shouldLoot);
      break;
  }

  // Record that this POI's loot is now materialised. The flag alone is the whole
  // idempotency guard across chunk promotion / unload / reload.
  if (shouldLoot) ctx.world.apply({ t: 'poi_looted', poiIndex: poi.index });
}

/** One to three derelict complete models, half-sunk and scattered, each shedding a
 *  handful of gizmos. */
function buildWrecks(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  loose: LoosePartField,
  counter: LootCounter,
  shouldLoot: boolean,
): void {
  const anchor = anchorXZ(ctx, poi);
  const count = 1 + Math.floor(hash01(poi.variantSeed, 10) * 3); // 1..3 bodies

  for (let w = 0; w < count; w++) {
    const def: CarModelDef = pick(CAR_MODELS, poi.variantSeed, w, 10);
    const half = carModelMeasure(def.id).halfExtents;

    // Scatter around the anchor, half-sunk, some facing the wrong way.
    const sDelta = (hash01(poi.variantSeed, w, 11) - 0.5) * 16;
    const latDelta = (hash01(poi.variantSeed, w, 12) - 0.5) * 12;
    const p = groundPoint(ctx, poi, sDelta, latDelta);

    const yawRoll = hash01(poi.variantSeed, w, 13);
    let yaw = anchor.heading + (hash01(poi.variantSeed, w, 14) - 0.5) * 0.6;
    if (yawRoll < 0.32) yaw += Math.PI; // wrong way round
    else if (yawRoll > 0.82) yaw += (hash01(poi.variantSeed, w, 15) < 0.5 ? 1 : -1) * Math.PI * 0.5;

    const sink = 0.25 + hash01(poi.variantSeed, w, 16) * half[1] * 0.5;
    const roll = (hash01(poi.variantSeed, w, 17) - 0.5) * 0.3;
    const pitch = (hash01(poi.variantSeed, w, 18) - 0.5) * 0.22;

    const originY = p.y + half[1] - sink;
    const matrix = poseMatrix(p.x, originY, p.z, yaw, roll, pitch);

    // A complete static model. It must already be preloaded — the lead preloads the
    // whole catalogue before any chunk is built, so no guard is needed here.
    const shell = createStaticCarModel(def.id);
    setFromMatrix(shell, matrix);
    group.add(shell);

    // A box approximates the shell well enough for a solid, non-drivable obstacle.
    addStaticCollider(
      ctx,
      new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
      matrix,
      SurfaceType.Rock,
      bodies,
      colliders,
    );

    if (shouldLoot) spawnWreckGizmos(ctx, poi, loose, def, matrix, w, counter);
  }
}

/** Gizmo kinds a wreck can shed. Cosmetic junk, filtered by the wreck's own body
 *  class below so nothing spawns that could not have come off it. */
const WRECK_GIZMO_KINDS: readonly PartKind[] = [
  'door', 'hood', 'trunk', 'mirror', 'bumper', 'headlight',
  'dashboard', 'seat', 'exhaust', 'battery', 'radiator', 'wheel',
];

/**
 * Gizmos shed by a derelict wreck. There is no slot map anymore — the model is
 * complete — so instead of walking slots this makes a fixed, deterministic number
 * of rolls and leaves roughly half empty, then drops each picked gizmo just clear
 * of the shell and above the ground so it settles instead of jittering inside.
 */
function spawnWreckGizmos(
  ctx: ChunkContext,
  poi: Poi,
  loose: LoosePartField,
  def: CarModelDef,
  matrix: THREE.Matrix4,
  w: number,
  counter: LootCounter,
): void {
  const rolls = 3 + Math.floor(hash01(poi.variantSeed, w, 60) * 6); // 3..8 rolls
  for (let i = 0; i < rolls; i++) {
    if (hash01(poi.variantSeed, w, 61, i) > 0.5) continue;
    const kind = pick(WRECK_GIZMO_KINDS, poi.variantSeed, w, 62, i);
    const options = variantsOfKind(kind, def.bodyClass);
    if (options.length === 0) continue;
    const v = pick(options, poi.variantSeed, w, 63, i);
    const part = makePart(ctx.world, poi, v.id, 0, counter);
    // Scatter around the wreck's footprint, just clear of the shell.
    const dx = (hash01(poi.variantSeed, w, 64, i) - 0.5) * 4;
    const dz = (hash01(poi.variantSeed, w, 65, i) - 0.5) * 4;
    const wp = new THREE.Vector3(dx, 0.25, dz).applyMatrix4(matrix);
    loose.spawn(part, wp.x, wp.y + 0.12, wp.z);
  }
}
function buildGasStop(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  loose: LoosePartField,
  counter: LootCounter,
  shouldLoot: boolean,
): void {
  const a = anchorXZ(ctx, poi);
  const yaw = a.heading;

  // Canopy roof, spanning the road direction so it reads as a forecourt.
  const roof = placeAt(ctx, poi, a, 0, 0, yaw);
  addStaticMesh(
    ctx,
    new THREE.BoxGeometry(9.6, 0.4, 6.2),
    makeFlatMaterial(0x8fa0ad, 0.8),
    poseMatrix(roof.x, roof.y + 3.6, roof.z, yaw, 0, 0),
    SurfaceType.Concrete,
    group,
    bodies,
    colliders,
  );

  for (const [lx, lz] of [
    [-4.4, -2.9],
    [4.4, -2.9],
    [-4.4, 2.9],
    [4.4, 2.9],
  ] as const) {
    const post = placeAt(ctx, poi, a, lx, lz, yaw);
    addStaticMesh(
      ctx,
      new THREE.BoxGeometry(0.36, 3.6, 0.36),
      makeFlatMaterial(0x70757a, 0.85),
      poseMatrix(post.x, post.y + 1.8, post.z, yaw, 0, 0),
      SurfaceType.Concrete,
      group,
      bodies,
      colliders,
    );
  }

  // Two pumps, one petrol (red) and one diesel (green).
  for (let i = 0; i < 2; i++) {
    const lx = i === 0 ? -1.6 : 1.6;
    const pump = placeAt(ctx, poi, a, lx, 0.2, yaw);
    addStaticMesh(
      ctx,
      new THREE.BoxGeometry(0.9, 1.5, 0.55),
      makeFlatMaterial(i === 0 ? 0xc23b2e : 0x2f6f3f, 0.6),
      poseMatrix(pump.x, pump.y + 0.75, pump.z, yaw, 0, 0),
      SurfaceType.Concrete,
      group,
      bodies,
      colliders,
    );
    const face = placeAt(ctx, poi, a, lx, 0.55, yaw);
    addStaticMesh(
      ctx,
      new THREE.BoxGeometry(0.6, 0.35, 0.1),
      makeFlatMaterial(0x22252a, 0.5),
      poseMatrix(face.x, face.y + 1.25, face.z, yaw, 0, 0),
      SurfaceType.Concrete,
      group,
      bodies,
      colliders,
    );
  }

  // Small attendant shack off to one side.
  const shack = placeAt(ctx, poi, a, 3.4, -2.0, yaw);
  addStaticMesh(
    ctx,
    new THREE.BoxGeometry(2.6, 2.2, 2.0),
    makeFlatMaterial(0x9a8f86, 0.9),
    poseMatrix(shack.x, shack.y + 1.1, shack.z, yaw + 0.12, 0, 0),
    SurfaceType.Concrete,
    group,
    bodies,
    colliders,
  );
  addStaticMesh(
    ctx,
    new THREE.BoxGeometry(3.0, 0.18, 2.4),
    makeFlatMaterial(0x7d4a35, 0.85),
    poseMatrix(shack.x, shack.y + 2.35, shack.z, yaw + 0.12, 0, 0),
    SurfaceType.Concrete,
    group,
    bodies,
    colliders,
  );

  if (shouldLoot) {
    // Fuel is the whole point of a gas stop: a handful of petrol/diesel cans.
    const n = 2 + Math.floor(hash01(poi.variantSeed, 30) * 4); // 2..5
    for (let i = 0; i < n; i++) {
      const fuel: FuelType = hash01(poi.variantSeed, 31, i) < 0.6 ? 'petrol' : 'diesel';
      const litres = 12 + Math.floor(hash01(poi.variantSeed, 32, i) * 9); // 12..20 L
      const can = makeFuelCan(ctx.world, poi, fuel, litres, 20, counter);
      const c = placeAt(
        ctx,
        poi,
        a,
        (hash01(poi.variantSeed, 33, i) - 0.5) * 4,
        (hash01(poi.variantSeed, 34, i) - 0.5) * 3 - 0.4,
        yaw,
      );
      loose.spawnItem(can, c.x, c.y + 0.2, c.z);
    }
  }
}

function buildWorkshop(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  loose: LoosePartField,
  counter: LootCounter,
  shouldLoot: boolean,
): void {
  const a = anchorXZ(ctx, poi);
  const yaw = a.heading + (hash01(poi.variantSeed, 40) - 0.5) * 0.3;

  // Corrugated shed: body + overhanging roof.
  const shed = placeAt(ctx, poi, a, 0, 0, yaw);
  addStaticMesh(
    ctx,
    new THREE.BoxGeometry(4.6, 2.6, 3.4),
    makeFlatMaterial(0x8a8f94, 0.85),
    poseMatrix(shed.x, shed.y + 1.3, shed.z, yaw, 0, 0),
    SurfaceType.Concrete,
    group,
    bodies,
    colliders,
  );
  addStaticMesh(
    ctx,
    new THREE.BoxGeometry(5.2, 0.2, 4.0),
    makeFlatMaterial(0x9a4a35, 0.9),
    poseMatrix(shed.x, shed.y + 2.75, shed.z, yaw, 0, 0),
    SurfaceType.Concrete,
    group,
    bodies,
    colliders,
  );
  // Painted door opening on the near wall (visual only).
  const door = placeAt(ctx, poi, a, 0, -1.75, yaw);
  addVisual(
    new THREE.BoxGeometry(1.1, 2.0, 0.12),
    makeFlatMaterial(0x2a2a2a, 0.95),
    poseMatrix(door.x, door.y + 1.0, door.z, yaw, 0, 0),
    group,
  );

  // Workbench: top + four legs.
  const bench = placeAt(ctx, poi, a, 1.6, -0.4, yaw);
  addStaticMesh(
    ctx,
    new THREE.BoxGeometry(2.2, 0.12, 0.8),
    makeFlatMaterial(0x7a5230, 0.85),
    poseMatrix(bench.x, bench.y + 0.85, bench.z, yaw, 0, 0),
    SurfaceType.Concrete,
    group,
    bodies,
    colliders,
  );
  for (const [llx, llz] of [
    [-1.0, -0.3],
    [1.0, -0.3],
    [-1.0, 0.3],
    [1.0, 0.3],
  ] as const) {
    const leg = placeAt(ctx, poi, a, 1.6 + llx, -0.4 + llz, yaw);
    addStaticMesh(
      ctx,
      new THREE.BoxGeometry(0.12, 0.85, 0.12),
      makeFlatMaterial(0x5d4326, 0.9),
      poseMatrix(leg.x, leg.y + 0.42, leg.z, yaw, 0, 0),
      SurfaceType.Concrete,
      group,
      bodies,
      colliders,
    );
  }
  // Two tool silhouettes on the bench (visual only).
  for (let i = 0; i < 2; i++) {
    const t = placeAt(ctx, poi, a, 1.4 + i * 0.5, -0.4, yaw);
    addVisual(
      new THREE.BoxGeometry(0.5, 0.06, 0.06),
      makeFlatMaterial(0x3b3b3b, 0.6),
      poseMatrix(t.x, t.y + 0.93, t.z, yaw, 0, hash01(poi.variantSeed, 45, i) * 0.4),
      group,
    );
  }

  if (shouldLoot) {
    // Best-condition parts in the game: engines and wheels weighted towards the good
    // units, everything spawned near-factory fresh.
    const engine = weightedPick(ENGINE_VARIANTS, [1, 2.5, 4, 2, 4], poi.variantSeed, 50);
    const gearbox = weightedPick(GEARBOX_VARIANTS, [1, 2.5, 1, 2.5], poi.variantSeed, 51);
    const wheel1 = weightedPick(WHEEL_VARIANTS, [0.5, 2.5, 4, 0, 0], poi.variantSeed, 52);
    const wheel2 = weightedPick(WHEEL_VARIANTS, [0.5, 2.5, 4, 0, 0], poi.variantSeed, 53);
    const tank = pick(TANK_VARIANTS, poi.variantSeed, 54);
    const seat = pick(variantsOfKind('seat'), poi.variantSeed, 55);
    const battery = pick(variantsOfKind('battery'), poi.variantSeed, 56);
    const radiator = pick(variantsOfKind('radiator'), poi.variantSeed, 57);

    const parts: Array<[PartVariant, number]> = [
      [engine, 0.98],
      [gearbox, 0.95],
      [wheel1, 0.9],
      [wheel2, 0.9],
      [tank, 0.9],
      [seat, 0.9],
      [battery, 0.9],
      [radiator, 0.92],
    ];
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      const part = makePart(ctx.world, poi, entry[0].id, entry[1], counter);
      const p = placeAt(
        ctx,
        poi,
        a,
        (hash01(poi.variantSeed, 60, i) - 0.5) * 5,
        (hash01(poi.variantSeed, 61, i) - 0.5) * 4,
        yaw,
      );
      loose.spawn(part, p.x, p.y + 0.35, p.z);
    }

    const toolCount = 1 + Math.floor(hash01(poi.variantSeed, 62) * 2); // 1..2
    for (let i = 0; i < toolCount; i++) {
      const tool = pick(TOOL_KINDS, poi.variantSeed, 63, i);
      const item = makeTool(ctx.world, poi, tool, counter);
      const p = placeAt(ctx, poi, a, 1.6, -0.4, yaw);
      loose.spawnItem(item, p.x, p.y + 1.0, p.z);
    }
  }
}

/**
 * A heap of tyres is nothing but loot: no scenery, just a cluster of loose wheels
 * that fall into a natural pile. When looted, nothing remains — correct, because the
 * pile *is* the loot.
 */
function buildTyrePile(
  ctx: ChunkContext,
  poi: Poi,
  loose: LoosePartField,
  counter: LootCounter,
  shouldLoot: boolean,
): void {
  if (!shouldLoot) return;
  const a = anchorXZ(ctx, poi);
  const n = 12 + Math.floor(hash01(poi.variantSeed, 70) * 5); // 12..16 wheels
  for (let i = 0; i < n; i++) {
    // Heavily weighted towards the bald, worn-out tyre: cheap, plentiful, bad.
    const v = weightedPick(WHEEL_VARIANTS, [0.8, 1.5, 0.4, 8, 0], poi.variantSeed, 71, i);
    const part = makePart(ctx.world, poi, v.id, 0.05, counter);
    const r = Math.sqrt(hash01(poi.variantSeed, 72, i)) * 2.2;
    const ang = hash01(poi.variantSeed, 73, i) * Math.PI * 2;
    const stack = hash01(poi.variantSeed, 74, i) * 0.8;
    const p = placeAt(ctx, poi, a, Math.cos(ang) * r, Math.sin(ang) * r, 0);
    loose.spawn(part, p.x, p.y + 0.3 + stack, p.z);
  }
}

function buildCamp(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  loose: LoosePartField,
  counter: LootCounter,
  shouldLoot: boolean,
): void {
  const a = anchorXZ(ctx, poi);
  const yaw = a.heading + (hash01(poi.variantSeed, 80) - 0.5) * 0.5;

  // Teepee tent (visual only — cloth).
  const tent = placeAt(ctx, poi, a, -1.8, 0.5, yaw);
  addVisual(
    new THREE.ConeGeometry(2.1, 2.2, 6),
    makeFlatMaterial(0xc9b98a, 0.95),
    poseMatrix(tent.x, tent.y + 1.1, tent.z, 0, 0, 0),
    group,
  );

  // Fire ring: flat stone torus plus two logs (visual only).
  const fire = placeAt(ctx, poi, a, 1.4, -0.4, yaw);
  addVisual(
    new THREE.TorusGeometry(0.8, 0.16, 6, 18),
    makeFlatMaterial(0x3a3a3a, 0.9),
    poseMatrix(fire.x, fire.y + 0.12, fire.z, 0, 0, Math.PI / 2),
    group,
  );
  for (let i = 0; i < 2; i++) {
    addVisual(
      new THREE.CylinderGeometry(0.08, 0.08, 0.9, 5),
      makeFlatMaterial(0x2a2018, 0.95),
      poseMatrix(fire.x, fire.y + 0.1, fire.z, 0, 0, hash01(poi.variantSeed, 81, i) * Math.PI),
      group,
    );
  }

  // Crates.
  for (let i = 0; i < 3; i++) {
    const c = placeAt(
      ctx,
      poi,
      a,
      (hash01(poi.variantSeed, 84, i) - 0.5) * 4,
      (hash01(poi.variantSeed, 85, i) - 0.5) * 4,
      yaw,
    );
    addStaticMesh(
      ctx,
      new THREE.BoxGeometry(0.7, 0.7, 0.7),
      makeFlatMaterial(0x8a6238, 0.9),
      poseMatrix(c.x, c.y + 0.35, c.z, hash01(poi.variantSeed, 86, i) * Math.PI, 0, 0),
      SurfaceType.Concrete,
      group,
      bodies,
      colliders,
    );
  }

  if (shouldLoot) {
    // Small mixed loot; occasionally something genuinely good.
    const smallVariants: PartVariant[] = [
      pick(variantsOfKind('battery'), poi.variantSeed, 91),
      pick(variantsOfKind('radiator'), poi.variantSeed, 92),
      pick(variantsOfKind('mirror'), poi.variantSeed, 93),
      pick(variantsOfKind('headlight'), poi.variantSeed, 94),
      pick(variantsOfKind('seat'), poi.variantSeed, 95),
    ];
    const loot: Array<[PartVariant, number]> = [];
    for (let i = 0; i < smallVariants.length; i++) {
      if (hash01(poi.variantSeed, 96, i) < 0.6) loot.push([smallVariants[i], 0.15]);
    }
    if (hash01(poi.variantSeed, 90) < 0.3) {
      loot.push([weightedPick(ENGINE_VARIANTS, [1, 2, 3, 2, 2], poi.variantSeed, 97), 0.75]);
    }

    for (let i = 0; i < loot.length; i++) {
      const entry = loot[i];
      const part = makePart(ctx.world, poi, entry[0].id, entry[1], counter);
      const p = placeAt(
        ctx,
        poi,
        a,
        (hash01(poi.variantSeed, 101, i) - 0.5) * 5,
        (hash01(poi.variantSeed, 102, i) - 0.5) * 5,
        yaw,
      );
      loose.spawn(part, p.x, p.y + 0.3, p.z);
    }

    const tool = pick(TOOL_KINDS, poi.variantSeed, 98);
    const item = makeTool(ctx.world, poi, tool, counter);
    const tp = placeAt(
      ctx,
      poi,
      a,
      (hash01(poi.variantSeed, 99) - 0.5) * 3,
      (hash01(poi.variantSeed, 100) - 0.5) * 3,
      yaw,
    );
    loose.spawnItem(item, tp.x, tp.y + 0.25, tp.z);
  }
}

/**
 * Builds every POI inside a chunk. Scenery is always built; loot is generated once
 * per POI (guarded by `lootedPois`) and its dynamic bodies are owned by
 * `LoosePartField`, not by the chunk — so chunk unload never tears loot down.
 */
export class PoiProvider implements ChunkProvider {
  readonly id = 'poi';

  constructor(private readonly loose: LoosePartField) {}

  build(ctx: ChunkContext): ChunkContent | null {
    const pois = poisBetween(ctx.world.seed, ctx.sStart, ctx.sEnd);
    if (pois.length === 0) return null;

    const group = new THREE.Group();
    group.name = 'poi';
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];

    for (const poi of pois) {
      buildPoi(ctx, poi, group, bodies, colliders, this.loose);
    }

    return { group, bodies, colliders };
  }
}
