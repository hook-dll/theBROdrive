import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { hash, hash01, pick } from '../core/rng';
import { DEFAULT_POI_SPACING_METRES } from '../game/settings';
import { SurfaceType } from '../core/surfaces';
import { ROAD_LENGTH } from './road';
import type { CarState, GameWorld } from '../game/state';
import { coolantCapacity, oilCapacity, variant, type FuelType } from '../parts/registry';
import type { FluidCanItem, FluidKind, ToolItem, ToolKind } from '../items/items';
import { makeFlatMaterial } from '../render/materials';
import {
  carModelMeasure,
  carSpawnYAboveGround,
  createStaticCarModel,
} from '../render/carmodel';
import {
  SPAWNABLE_CAR_MODELS,
  WRECK_ONLY_CAR_MODELS,
  type CarModelDef,
} from '../vehicle/carmodels';
import type { ChunkContext, ChunkContent, ChunkProvider } from './chunks';
import type { LoosePartField } from '../parts/loose';
import { jobAt, type FreightField } from './freight';
import { createBonnetStorage } from '../vehicle/bonnet';
import type { TrailerField } from '../vehicle/trailer';
import type { WreckTrunkField } from './wrecktrunks';

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

/** Default metres of arclength between POI slots. */
export const POI_SPACING = DEFAULT_POI_SPACING_METRES;
/** Fraction of slots that contain a POI; the rest read as empty desert. */
const POI_OCCUPANCY = 0.55;
/** Domain tag for the POI hash stream, distinct from every other subsystem. */
const POI_DOMAIN = 0x504f4931; // 'POI1'

/** Kind distribution is intentionally front-loaded on the scavenging stops. */
const KIND_WRECK = 0.4;
const KIND_GAS = 0.58;
const KIND_CAMP = 0.9;

export type PoiKind = 'roadside_wrecks' | 'gas_stop' | 'workshop' | 'camp';

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
export function poisBetween(
  seed: number,
  fromS: number,
  toS: number,
  spacing = POI_SPACING,
): Poi[] {
  const result: Poi[] = [];
  const firstIndex = Math.max(1, Math.ceil(fromS / spacing));
  // `toS - 1e-6` keeps a POI exactly on the upper boundary in the next chunk.
  const lastIndex = Math.floor((toS - 1e-6) / spacing);

  for (let i = firstIndex; i <= lastIndex; i++) {
    const s = i * spacing;
    if (s <= 0 || s > ROAD_LENGTH) continue;

    if (hash01(seed, POI_DOMAIN, i) >= POI_OCCUPANCY) continue;

    const kindRoll = hash01(seed, POI_DOMAIN, i, 1);
    let kind: PoiKind;
    if (kindRoll < KIND_WRECK) kind = 'roadside_wrecks';
    else if (kindRoll < KIND_GAS) kind = 'gas_stop';
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

/**
 * The POI at a given slot, or null when that slot is empty desert. Same rolls as
 * `poisBetween`, factored out so the freight system can resolve a destination slot
 * without sampling a whole stretch of road.
 */
export function poiAt(seed: number, index: number, spacing = POI_SPACING): Poi | null {
  if (index < 1) return null;
  const s = index * spacing;
  if (s <= 0 || s > ROAD_LENGTH) return null;
  if (hash01(seed, POI_DOMAIN, index) >= POI_OCCUPANCY) return null;

  const kindRoll = hash01(seed, POI_DOMAIN, index, 1);
  let kind: PoiKind;
  if (kindRoll < KIND_WRECK) kind = 'roadside_wrecks';
  else if (kindRoll < KIND_GAS) kind = 'gas_stop';
  else if (kindRoll < KIND_CAMP) kind = 'camp';
  else kind = 'workshop';

  const side = hash01(seed, POI_DOMAIN, index, 2) < 0.5 ? -1 : 1;
  return {
    index,
    s,
    lateral: side * (12 + hash01(seed, POI_DOMAIN, index, 3) * 28),
    kind,
    variantSeed: hash(seed, POI_DOMAIN, index, 4),
  };
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

/**
 * Matrix from an upright-ish pose. `yaw` about Y, then `roll`/`pitch` tilts.
 *
 * `x`/`z` are ABSOLUTE: the translation is written relative to `ox`/`oz`, so the
 * matrix is already in the chunk's floating-origin frame when both the visual
 * (`setFromMatrix`) and the collider (`geometryToTrimesh`) read it. The rebase
 * happens here, once, never in either consumer.
 */
function poseMatrix(
  x: number,
  y: number,
  z: number,
  yaw: number,
  roll: number,
  pitch: number,
  ox: number,
  oz: number,
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x - ox, y, z - oz), q, new THREE.Vector3(1, 1, 1));
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
 *
 * Returns the collider so a caller that needs to identify it later (a revivable
 * wreck, which must be recognised when the aim ray hits it) can register the
 * handle. Null when the chunk carries no physics.
 */
function addStaticCollider(
  ctx: ChunkContext,
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  surface: SurfaceType,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): RAPIER.Collider | null {
  if (!ctx.hasPhysics) return null;
  const t = geometryToTrimesh(geometry, matrix);
  const collider = ctx.physics.addStaticTrimesh(t.vertices, t.indices, surface);
  colliders.push(collider);
  const parent = collider.parent();
  if (parent) bodies.push(parent);
  return collider;
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

function makeFluidCan(
  world: GameWorld,
  poi: Poi,
  fluid: FluidKind,
  litres: number,
  capacity: number,
  counter: LootCounter,
): FluidCanItem {
  const sub = counter.sub++;
  return {
    type: 'fluid_can',
    id: world.generatedPartId('poi_item', poi.index, sub),
    fluid,
    capacity,
    litres,
  };
}

/**
 * What a gas stop stocks, by weight.
 *
 * Fuel dominates because fuel is the pressure the player feels every minute;
 * coolant and oil are the ones they only think about every 150 km or so, so they
 * turn up often enough to be findable and rarely enough to be worth a detour. Small
 * cans for the engine fluids, because that is how they are sold.
 *
 * The petrol/diesel split is matched to the CATALOGUE, not chosen for flavour. Of
 * the 24 bodies, 4 run on diesel — the PSX estate, van and box truck, and the
 * Quaternius off-roader — so roughly one car in six is a diesel. Cars are found
 * rather than spawned now, and the wreck pool draws from the whole catalogue, so
 * that one-in-six is the real exposure a player has.
 *
 * The first cut had diesel at 0.26 against petrol's 0.40, which oversupplied it
 * about two to one: a quarter of every can in the desert would have been unusable
 * to five players out of six. The split below leaves diesel a slight surplus over
 * its share of the fleet, so a diesel driver is not starved by bad luck, without
 * littering the road with cans nobody can pour.
 */
const FLUID_STOCK: readonly { fluid: FluidKind; weight: number; capacity: number }[] = [
  { fluid: 'petrol', weight: 0.5, capacity: 20 },
  { fluid: 'diesel', weight: 0.15, capacity: 20 },
  { fluid: 'coolant', weight: 0.19, capacity: 5 },
  { fluid: 'oil', weight: 0.16, capacity: 5 },
];

function pickFluid(roll: number): { fluid: FluidKind; capacity: number } {
  let acc = 0;
  for (const entry of FLUID_STOCK) {
    acc += entry.weight;
    if (roll < acc) return entry;
  }
  return FLUID_STOCK[0];
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

// ---------------------------------------------------------------------------
// Kind builders. Each builds its scenery unconditionally and its loot only when
// `shouldLoot` is set, so an emptied POI keeps its structure but never restocks.
//
// POIs no longer shed loose vehicle parts. Scattering wheels, engines, bumpers
// and seats down the whole road littered the world with scrap that had to be
// picked up one by one, so loot is now tools and fuel cans only. Wrecks remain
// static scenery and nothing falls off them — do not re-add part spawns here.
// ---------------------------------------------------------------------------

function buildPoi(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  disposables: Disposable[],
  loose: LoosePartField,
  trailers: TrailerField,
  freight: FreightField,
  wreckTrunks: WreckTrunkField,
  registeredWrecks: string[],
): void {
  const counter: LootCounter = { sub: 0 };
  const shouldLoot = ctx.hasPhysics && !ctx.world.state.lootedPois.includes(poi.index);

  switch (poi.kind) {
    case 'roadside_wrecks':
      buildWrecks(ctx, poi, group, bodies, colliders, wreckTrunks, registeredWrecks);
      break;
    case 'gas_stop':
      buildGasStop(ctx, poi, group, bodies, colliders, loose, trailers, counter, shouldLoot);
      break;
    case 'workshop':
      buildWorkshop(ctx, poi, group, bodies, colliders, loose, counter, shouldLoot);
      break;
    case 'camp':
      buildCamp(ctx, poi, group, bodies, colliders, loose, counter, shouldLoot);
      break;
  }

  buildFreight(ctx, poi, group, bodies, colliders, disposables, freight);

  // Record that this POI's loot is now materialised. The flag alone is the whole
  // idempotency guard across chunk promotion / unload / reload.
  if (shouldLoot) ctx.world.apply({ t: 'poi_looted', poiIndex: poi.index });
}

// ---------------------------------------------------------------------------
// Freight furniture: the destination sign every stop carries, and the pallet
// waiting at the ones with a load to move.
// ---------------------------------------------------------------------------

const SIGN_POST_HEIGHT = 2.5;
const SIGN_PANEL = 1.05;
/** Lateral offset from the POI anchor, toward the road. */
const SIGN_LATERAL = -5.5;
const PALLET_HALF: readonly [number, number, number] = [0.7, 0.45, 1.1];

/**
 * The trailer pictogram. Drawn rather than authored so the sign carries no text in
 * any language: a box on two wheels behind a hitch is the only thing the player
 * needs to read, and it means the same thing at 200 m as it does at 2 m.
 */
let _signTexture: THREE.CanvasTexture | null = null;
function trailerSignTexture(): THREE.CanvasTexture {
  if (_signTexture) return _signTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable for the freight sign');

  g.fillStyle = '#1d2b22';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = '#e8dcc4';
  g.lineWidth = 8;
  g.strokeRect(14, 14, size - 28, size - 28);

  g.fillStyle = '#e8dcc4';
  // Bed.
  g.fillRect(70, 96, 130, 62);
  // Drawbar and hitch eye.
  g.fillRect(40, 132, 34, 10);
  g.beginPath();
  g.arc(40, 137, 12, 0, Math.PI * 2);
  g.fill();
  // Wheels.
  for (const cx of [104, 168]) {
    g.beginPath();
    g.arc(cx, 172, 20, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#1d2b22';
  for (const cx of [104, 168]) {
    g.beginPath();
    g.arc(cx, 172, 8, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _signTexture = tex;
  return tex;
}

/**
 * One sign per stop, plus a pallet where there is freight waiting.
 *
 * The sign is built at every POI on purpose. If only destinations had signs, the
 * mere presence of one would give the answer away and the lighting would be
 * decoration; a road lined with dark frames means the lit one is genuinely
 * information.
 *
 * The panel material is per-POI rather than shared, because exactly one of them
 * lights at a time — a module-level material could only light all or none.
 */
function buildFreight(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  disposables: Disposable[],
  freight: FreightField,
): void {
  const a = anchorXZ(ctx, poi);
  const ox = ctx.originX;
  const oz = ctx.originZ;
  const base = placeAt(ctx, poi, a, SIGN_LATERAL, 0, a.heading);

  const postGeo = new THREE.CylinderGeometry(0.07, 0.09, SIGN_POST_HEIGHT, 6);
  disposables.push(postGeo);
  addStaticMesh(
    ctx,
    postGeo,
    makeFlatMaterial(0x4a4640, 0.7),
    poseMatrix(base.x, base.y + SIGN_POST_HEIGHT / 2, base.z, a.heading, 0, 0, ox, oz),
    SurfaceType.Concrete,
    group,
    bodies,
    colliders,
  );

  const panelGeo = new THREE.BoxGeometry(SIGN_PANEL, SIGN_PANEL, 0.08);
  const panelMat = new THREE.MeshStandardMaterial({
    map: trailerSignTexture(),
    roughness: 0.55,
    metalness: 0.05,
    emissive: 0xffe6a8,
    emissiveIntensity: 0,
  });
  disposables.push(panelGeo, panelMat);
  const panelMatrix = poseMatrix(
    base.x,
    base.y + SIGN_POST_HEIGHT + SIGN_PANEL / 2 - 0.2,
    base.z,
    // Face across the road, so it reads from a car coming up on it.
    a.heading + Math.PI / 2,
    0,
    0,
    ox,
    oz,
  );
  const panel = new THREE.Mesh(panelGeo, panelMat);
  setFromMatrix(panel, panelMatrix);
  group.add(panel);
  const panelCollider = addStaticCollider(
    ctx,
    panelGeo,
    panelMatrix,
    SurfaceType.Concrete,
    bodies,
    colliders,
  );

  // A data source for LightBudget, not a rendered light: kept invisible so chunk
  // streaming never changes Three's point-light shader permutation.
  const light = new THREE.PointLight(0xffe6a8, 0, 34, 2);
  light.position.set(base.x - ox, base.y + SIGN_POST_HEIGHT, base.z - oz);
  light.visible = false;
  light.userData.lightBudgetSource = true;
  group.add(light);

  freight.registerSign(poi.index, panelMat, light, panelCollider?.handle ?? null, bodies);

  // The pallet: present only where the seed says there is a load, the player is not
  // already carrying one from here, and this stop has not been cleared before.
  const job = jobAt(ctx.world.seed, poi.index, ctx.world.state.settings.poiSpacingMetres);
  if (!job) return;
  const s = ctx.world.state;
  const taken = s.job !== null && s.job.fromPoi === poi.index;
  if (taken || s.deliveredPois.includes(poi.index)) return;

  const palletGeo = new THREE.BoxGeometry(PALLET_HALF[0] * 2, PALLET_HALF[1] * 2, PALLET_HALF[2] * 2);
  disposables.push(palletGeo);
  const spot = placeAt(ctx, poi, a, 2.6, 3.4, a.heading);
  const palletMatrix = poseMatrix(
    spot.x,
    spot.y + PALLET_HALF[1],
    spot.z,
    a.heading + hash01(poi.variantSeed, 0x9a) * 0.4,
    0,
    0,
    ox,
    oz,
  );
  const pallet = new THREE.Mesh(palletGeo, makeFlatMaterial(0x8a6238, 0.9));
  setFromMatrix(pallet, palletMatrix);
  pallet.castShadow = true;
  group.add(pallet);
  const palletCollider = addStaticCollider(
    ctx,
    palletGeo,
    palletMatrix,
    SurfaceType.Concrete,
    bodies,
    colliders,
  );
  freight.registerPallet(poi.index, pallet, palletCollider?.handle ?? null, bodies);
}

/**
 * Fraction of roadside wreck fields containing one working car. The roll is per
 * field, not per shell: most stops are wrecks only, while roughly one in three has
 * exactly one roadworthy car parked among them.
 */
const WORKING_CAR_CHANCE = 0.34;
/** Domain tag for the working-car roll, distinct from the placement stream. */
const WORKING_CAR_DOMAIN = 0x52554e31; // 'RUN1'

function makeWorkingCar(
  ctx: ChunkContext,
  poi: Poi,
  slot: number,
  def: CarModelDef,
  x: number,
  y: number,
  z: number,
  yaw: number,
): CarState {
  const engine = variant(def.engineId).engine;
  const halfYaw = yaw / 2;
  return {
    id: ctx.world.generatedPartId('poi-car', poi.index, slot),
    modelId: def.id,
    gizmos: {},
    stickers: [],
    // Enough fuel to make the find immediately useful, but not a free full tank.
    fuelLitres: def.tankLitres * (0.15 + hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 3) * 0.2),
    fuelKind: engine?.fuel ?? null,
    coolantLitres: engine ? coolantCapacity(engine) : 0,
    oilLitres: engine ? oilCapacity(engine) : 0,
    storage: new Array(def.storageCells).fill(null),
    bonnet: createBonnetStorage(
      ctx.world.generatedPartId('poi-car', poi.index, slot),
      def.engineId,
      def.bodyClass,
      def.tankLitres,
    ),
    odometer: Math.floor(hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 4) * 240_000),
    x,
    y,
    z,
    qx: 0,
    qy: Math.sin(halfYaw),
    qz: 0,
    qw: Math.cos(halfYaw),
  };
}

/**
 * One to three complete models scattered through a roadside wreck field. Every
 * shell draws from the full catalogue. Rarely, one upright slot instead becomes a
 * working car drawn only from the Quaternius and Soviet roadworthy pool.
 */
function buildWrecks(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  wreckTrunks: WreckTrunkField,
  registeredWrecks: string[],
): void {
  const anchor = anchorXZ(ctx, poi);
  const ox = ctx.originX;
  const oz = ctx.originZ;
  const count = 1 + Math.floor(hash01(poi.variantSeed, 10) * 3); // 1..3 bodies

  const hasWorkingCar =
    hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 0) < WORKING_CAR_CHANCE;
  const workingSlot = hasWorkingCar
    ? Math.floor(hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 1) * count)
    : -1;

  for (let w = 0; w < count; w++) {
    const isWorkingCar = w === workingSlot;
    // Working finds are roadworthy; ordinary shells come from the wreck-only
    // catalogue so the debris models cannot disappear behind random spawnable picks.
    const pool = isWorkingCar ? SPAWNABLE_CAR_MODELS : WRECK_ONLY_CAR_MODELS;
    const def: CarModelDef = pick(pool, poi.variantSeed, w, 10);
    const measure = carModelMeasure(def.id);
    const half = measure.halfExtents;
    const carId = ctx.world.generatedPartId('poi-car', poi.index, w);

    // A generated working car stays in world state after it is driven away. Never
    // rebuild a shell or a second car at its original POI.
    if (isWorkingCar && ctx.world.state.cars[carId]) continue;

    const sDelta = (hash01(poi.variantSeed, w, 11) - 0.5) * 16;
    const latDelta = (hash01(poi.variantSeed, w, 12) - 0.5) * 12;
    const p = groundPoint(ctx, poi, sDelta, latDelta);

    const yawRoll = hash01(poi.variantSeed, w, 13);
    let yaw = anchor.heading + (hash01(poi.variantSeed, w, 14) - 0.5) * 0.6;
    if (!isWorkingCar) {
      if (yawRoll < 0.32) yaw += Math.PI;
      else if (yawRoll > 0.82) {
        yaw += (hash01(poi.variantSeed, w, 15) < 0.5 ? 1 : -1) * Math.PI * 0.5;
      }
    }

    const sink = isWorkingCar ? 0.02 : 0.25 + hash01(poi.variantSeed, w, 16) * half[1] * 0.5;
    const roll = isWorkingCar ? 0 : (hash01(poi.variantSeed, w, 17) - 0.5) * 0.3;
    const pitch = isWorkingCar ? 0 : (hash01(poi.variantSeed, w, 18) - 0.5) * 0.22;
    const originY = p.y + half[1] - sink;

    // Distant scenery shows the future working car as an upright static model.
    // Promotion into the physics band replaces it with a real Vehicle.
    if (isWorkingCar && ctx.hasPhysics) {
      // The distant static preview stands on the terrain; promotion creates the
      // physical car in clear air so gravity and suspension determine its ride height.
      const spawnY = carSpawnYAboveGround(measure, p.y);
      ctx.world.apply({
        t: 'car_add',
        car: makeWorkingCar(ctx, poi, w, def, p.x, spawnY, p.z, yaw),
      });
      continue;
    }

    const matrix = poseMatrix(p.x, originY, p.z, yaw, roll, pitch, ox, oz);
    const shell = createStaticCarModel(def.id);
    setFromMatrix(shell, matrix);
    group.add(shell);

    // A box approximates a static shell well enough for a solid obstacle.
    const collider = addStaticCollider(
      ctx,
      new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
      matrix,
      SurfaceType.Rock,
      bodies,
      colliders,
    );
    if (!isWorkingCar && collider) {
      wreckTrunks.register({
        id: carId,
        modelId: def.id,
        x: p.x,
        y: originY,
        z: p.z,
        qx: shell.quaternion.x,
        qy: shell.quaternion.y,
        qz: shell.quaternion.z,
        qw: shell.quaternion.w,
        halfExtents: half,
      });
      registeredWrecks.push(carId);
    }
  }
}

/** Fraction of gas stops with a trailer standing on the forecourt. */
const TRAILER_STOP_CHANCE = 0.45;
/** Domain tag for the trailer roll. */
const TRAILER_DOMAIN = 0x54524c31; // 'TRL1'

function buildGasStop(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  loose: LoosePartField,
  trailers: TrailerField,
  counter: LootCounter,
  shouldLoot: boolean,
): void {
  const a = anchorXZ(ctx, poi);
  const ox = ctx.originX;
  const oz = ctx.originZ;
  const yaw = a.heading;

  // Canopy roof, spanning the road direction so it reads as a forecourt.
  const roof = placeAt(ctx, poi, a, 0, 0, yaw);
  addStaticMesh(
    ctx,
    new THREE.BoxGeometry(9.6, 0.4, 6.2),
    makeFlatMaterial(0x8fa0ad, 0.8),
    poseMatrix(roof.x, roof.y + 3.6, roof.z, yaw, 0, 0, ox, oz),
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
      poseMatrix(post.x, post.y + 1.8, post.z, yaw, 0, 0, ox, oz),
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
      poseMatrix(pump.x, pump.y + 0.75, pump.z, yaw, 0, 0, ox, oz),
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
      poseMatrix(face.x, face.y + 1.25, face.z, yaw, 0, 0, ox, oz),
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
    poseMatrix(shack.x, shack.y + 1.1, shack.z, yaw + 0.12, 0, 0, ox, oz),
    SurfaceType.Concrete,
    group,
    bodies,
    colliders,
  );
  addStaticMesh(
    ctx,
    new THREE.BoxGeometry(3.0, 0.18, 2.4),
    makeFlatMaterial(0x7d4a35, 0.85),
    poseMatrix(shack.x, shack.y + 2.35, shack.z, yaw + 0.12, 0, 0, ox, oz),
    SurfaceType.Concrete,
    group,
    bodies,
    colliders,
  );

  if (shouldLoot) {
    // Fuel is the whole point of a gas stop, but a forecourt also carries the
    // engine fluids: the same stop that gets you moving is where you top up.
    const n = 3 + Math.floor(hash01(poi.variantSeed, 30) * 4); // 3..6
    for (let i = 0; i < n; i++) {
      const stock = pickFluid(hash01(poi.variantSeed, 31, i));
      // Cans are found part-used, never factory-sealed. A 20 L fuel can holds
      // 12-20 L; a 5 L fluid can holds 3-5.
      const litres = Math.round(stock.capacity * (0.6 + hash01(poi.variantSeed, 32, i) * 0.4) * 10) / 10;
      const can = makeFluidCan(ctx.world, poi, stock.fluid, litres, stock.capacity, counter);
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

    // The roadside-only rescue resource: one sealed five-piece pack per gas stop.
    // It sits by the attendant shack, not in the general POI loot tables.
    const gumSpot = placeAt(ctx, poi, a, 2.6, -0.7, yaw);
    const gumSub = counter.sub++;
    loose.spawnItem(
      {
        type: 'bubble_gum',
        id: ctx.world.generatedPartId('poi_item', poi.index, gumSub),
        charges: 5,
      },
      gumSpot.x,
      gumSpot.y + 0.18,
      gumSpot.z,
    );

    // A trailer on the forecourt. Take one, leave one: they are never owned, so
    // this records a world object rather than giving the player a possession, and
    // the `shouldLoot` gate is what stops the stop growing a new one every reload.
    if (hash01(poi.variantSeed, TRAILER_DOMAIN, 0) < TRAILER_STOP_CHANCE) {
      const spot = placeAt(ctx, poi, a, 6.4, -1.2, yaw);
      const half = yaw / 2;
      trailers.spawn({
        id: `trailer:${poi.index}`,
        hitchedTo: null,
        cargoKg: 0,
        x: spot.x,
        // Clear of the ground so it drops onto its own suspension rather than
        // starting inside the terrain trimesh.
        y: spot.y + 0.9,
        z: spot.z,
        qx: 0,
        qy: Math.sin(half),
        qz: 0,
        qw: Math.cos(half),
      });
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
  const ox = ctx.originX;
  const oz = ctx.originZ;
  const yaw = a.heading + (hash01(poi.variantSeed, 40) - 0.5) * 0.3;

  // Corrugated shed: body + overhanging roof.
  const shed = placeAt(ctx, poi, a, 0, 0, yaw);
  addStaticMesh(
    ctx,
    new THREE.BoxGeometry(4.6, 2.6, 3.4),
    makeFlatMaterial(0x8a8f94, 0.85),
    poseMatrix(shed.x, shed.y + 1.3, shed.z, yaw, 0, 0, ox, oz),
    SurfaceType.Concrete,
    group,
    bodies,
    colliders,
  );
  addStaticMesh(
    ctx,
    new THREE.BoxGeometry(5.2, 0.2, 4.0),
    makeFlatMaterial(0x9a4a35, 0.9),
    poseMatrix(shed.x, shed.y + 2.75, shed.z, yaw, 0, 0, ox, oz),
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
    poseMatrix(door.x, door.y + 1.0, door.z, yaw, 0, 0, ox, oz),
    group,
  );

  // Workbench: top + four legs.
  const bench = placeAt(ctx, poi, a, 1.6, -0.4, yaw);
  addStaticMesh(
    ctx,
    new THREE.BoxGeometry(2.2, 0.12, 0.8),
    makeFlatMaterial(0x7a5230, 0.85),
    poseMatrix(bench.x, bench.y + 0.85, bench.z, yaw, 0, 0, ox, oz),
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
      poseMatrix(leg.x, leg.y + 0.42, leg.z, yaw, 0, 0, ox, oz),
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
      poseMatrix(t.x, t.y + 0.93, t.z, yaw, 0, hash01(poi.variantSeed, 45, i) * 0.4, ox, oz),
      group,
    );
  }

  if (shouldLoot) {
    const toolCount = 1 + Math.floor(hash01(poi.variantSeed, 62) * 2); // 1..2
    for (let i = 0; i < toolCount; i++) {
      const tool = pick(TOOL_KINDS, poi.variantSeed, 63, i);
      const item = makeTool(ctx.world, poi, tool, counter);
      const p = placeAt(ctx, poi, a, 1.6, -0.4, yaw);
      loose.spawnItem(item, p.x, p.y + 1.0, p.z);
    }
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
  const ox = ctx.originX;
  const oz = ctx.originZ;
  const yaw = a.heading + (hash01(poi.variantSeed, 80) - 0.5) * 0.5;

  // Teepee tent (visual only — cloth).
  const tent = placeAt(ctx, poi, a, -1.8, 0.5, yaw);
  addVisual(
    new THREE.ConeGeometry(2.1, 2.2, 6),
    makeFlatMaterial(0xc9b98a, 0.95),
    poseMatrix(tent.x, tent.y + 1.1, tent.z, 0, 0, 0, ox, oz),
    group,
  );

  // Fire ring: flat stone torus plus two logs (visual only).
  const fire = placeAt(ctx, poi, a, 1.4, -0.4, yaw);
  addVisual(
    new THREE.TorusGeometry(0.8, 0.16, 6, 18),
    makeFlatMaterial(0x3a3a3a, 0.9),
    poseMatrix(fire.x, fire.y + 0.12, fire.z, 0, 0, Math.PI / 2, ox, oz),
    group,
  );
  for (let i = 0; i < 2; i++) {
    addVisual(
      new THREE.CylinderGeometry(0.08, 0.08, 0.9, 5),
      makeFlatMaterial(0x2a2018, 0.95),
      poseMatrix(fire.x, fire.y + 0.1, fire.z, 0, 0, hash01(poi.variantSeed, 81, i) * Math.PI, ox, oz),
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
      poseMatrix(c.x, c.y + 0.35, c.z, hash01(poi.variantSeed, 86, i) * Math.PI, 0, 0, ox, oz),
      SurfaceType.Concrete,
      group,
      bodies,
      colliders,
    );
  }

  if (shouldLoot) {
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

/** Anything with a `dispose`, for per-chunk textures, materials and geometries. */
interface Disposable {
  dispose(): void;
}

/**
 * Builds every POI inside a chunk. Scenery is always built; loot is generated once
 * per POI (guarded by `lootedPois`) and its dynamic bodies are owned by
 * `LoosePartField`, not by the chunk — so chunk unload never tears loot down.
 *
 * The freight sign and pallet have identities outside the chunk so the aim ray can
 * name them and the destination sign can be lit. `dispose` drops those registrations,
 * keyed on this chunk's own body array.
 *
 * `setLamps` is where the destination sign lights. It is the per-frame push the
 * streamer already makes to every live chunk, which is why a job starting or
 * finishing needs no chunk rebuild: nothing about the world's *structure* changed,
 * only which panel is glowing.
 */
export class PoiProvider implements ChunkProvider {
  readonly id = 'poi';

  constructor(
    private readonly loose: LoosePartField,
    private readonly trailers: TrailerField,
    private readonly freight: FreightField,
    private readonly wreckTrunks: WreckTrunkField,
  ) {}

  build(ctx: ChunkContext): ChunkContent | null {
    const pois = poisBetween(
      ctx.world.seed,
      ctx.sStart,
      ctx.sEnd,
      ctx.world.state.settings.poiSpacingMetres,
    );

    const group = new THREE.Group();
    group.name = 'poi';
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const disposables: Disposable[] = [];
    const registeredWrecks: string[] = [];

    for (const poi of pois) {
      buildPoi(
        ctx,
        poi,
        group,
        bodies,
        colliders,
        disposables,
        this.loose,
        this.trailers,
        this.freight,
        this.wreckTrunks,
        registeredWrecks,
      );
    }

    const freight = this.freight;
    const world = ctx.world;
    return {
      group,
      bodies,
      colliders,
      setLamps: (on) => freight.updateSigns(on, world.state.job?.toPoi ?? null),
      dispose: () => {
        freight.forgetChunk(bodies);
        this.wreckTrunks.forget(registeredWrecks);
        for (const d of disposables) d.dispose();
      },
    };
  }
}
