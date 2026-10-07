import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { hash, hash01, pick } from '../core/rng';
import { GAMEPLAY_CONFIG } from '../config';
import { SurfaceType } from '../core/surfaces';
import { ROAD_LENGTH, type Road } from './road';
import type { CarState, GameWorld } from '../game/state';
import {
  IMPORT_ENGINE_IDS,
  oilCapacity,
  variant,
  variantsOfKind,
  type BodyClass,
  type PartInstance,
} from '../parts/registry';
import type {
  FluidCanItem,
  FluidKind,
  Item,
  PartItem,
  SprayCanItem,
  ToolItem,
} from '../items/items';
import { makeSponge } from '../items/items';
import { CAR_PAINTS } from '../vehicle/carpaint';
import { makeFlatMaterial } from '../render/materials';
import {
  carModelMeasure,
  carSpawnYAboveGround,
  createCourierCarModel,
  createStaticCarModel,
  isCarModelLoaded,
  loadCarModel,
} from '../render/carmodel';
import { CAR_MODELS, type CarModelDef } from '../vehicle/carmodels';
import type { ChunkContext, ChunkContent, ChunkProvider } from './chunks';
import type { LoosePartField } from '../parts/loose';
import {
  bonnetWaterCapacity,
  createBonnetStorage,
  BONNET_SLOT_COUNT,
  BONNET_SLOT_KINDS,
} from '../vehicle/bonnet';
import { TRUNK_CELL_COUNT } from '../vehicle/trunk';
import { COLD_SOAK_C } from '../vehicle/cooling';
import type { TrailerField } from '../vehicle/trailer';
import type { WreckTrunkField } from './wrecktrunks';
import { courierDefaultStorage } from '../contracts/offers';
import { photoSubjects } from '../contracts/photosubjects';
import {
  courierId,
  courierParkingLateral,
  couriersBetween,
  isCourierPoiSlot,
  type CourierField,
  type CourierStop,
} from './couriers';
import { fitGround, type GroundPlane } from './footprint';
import {
  DANCER_ALONG_M,
  DANCER_OUT_M,
  DancerField,
  type DancerHandle,
} from './props/airdancer';
import { halfWidthAt } from './roadprofile';
import { BASIN_OUTER_M, lakeSites, type LakeSite } from './lakes';
import type { RoadDistance } from './roaddistance';
import type { VariantInstance } from './poivariantbuild';
import { createStructureInstance, structureCount, structureDef } from './poistructures';

const COURIER_MODELS = CAR_MODELS.filter((def) => def.paintStyle !== undefined);

/**
 * Points of interest: the buildings that give the drive a reason to continue.
 *
 * Two populations, one model. ROADSIDE stops stand on slots every `POI_SPACING` metres
 * of arclength, just past the verge and facing the road. DESERT ones stand on slots half
 * a spacing off those, one per side, anywhere from 70 m to the better part of a
 * kilometre out and facing wherever they were left facing: a house you only find by
 * leaving the asphalt.
 *
 * Both are pure functions of the integer seed. A POI at km 300 is computed from its
 * slot index alone — never by walking the 249 slots before it — so chunk streaming
 * can materialise any stretch of road in any order and a save always restores the
 * exact same stop.
 *
 * WHAT STANDS THERE AND WHAT IT HOLDS ARE TWO ROLLS. The building is drawn from
 * `POI_STRUCTURES` (world/poistructures.ts); what is left outside it — fuel, tools,
 * medicine, a salvage field — is its `PoiStock`, rolled separately, so the world's
 * rewards do not depend on which houses the catalogue happens to contain.
 *
 * Loot is materialised exactly once, keyed by `Poi.index`. `poi_looted` is the
 * idempotency guard: on any later rebuild the generation below is skipped entirely,
 * survivors live in `world.state.looseParts` / `looseItems`, and anything the player
 * already took is simply absent.
 */

/**
 * Metres of arclength between POI slots: 7.7 km, from `config/gameplay.json`. Not a
 * player setting any more; a slider that re-rolled every stop on the road was a debug
 * knob, and it moved `Poi.index`, which the looted flags are keyed by.
 */
export const POI_SPACING = GAMEPLAY_CONFIG.poiSpacingMetres;
/** Fraction of roadside slots that contain a POI; the rest read as empty desert. */
const POI_OCCUPANCY = 0.55;
/** Domain tag for the POI hash stream, distinct from every other subsystem. */
const POI_DOMAIN = 0x504f4931; // 'POI1'
/** Domain tag for the desert slots. */
const DESERT_DOMAIN = 0x44534b31; // 'DSK1'
/** Chance that one side of one desert slot has a building on it. */
const DESERT_OCCUPANCY = 0.36;
/** Nearest a desert building's centre stands beyond the asphalt edge and its own half size. */
const DESERT_NEAR_M = 70;
/** How much further out it may stand; drawn squared, so most are within sight of the road. */
const DESERT_SPAN_M = 560;
/**
 * Clear ground between a desert building and ANY pass of the road's asphalt, metres.
 *
 * Its lateral is measured from the road at its own arclength, and the road doubles back:
 * 600 m out on the inside of a hairpin can be on the asphalt of the next leg. The
 * provider therefore measures the placed building against the nearest pass of the whole
 * road and drops it when it is closer than this. 48 m is past the farthest wall of any
 * roadside stop (a 22 m verge plus the widest building, 25 m), so a desert building can
 * never stand in a roadside one on some other leg either.
 */
const DESERT_ROAD_CLEARANCE_M = 48;
/** Clear ground between two desert buildings, on top of both their half sizes, metres. */
const DESERT_NEIGHBOUR_CLEARANCE_M = 12;
/** No desert buildings round the homestead or the road's far end. */
const DESERT_END_CLEARANCE_M = 2_500;

/**
 * Where the two populations' identities live in `lootedPois`.
 *
 * Both are offset past anything a save written before the dwellings could hold: those
 * saves recorded the old buildings' slot indices, and the loot they left behind was laid
 * INSIDE buildings that now stand as closed shells. A fresh index gives every stop in an
 * old save its loot again, outside, instead of none.
 */
const ROADSIDE_INDEX_BASE = 50_000_000;
const DESERT_INDEX_BASE = 60_000_000;

/**
 * Clear verge between the ASPHALT EDGE and a building's nearest wall, metres.
 *
 * Measured from the edge rather than from the centreline because the road widens: one
 * fixed offset from the crown is 12 m of clearance on a two-lane stretch and 6 m on a
 * four-lane one, which is how a kiosk ends up at the paint. `halfWidthAt` is usable
 * here because it is a pure function of the seed and the arclength — no road sampling —
 * so the placement below stays as pure and as cheap as it was.
 */
const VARIANT_SETBACK_MIN_M = 10;
const VARIANT_SETBACK_SPAN_M = 12;

/**
 * What a stop leaves outside for the player, in the terms the world used when every
 * building was one of them: a forecourt's `fuel`, a shop's `store` of tools, a `home`'s
 * medicine, a scrapyard's `salvage` field of cars, a wreck's `scrap` and a mast's
 * maintenance kit.
 */
export type PoiStock = 'fuel' | 'store' | 'home' | 'salvage' | 'scrap' | 'mast';

/**
 * A dwelling's stock, by weight. The weights are the old catalogue's building counts
 * per kind — five petrol stations, five shops, six houses, three container yards, four
 * wrecks — so a stop pays out, on average, exactly what a stop paid out before the
 * buildings were replaced. Masts keep the mast stock.
 */
const DWELLING_STOCK: readonly { readonly stock: PoiStock; readonly weight: number }[] = [
  { stock: 'fuel', weight: 5 },
  { stock: 'store', weight: 5 },
  { stock: 'home', weight: 6 },
  { stock: 'salvage', weight: 3 },
  { stock: 'scrap', weight: 4 },
];
const DWELLING_STOCK_TOTAL = DWELLING_STOCK.reduce((sum, entry) => sum + entry.weight, 0);

export interface Poi {
  /** Identity in `WorldState.lootedPois` and in every generated item id. Stable forever. */
  readonly index: number;
  /** Arclength of the stop, metres from the house. */
  readonly s: number;
  /** Signed lateral offset from the centreline; negative is left of travel. */
  readonly lateral: number;
  /** Index into `POI_STRUCTURES`: the building that stands here. */
  readonly structure: number;
  readonly stock: PoiStock;
  /** Out in the desert rather than at the verge: faces anywhere, and has no courier. */
  readonly desert: boolean;
  /** Deterministic per-POI variation seed for shape and loot. */
  readonly variantSeed: number;
  /**
   * One of the first two roadside stops of the drive: its car field always holds a car
   * the player can take, so a swap is on offer before the road asks for one.
   */
  readonly guaranteedCar?: boolean;
}

function halfStructure(structure: number): number {
  const footprint = structureDef(structure).footprint;
  return Math.max(footprint[0], footprint[1]) / 2;
}

/** A desert building faces anywhere, so it is kept clear by its corner, not its side. */
function radiusStructure(structure: number): number {
  const footprint = structureDef(structure).footprint;
  return Math.hypot(footprint[0], footprint[1]) / 2;
}

/**
 * Which building, and what it holds. There is deliberately no progression to learn:
 * both are hashes of the slot, so having seen fuel outside one izba tells a player
 * nothing about the next one.
 */
function rollStructure(seed: number, domain: number, key: number): { structure: number; stock: PoiStock } {
  const structure = Math.min(
    structureCount() - 1,
    Math.floor(hash01(seed, domain, key, 1) * structureCount()),
  );
  if (structureDef(structure).kind === 'mast') return { structure, stock: 'mast' };
  let cursor = hash01(seed, domain, key, 5) * DWELLING_STOCK_TOTAL;
  for (const entry of DWELLING_STOCK) {
    cursor -= entry.weight;
    if (cursor < 0) return { structure, stock: entry.stock };
  }
  return { structure, stock: DWELLING_STOCK[DWELLING_STOCK.length - 1]!.stock };
}

/**
 * One roadside slot, resolved: null when it is empty desert. A courier slot always
 * has a building, because the courier parks beside it.
 *
 * The offset is what this PARTICULAR building needs: the asphalt half width at this
 * arclength, plus a verge, plus the building's own half-extent. The AUTHORED footprint
 * is used rather than a measured one because this is pure and cheap by contract —
 * `poisBetween` resolves a stretch of road without building a single triangle.
 */
function roadsideOccupied(seed: number, slot: number, spacing: number): boolean {
  return hash01(seed, POI_DOMAIN, slot) < POI_OCCUPANCY || isCourierPoiSlot(seed, slot, spacing);
}

/** Stops of the drive whose car field always has a car to take (see `Poi.guaranteedCar`). */
const GUARANTEED_CAR_STOPS = 2;

function roadsidePoi(seed: number, slot: number, spacing: number): Poi | null {
  const s = slot * spacing;
  if (slot < 1 || s > ROAD_LENGTH) return null;
  if (!roadsideOccupied(seed, slot, spacing)) return null;
  let earlier = 0;
  for (let k = 1; k < slot && earlier < GUARANTEED_CAR_STOPS; k++) {
    if (roadsideOccupied(seed, k, spacing)) earlier++;
  }
  const { structure, stock } = rollStructure(seed, POI_DOMAIN, slot);
  const side = hash01(seed, POI_DOMAIN, slot, 2) < 0.5 ? -1 : 1;
  const verge = VARIANT_SETBACK_MIN_M + hash01(seed, POI_DOMAIN, slot, 3) * VARIANT_SETBACK_SPAN_M;
  return {
    index: ROADSIDE_INDEX_BASE + slot,
    s,
    lateral: side * (halfWidthAt(seed, s) + verge + halfStructure(structure)),
    structure,
    stock,
    desert: false,
    variantSeed: hash(seed, POI_DOMAIN, slot, 4),
    guaranteedCar: earlier < GUARANTEED_CAR_STOPS,
  };
}

/**
 * Roadside POIs whose slot falls in [fromS, toS). Pure and order-independent: no road
 * or terrain sampling happens here.
 */
export function poisBetween(
  seed: number,
  fromS: number,
  toS: number,
  spacing = POI_SPACING,
): Poi[] {
  const result: Poi[] = [];
  const firstSlot = Math.max(1, Math.ceil(fromS / spacing));
  // `toS - 1e-6` keeps a POI exactly on the upper boundary in the next chunk.
  const lastSlot = Math.floor((toS - 1e-6) / spacing);
  for (let slot = firstSlot; slot <= lastSlot; slot++) {
    const poi = roadsidePoi(seed, slot, spacing);
    if (poi) result.push(poi);
  }
  return result;
}

/**
 * The roadside POI at a slot, or null when that slot is empty desert. Same rolls as
 * `poisBetween`, so one slot can be resolved without sampling a whole stretch of road —
 * `tools/wreck-spacing.ts` reads a field that way.
 */
export function poiAt(seed: number, slot: number, spacing = POI_SPACING): Poi | null {
  return roadsidePoi(seed, slot, spacing);
}

const lakeCache = new Map<number, readonly LakeSite[]>();
function lakesOf(seed: number): readonly LakeSite[] {
  let sites = lakeCache.get(seed);
  if (!sites) {
    sites = lakeSites(seed, ROAD_LENGTH);
    lakeCache.set(seed, sites);
  }
  return sites;
}

/** Whether a desert spot, in road coordinates, falls in or on the rim of a lake basin. */
function inLakeBasin(seed: number, s: number, lateral: number, half: number): boolean {
  const reach = BASIN_OUTER_M + half + 20;
  for (const site of lakesOf(seed)) {
    if (Math.abs(site.s - s) > reach) continue;
    if (Math.hypot(site.s - s, site.lateral - lateral) < reach) return true;
  }
  return false;
}

/**
 * Desert POIs whose slot's arclength falls in [fromS, toS).
 *
 * A desert slot sits half a spacing off the roadside grid and carries one candidate on
 * each side, each moved up to 40% of a spacing along the road so the two sides do not
 * pair up. Its arclength decides which chunk builds it, exactly as a roadside one's does.
 * What this cannot know without the road's geometry is whether another pass of the road
 * runs past the spot; `PoiProvider` checks that where it has the road.
 */
export function desertPoisBetween(
  seed: number,
  fromS: number,
  toS: number,
  spacing = POI_SPACING,
): Poi[] {
  const result: Poi[] = [];
  // One slot either side of the range: a jittered slot can land inside it from next door.
  const firstSlot = Math.max(0, Math.floor(fromS / spacing) - 1);
  const lastSlot = Math.ceil(toS / spacing) + 1;
  for (let slot = firstSlot; slot <= lastSlot; slot++) {
    for (const side of [-1, 1] as const) {
      const key = slot * 2 + (side > 0 ? 1 : 0);
      if (hash01(seed, DESERT_DOMAIN, key) >= DESERT_OCCUPANCY) continue;
      const s = (slot + 0.5 + (hash01(seed, DESERT_DOMAIN, key, 2) - 0.5) * 0.8) * spacing;
      if (s < fromS || s >= toS) continue;
      if (s < DESERT_END_CLEARANCE_M || s > ROAD_LENGTH - DESERT_END_CLEARANCE_M) continue;
      const { structure, stock } = rollStructure(seed, DESERT_DOMAIN, key);
      const half = halfStructure(structure);
      const out = hash01(seed, DESERT_DOMAIN, key, 3);
      const lateral = side * (halfWidthAt(seed, s) + DESERT_NEAR_M + half + out * out * DESERT_SPAN_M);
      if (inLakeBasin(seed, s, lateral, half)) continue;
      result.push({
        index: DESERT_INDEX_BASE + key,
        s,
        lateral,
        structure,
        stock,
        desert: true,
        variantSeed: hash(seed, DESERT_DOMAIN, key, 4),
      });
    }
  }
  return result;
}

/** The lattice the terrain mesh already resolves road ownership on (world/terrainmesh.ts). */
const DESERT_OWNER_LATTICE_M = 50;

/**
 * Whether a desert POI's spot stays clear of every pass of the road. Its own lateral
 * already clears the road at its own arclength; this finds the pass nearest the spot,
 * wherever along the road that is, and measures against it exactly.
 */
export function desertPoiClearOfRoad(poi: Poi, road: Road, roadDistance: RoadDistance): boolean {
  const point = road.offsetPoint(poi.s, poi.lateral);
  const owner = roadDistance.ownerAt(point.x, point.z, DESERT_OWNER_LATTICE_M);
  const nearest = road.project(point.x, point.z, owner);
  const clearance = Math.abs(nearest.lateral) - road.halfWidthAt(nearest.s) - radiusStructure(poi.structure);
  return clearance >= DESERT_ROAD_CLEARANCE_M;
}

/**
 * Whether no other desert building stands where this one would. Slots are hundreds of
 * metres apart along the road, but out at 600 m on the inside of a tight bend the
 * laterals of neighbouring slots converge. Of two that meet, the one with the lower
 * index stands and the other is dropped — whichever chunk is asking, the same one wins.
 */
function desertPoiClearOfNeighbours(poi: Poi, seed: number, spacing: number, road: Road): boolean {
  const here = road.offsetPoint(poi.s, poi.lateral);
  const reach = 3 * spacing;
  for (const other of desertPoisBetween(seed, poi.s - reach, poi.s + reach, spacing)) {
    if (other.index >= poi.index) continue;
    const there = road.offsetPoint(other.s, other.lateral);
    const needed = radiusStructure(poi.structure) + radiusStructure(other.structure) + DESERT_NEIGHBOUR_CLEARANCE_M;
    if (Math.hypot(here.x - there.x, here.z - there.z) < needed) return false;
  }
  return true;
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

/**
 * A structure's site: the anchor its local (right, forward) offsets are measured
 * from, the yaw they are rotated by, and ONE plane fitted to the ground under the
 * whole footprint.
 *
 * One plane per site rather than one sample per part is the entire fix for
 * buildings half-buried in a dune: a canopy's four posts used to take four
 * independent centre samples and carry a level roof between them, so on the 9-10%
 * ground this world is made of, two of them stood on air. Now the site knows its
 * slope, `lift` raises anything standing on a laid apron, and a part either follows
 * the plane (`sitePoint`) or tilts onto it
 * (`plane.roll`/`plane.pitch`).
 */
interface Site {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly plane: GroundPlane;
  /** Top of the apron above the fitted plane, or zero on bare ground. */
  readonly lift: number;
}

function siteAt(
  ctx: ChunkContext,
  poi: Poi,
  anchor: Anchor,
  yaw: number,
  halfRight: number,
  halfForward: number,
  lift = 0,
): Site {
  return {
    x: anchor.x,
    z: anchor.z,
    yaw,
    lift,
    // Five by five, not the default three: the residual is only as honest as the samples
    // it is taken over, and a 30 m mast compound on the berm's curve hid 0.14 m of daylight
    // under a wall between the nine a 3x3 grid takes. Once per building, 25 road samples.
    plane: fitGround(ctx.terrain, anchor.x, anchor.z, yaw, halfRight, halfForward, poi.s, 5),
  };
}

/** World position of a local offset, on the site's ground (or on its apron). */
function sitePoint(site: Site, lx: number, lz: number): { x: number; y: number; z: number } {
  const o = rotateXZ(lx, lz, site.yaw);
  return { x: site.x + o.x, y: site.plane.yAt(lx, lz) + site.lift, z: site.z + o.z };
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
export function poseMatrix(
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
export function geometryToTrimesh(
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
 * water and oil are the ones they only think about every 150 km or so, so they
 * turn up often enough to be findable and rarely enough to be worth a detour. Small
 * cans for the engine fluids, because that is how they are sold.
 */
const FLUID_STOCK: readonly { fluid: FluidKind; weight: number; capacity: number }[] = [
  { fluid: 'petrol', weight: 0.65, capacity: 20 },
  { fluid: 'water', weight: 0.19, capacity: 5 },
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

function makeTool(world: GameWorld, poi: Poi, counter: LootCounter): ToolItem {
  const sub = counter.sub++;
  return makeSponge(
    world.generatedPartId('poi_item', poi.index, sub),
    hash01(poi.variantSeed, sub, 41),
  );
}

/**
 * A service part left out front: a boxed air filter on a shop step, a turbocharger or
 * an engine on a pallet at a breaker's yard. Engines come dry, like everything pulled
 * from a wreck, and weathered; filters come new in their box.
 */
function stockPart(
  ctx: ChunkContext,
  poi: Poi,
  yard: Yard,
  loose: LoosePartField,
  counter: LootCounter,
  variantId: string,
  across: number,
  out: number,
): void {
  const sub = counter.sub++;
  const id = ctx.world.generatedPartId('poi_item', poi.index, sub);
  const kind = variant(variantId).kind;
  const salvaged = kind === 'engine' || kind === 'turbine';
  const part: PartInstance = {
    id,
    variantId,
    dirt: salvaged ? 0.3 + hash01(poi.variantSeed, sub, 61) * 0.5 : 0,
    rust: salvaged ? 0.1 + hash01(poi.variantSeed, sub, 62) * 0.4 : 0,
  };
  if (kind === 'air_filter') part.clog = 0;
  const p = yardPoint(ctx, poi, yard, across, out);
  loose.spawn(part, p.x, p.y + (kind === 'engine' ? 0.45 : 0.25), p.z);
}

/**
 * The breaker's-yard finds, by chance per stop: an imported engine to swap in, a
 * turbocharger to bolt on, a new air filter.
 */
function stockSalvageParts(
  ctx: ChunkContext,
  poi: Poi,
  yard: Yard,
  loose: LoosePartField,
  counter: LootCounter,
  engineChance: number,
  turboChance: number,
  filterChance: number,
): void {
  if (hash01(poi.variantSeed, 63) < engineChance) {
    const engineId = pick(IMPORT_ENGINE_IDS, poi.variantSeed, 64);
    stockPart(ctx, poi, yard, loose, counter, engineId, 0.7, 1.7);
  }
  if (hash01(poi.variantSeed, 65) < turboChance) {
    stockPart(ctx, poi, yard, loose, counter, 'turbine_standard', -0.55, 1.5);
  }
  if (hash01(poi.variantSeed, 66) < filterChance) {
    stockPart(ctx, poi, yard, loose, counter, 'air_filter', 0.1, 0.6);
  }
}

/**
 * A spray can left on a bench: any factory colour, rarely full, because a found can
 * is somebody's leftover from a touch-up.
 */
function makeSprayCan(world: GameWorld, poi: Poi, counter: LootCounter): SprayCanItem {
  const sub = counter.sub++;
  return {
    type: 'spray_can',
    id: world.generatedPartId('poi_item', poi.index, sub),
    paint: pick(CAR_PAINTS, poi.variantSeed, 43 + sub).hex,
    charge: 0.45 + hash01(poi.variantSeed, sub, 44) * 0.55,
  };
}

/** What turns up about a yard: a sponge or, as often, a spray can. */
const YARD_FINDS: readonly ('sponge' | 'spray_can')[] = ['sponge', 'spray_can'];

// ---------------------------------------------------------------------------
// Kind builders. Each builds its scenery unconditionally and its loot only when
// `shouldLoot` is set, so an emptied POI keeps its structure but never restocks.
//
// POIs do not shed loose vehicle scrap. Scattering wheels, bumpers and seats down the
// whole road littered the world with things that had to be picked up one by one and
// fitted nowhere. What a stop gives is tools, cans, and the few service parts worth a
// detour (`stockSalvageParts`): an air filter now and then, and at a breaker's yard a
// turbocharger or an imported engine on a pallet. The buried shells carry their own
// salvage instead — worn parts under the bonnet, cans and tools in the boot — laid out
// by `stockWreckLoot` where the field is built.
// ---------------------------------------------------------------------------

/**
 * The strip of ground in front of a building, where everything it gives away is left.
 *
 * None of the buildings can be entered, and loot laid "in the middle of the site" would
 * now be inside a closed shell's collider. So it goes where a person leaves things at a
 * house: by the front, between the wall and the road for a roadside stop. `across` runs
 * -1..1 along the front, `out` is metres beyond the front wall, and the height is the
 * sand itself — the site's plane is fitted under the building, not out here.
 */
interface Yard {
  readonly site: Site;
  readonly halfX: number;
  readonly halfZ: number;
}

/**
 * Deepest the yard reaches beyond the front wall, metres. The wreck field keeps clear
 * of it, and it stops short of where a courier parks: the nearest verge is 10 m, and a
 * courier's flank stands about 10.4 m from the centreline.
 */
const YARD_DEPTH_M = 2.4;

function yardPoint(ctx: ChunkContext, poi: Poi, yard: Yard, across: number, out: number): { x: number; y: number; z: number } {
  const width = Math.min(yard.halfX, 4.5);
  const o = rotateXZ(across * width, -(yard.halfZ + out), yard.site.yaw);
  const x = yard.site.x + o.x;
  const z = yard.site.z + o.z;
  return { x, y: ctx.terrain.heightAt(x, z, poi.s), z };
}

/**
 * Fuel cans part-used rather than factory-sealed, stood in a row by the front wall.
 *
 * The same stock the old gas stop carried: this is where the world's fuel comes from, and
 * the stock roll keeps it coming from as many stops as it ever did.
 */
function stockFluidCans(
  ctx: ChunkContext,
  poi: Poi,
  yard: Yard,
  loose: LoosePartField,
  counter: LootCounter,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const stock = pickFluid(hash01(poi.variantSeed, 31, i));
    // A 20 L fuel can holds 12-20 L; a 5 L fluid can holds 3-5.
    const litres =
      Math.round(stock.capacity * (0.6 + hash01(poi.variantSeed, 32, i) * 0.4) * 10) / 10;
    const can = makeFluidCan(ctx.world, poi, stock.fluid, litres, stock.capacity, counter);
    const c = yardPoint(ctx, poi, yard, -0.95 + i * 0.22, 0.7 + hash01(poi.variantSeed, 34, i) * 0.5);
    loose.spawnItem(can, c.x, c.y + 0.2, c.z);
  }
}

/**
 * One sealed five-piece gum pack. The roadside rescue resource: one per stop that stocks
 * anything a shop would, left on the step.
 */
function stockGum(
  ctx: ChunkContext,
  poi: Poi,
  yard: Yard,
  loose: LoosePartField,
  counter: LootCounter,
): void {
  const spot = yardPoint(ctx, poi, yard, 0.32, 1.0);
  const sub = counter.sub++;
  loose.spawnItem(
    {
      type: 'bubble_gum',
      id: ctx.world.generatedPartId('poi_item', poi.index, sub),
      charges: 5,
    },
    spot.x,
    spot.y + 0.18,
    spot.z,
  );
}

/**
 * A trailer left beside the house. Take one, leave one: they are never owned, so this
 * records a world object rather than giving the player a possession, and `shouldLoot`
 * is what stops a stop growing a new one every reload.
 */
function stockTrailer(
  ctx: ChunkContext,
  poi: Poi,
  yard: Yard,
  trailers: TrailerField,
): void {
  if (hash01(poi.variantSeed, TRAILER_DOMAIN, 0) >= TRAILER_STOP_CHANCE) return;
  // Alongside the right-hand wall, drawbar to the front: clear of the building, of the
  // loot by the front wall, and pointing the way a car would come to take it.
  const o = rotateXZ(yard.halfX + 2.4, -yard.halfZ * 0.4, yard.site.yaw);
  const x = yard.site.x + o.x;
  const z = yard.site.z + o.z;
  const yaw = yard.site.yaw + Math.PI;
  const half = yaw / 2;
  trailers.spawn({
    id: `trailer:${poi.index}`,
    hitchedTo: null,
    cargoKg: 0,
    x,
    // Clear of the ground so it drops onto its own suspension rather than starting
    // inside the terrain trimesh.
    y: ctx.terrain.heightAt(x, z, poi.s) + 0.9,
    z,
    qx: 0,
    qy: Math.sin(half),
    qz: 0,
    qw: Math.cos(half),
  });
}

/** Tools, left about the front of the house. */
function stockTools(
  ctx: ChunkContext,
  poi: Poi,
  yard: Yard,
  loose: LoosePartField,
  counter: LootCounter,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const find = pick(YARD_FINDS, poi.variantSeed, 98 + i);
    const item = find === 'spray_can'
      ? makeSprayCan(ctx.world, poi, counter)
      : makeTool(ctx.world, poi, counter);
    const tp = yardPoint(
      ctx,
      poi,
      yard,
      0.5 + hash01(poi.variantSeed, 99, i) * 0.45,
      0.8 + hash01(poi.variantSeed, 100, i) * (YARD_DEPTH_M - 0.8),
    );
    loose.spawnItem(item, tp.x, tp.y + 0.25, tp.z);
  }
}

/** A medicine pack, left on the step of somebody's home. */
function stockMedicine(
  ctx: ChunkContext,
  poi: Poi,
  yard: Yard,
  loose: LoosePartField,
  counter: LootCounter,
): void {
  const spot = yardPoint(ctx, poi, yard, -0.25, 0.9);
  const sub = counter.sub++;
  loose.spawnItem(
    { type: 'medicine', id: ctx.world.generatedPartId('poi_item', poi.index, sub) },
    spot.x,
    spot.y + 0.2,
    spot.z,
  );
}

/**
 * What a stop pays out, by its STOCK. The counts and chances are the ones each kind of
 * building paid out when the building and the payout were the same thing, so the
 * supply of each resource is what it was: fuel from `fuel` stops, tools from anywhere
 * with a bench, the car field from `salvage`.
 */
function grantStockLoot(
  ctx: ChunkContext,
  poi: Poi,
  yard: Yard,
  loose: LoosePartField,
  trailers: TrailerField,
  counter: LootCounter,
): void {
  switch (poi.stock) {
    case 'fuel':
      // The stop that gets you moving is where you top up: 3-6 cans of fuel and engine
      // fluids, the gum pack, and a trailer better than half the time.
      stockFluidCans(ctx, poi, yard, loose, counter, 3 + Math.floor(hash01(poi.variantSeed, 30) * 4));
      stockGum(ctx, poi, yard, loose, counter);
      stockTrailer(ctx, poi, yard, trailers);
      // A forecourt sells filters.
      if (hash01(poi.variantSeed, 67) < 0.3) {
        stockPart(ctx, poi, yard, loose, counter, 'air_filter', 0.1, 0.6);
      }
      break;
    case 'store':
      stockTools(ctx, poi, yard, loose, counter, 1 + Math.floor(hash01(poi.variantSeed, 96) * 3));
      stockGum(ctx, poi, yard, loose, counter);
      if (hash01(poi.variantSeed, 97) < 0.5) {
        stockFluidCans(ctx, poi, yard, loose, counter, 1 + Math.floor(hash01(poi.variantSeed, 95) * 2));
      }
      if (hash01(poi.variantSeed, 68) < 0.45) {
        stockPart(ctx, poi, yard, loose, counter, 'air_filter', 0.1, 0.6);
      }
      break;
    case 'home':
      // Somebody lived here: a medicine pack, a tool they left out, sometimes a can.
      stockMedicine(ctx, poi, yard, loose, counter);
      if (hash01(poi.variantSeed, 94) < 0.6) stockTools(ctx, poi, yard, loose, counter, 1);
      if (hash01(poi.variantSeed, 93) < 0.35) stockFluidCans(ctx, poi, yard, loose, counter, 1);
      break;
    case 'salvage':
      // Cars are broken down here: the field itself is laid out by `buildWrecks`, and
      // what came out of them stands by the front.
      stockTools(ctx, poi, yard, loose, counter, 1 + Math.floor(hash01(poi.variantSeed, 92) * 2));
      if (hash01(poi.variantSeed, 91) < 0.4) stockFluidCans(ctx, poi, yard, loose, counter, 1);
      stockSalvageParts(ctx, poi, yard, loose, counter, 0.3, 0.2, 0.4);
      break;
    case 'mast':
      // A maintenance site: tools, and the fuel for whatever got you up there.
      stockTools(ctx, poi, yard, loose, counter, 1);
      if (hash01(poi.variantSeed, 90) < 0.5) stockFluidCans(ctx, poi, yard, loose, counter, 1);
      break;
    case 'scrap':
      stockTools(ctx, poi, yard, loose, counter, 1 + Math.floor(hash01(poi.variantSeed, 89) * 2));
      stockSalvageParts(ctx, poi, yard, loose, counter, 0.25, 0.15, 0.3);
      break;
  }
}

/**
 * Which way a building faces: toward the road it stands beside.
 *
 * "Toward the road" is not the road's heading. A building sits off to one side, so the
 * direction it should face is the one that turns its front — authored as -Z — toward the
 * centreline, which is its own lateral offset reversed. The sign convention matches the
 * story house's front (`src/story/site.ts`), which faces the same way for the same reason.
 * A small hash wobble keeps a row of them from looking stamped out.
 *
 * Exported because a bench that measures a building's footprint against the world has to
 * place it the way the game does; `tools/wreck-spacing.ts` is that bench.
 */
export function faceRoadYaw(heading: number, lateral: number, variantSeed: number): number {
  const outward = heading + (lateral >= 0 ? -Math.PI / 2 : Math.PI / 2);
  return outward + Math.PI + (hash01(variantSeed, 7) - 0.5) * 0.16;
}

/**
 * Which way a POI's building faces: toward the road for a roadside stop, and anywhere at
 * all for one out in the desert, which nobody built with the road in mind.
 */
export function poiYaw(poi: Poi, heading: number): number {
  return poi.desert
    ? hash01(poi.variantSeed, 7) * Math.PI * 2
    : faceRoadYaw(heading, poi.lateral, poi.variantSeed);
}

/**
 * How far below the fitted plane a building is pushed, on top of the plane's own residual.
 *
 * The residual already guarantees no float; this is a hand's width of margin so that a
 * single stray face of terrain, below the resolution the plane was fitted at, cannot show
 * a hairline of daylight under a wall.
 */
const SEAT_BURY_MARGIN = 0.08;

/**
 * One stop: a building on the sand, its collider, and its rewards.
 */
function buildStructurePoi(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  loose: LoosePartField,
  trailers: TrailerField,
  wreckTrunks: WreckTrunkField,
  registeredWrecks: string[],
  deferredVisuals: Array<() => void>,
  counter: LootCounter,
  shouldLoot: boolean,
): void {
  const instance: VariantInstance = createStructureInstance(poi.structure);
  const a = anchorXZ(ctx, poi);
  const yaw = poiYaw(poi, a.heading);

  // NO APRON. A building stands on the sand, pushed in far enough that the sand meets
  // its walls wherever the ground rises.
  //
  // The apron was a slab whose top IS the fitted plane, and it was the wrong trade: on
  // ground that varies, a level slab either floats at its low corner or shows its own
  // thickness as a grey box around the building. Measured, the homestead's came out 0.82 m
  // deep, which is a plinth, and a plinth is worse than the gap it replaced.
  //
  // What is left is what a building on uneven ground actually is. The site is one plane
  // fitted to the ground under the whole footprint, the building is TILTED onto that plane
  // so its base follows the slope, and it is then SUNK by the plane's own `residual` —
  // measured at 0.22-0.44 m across the catalogue — which is by definition the most any
  // point of ground under it can rise above the plane. So no wall can ever stand on air,
  // and none of it stands on anything man-made.
  const halfX = instance.halfExtentX;
  const halfZ = instance.halfExtentZ;
  // Fitted over the larger of the measured bounds and the authored footprint: a mast
  // compound's measured bounds stop at its masts, and the guy anchors, the hut's step and
  // the cable runs past them still have to meet the sand.
  const site = siteAt(ctx, poi, a, yaw, Math.max(halfX, instance.footprint[0] / 2), Math.max(halfZ, instance.footprint[1] / 2));
  const seatY = site.plane.centreY - site.plane.residual - SEAT_BURY_MARGIN;

  const at = sitePoint(site, 0, 0);
  at.y = seatY;
  instance.group.position.set(at.x - ctx.originX, at.y, at.z - ctx.originZ);
  instance.group.rotation.set(site.plane.pitch, yaw, site.plane.roll, 'YXZ');
  instance.group.updateMatrixWorld(true);
  group.add(instance.group);

  if (ctx.hasPhysics) {
    const matrix = poseMatrix(
      at.x,
      at.y,
      at.z,
      yaw,
      site.plane.roll,
      site.plane.pitch,
      ctx.originX,
      ctx.originZ,
    );
    const trimesh = geometryToTrimesh(instance.solid, matrix);
    if (trimesh.indices.length > 0) {
      const collider = ctx.physics.addStaticTrimesh(
        trimesh.vertices,
        trimesh.indices,
        SurfaceType.Concrete,
      );
      colliders.push(collider);
      const parent = collider.parent();
      if (parent) bodies.push(parent);
    }
  }

  // The car field. Every roadside stop has one — mostly shells to strip for parts —
  // and a desert stop only when it is a scrapyard. `buildWrecks` places its cars around
  // the POI's own anchor, which is exactly where this building stands, so it is handed
  // the footprint to lay out around.
  if (!poi.desert || poi.stock === 'salvage') {
    buildWrecks(
      ctx,
      poi,
      group,
      bodies,
      colliders,
      wreckTrunks,
      registeredWrecks,
      deferredVisuals,
      salvageKeepOut(poi, ctx.road, instance),
      shouldLoot,
    );
  }

  if (shouldLoot) {
    grantStockLoot(ctx, poi, { site, halfX, halfZ }, loose, trailers, counter);
  }
}

/**
 * The rectangle a salvage stop's car field lays out around: the building where it
 * stands, deepened by the yard so no car is parked on the loot. Exported so
 * `tools/wreck-spacing.ts` measures the very keep-out the world uses.
 */
export function salvageKeepOut(poi: Poi, road: Road, instance: VariantInstance): WreckKeepOut {
  const centre = road.offsetPoint(poi.s, poi.lateral);
  return {
    x: centre.x,
    z: centre.z,
    yaw: poiYaw(poi, road.sampleAt(poi.s).heading),
    halfX: instance.halfExtentX,
    halfZ: instance.halfExtentZ + YARD_DEPTH_M,
  };
}

function buildPoi(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  deferredVisuals: Array<() => void>,
  loose: LoosePartField,
  trailers: TrailerField,
  wreckTrunks: WreckTrunkField,
  registeredWrecks: string[],
): void {
  const counter: LootCounter = { sub: 0 };
  const shouldLoot = ctx.hasPhysics && !ctx.world.state.lootedPois.includes(poi.index);

  buildStructurePoi(
    ctx,
    poi,
    group,
    bodies,
    colliders,
    loose,
    trailers,
    wreckTrunks,
    registeredWrecks,
    deferredVisuals,
    counter,
    shouldLoot,
  );

  // Record that this POI's loot is now materialised. The flag alone is the whole
  // idempotency guard across chunk promotion / unload / reload.
  if (shouldLoot) ctx.world.apply({ t: 'poi_looted', poiIndex: poi.index });
}


// Couriers are their own sparse POIs. The sequence is random-access and every
// adjacent pair is 5–12 km apart, independent of ordinary POI density.
function buildCourier(
  ctx: ChunkContext,
  stop: CourierStop,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  courierField: CourierField,
  registeredCouriers: string[],
  dancers: DancerField,
  registeredDancers: DancerHandle[],
  deferredVisuals: Array<() => void>,
): void {
  const def = pick(COURIER_MODELS, stop.appearanceSeed);
  const measure = carModelMeasure(def.id);
  const half = measure.halfExtents;
  const road = ctx.road.sampleAt(stop.s);
  const point = ctx.road.offsetPoint(stop.s, stop.lateral);
  const yaw = road.heading + (hash01(stop.appearanceSeed, 1) - 0.5) * 0.16;
  // A parked car sits ALONG the slope it is parked on. One centre sample used to
  // leave half a metre of air under the downhill wheels on this ground.
  const plane = fitGround(ctx.terrain, point.x, point.z, yaw, half[0], half[2], stop.s);
  point.y = plane.centreY;
  const originY = point.y + half[1] - 0.02;
  const id = courierId(stop.index);
  const matrix = poseMatrix(
    point.x,
    originY,
    point.z,
    yaw,
    plane.roll,
    plane.pitch,
    ctx.originX,
    ctx.originZ,
  );
  const addModel = (): void => {
    const model = createCourierCarModel(def.id, id);
    setFromMatrix(model, matrix);
    group.add(model);
  };
  if (isCarModelLoaded(def.id)) {
    addModel();
  } else {
    let cancelled = false;
    deferredVisuals.push(() => {
      cancelled = true;
    });
    void loadCarModel(def.id).then(
      () => {
        if (!cancelled) addModel();
      },
      (error: unknown) => {
        console.error(`failed to load courier car model "${def.id}"`, error);
      },
    );
  }

  const collider = addStaticCollider(
    ctx,
    new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
    matrix,
    SurfaceType.Rock,
    bodies,
    colliders,
  );
  if (!collider) return;
  const rotation = new THREE.Quaternion().setFromRotationMatrix(matrix);
  courierField.register({
    id,
    index: stop.index,
    modelId: def.id,
    x: point.x,
    y: originY,
    z: point.z,
    qx: rotation.x,
    qy: rotation.y,
    qz: rotation.z,
    qw: rotation.w,
    halfExtents: half,
    defaultStorage: courierDefaultStorage(ctx.world.seed, stop.index, (fromS, toS) =>
      photoSubjects(ctx.world.seed, fromS, toS, poisBetween(ctx.world.seed, fromS, toS)),
    ),
  });
  registeredCouriers.push(id);

  // The air dancer advertising the stop. It stands on the POI side of the car, a
  // couple of metres off its flank so it is visible from the lane and never in it,
  // and is turned to face the road. Its ground is the LOWEST of the blower's own
  // footprint, so no corner of the box floats on ground that is only nearly flat.
  const side = stop.lateral < 0 ? -1 : 1;
  const dancerS = stop.s + DANCER_ALONG_M;
  const dancerPoint = ctx.road.offsetPoint(dancerS, stop.lateral + side * DANCER_OUT_M);
  let dancerY = ctx.terrain.heightAt(dancerPoint.x, dancerPoint.z, dancerS);
  for (const corner of DANCER_FOOTPRINT_CORNERS) {
    const h = ctx.terrain.heightAt(
      dancerPoint.x + corner[0],
      dancerPoint.z + corner[1],
      dancerS,
    );
    if (h < dancerY) dancerY = h;
  }
  const roadCentre = ctx.road.offsetPoint(dancerS, 0);
  registeredDancers.push(
    dancers.spawn(group, {
      x: dancerPoint.x,
      y: dancerY - DANCER_SINK_M,
      z: dancerPoint.z,
      yaw: Math.atan2(roadCentre.x - dancerPoint.x, roadCentre.z - dancerPoint.z),
      seed: stop.appearanceSeed,
      originX: ctx.originX,
      originZ: ctx.originZ,
    }),
  );
}

/** Blower-box corners, metres from its centre, the dancer is planted on. */
const DANCER_FOOTPRINT_CORNERS: readonly (readonly [number, number])[] = [
  [-0.4, -0.4],
  [0.4, -0.4],
  [-0.4, 0.4],
  [0.4, 0.4],
];
/** Sunk this far under that lowest corner, so the seam never shows air. */
const DANCER_SINK_M = 0.03;
/**
 * Fraction of roadside wreck fields containing one working car. The roll is per
 * field, not per shell: most stops are wrecks only, while roughly one in three has
 * exactly one roadworthy car parked among them.
 */
const WORKING_CAR_CHANCE = 0.34;
/**
 * Same, at an ordinary roadside stop: every one of them has shells to strip now, and
 * only now and then a car to take. The first two stops always have one
 * (`Poi.guaranteedCar`).
 */
const ROADSIDE_WORKING_CAR_CHANCE = 0.2;
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
  const carId = ctx.world.generatedPartId('poi-car', poi.index, slot);
  // A roadside find has been driven, and its air filter shows it: anywhere from
  // freshly changed to well overdue, so some finds want a filter before a long leg.
  const bonnet = createBonnetStorage(
    carId,
    def.engineId,
    def.bodyClass,
    def.tankLitres,
    0.1 + hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 9) * 0.85,
  );
  return {
    id: carId,
    modelId: def.id,
    headlightMode: 'off',
    taillightsOn: false,
    reverseLightsOn: false,
    stickers: [],
    // A roadside find, weathered by however long it stood there. Scratched enough to
    // say somebody else drove it badly, not enough to look like salvage.
    dirt: 0.7 + hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 7) * 0.25,
    scratches: 0.25 + hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 8) * 0.3,
    paint: null,
    // Enough fuel to make the find immediately useful, but not a free full tank.
    fuelLitres: def.tankLitres * (0.15 + hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 3) * 0.2),
    // Part-topped, like the fuel: enough water to set off, little enough that a hot
    // afternoon makes the level worth a look before a long leg.
    waterLitres:
      bonnetWaterCapacity(bonnet) * (0.45 + hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 10) * 0.4),
    oilLitres: engine ? oilCapacity(engine) : 0,
    // Stood by the road for months: at air temperature, not at operating heat.
    engineTempC: COLD_SOAK_C,
    storage: new Array(def.storageCells).fill(null),
    bonnet,
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
 * Layout of one roadside wreck field.
 *
 * The old placement drew each body's offsets independently — ±8 m of arclength and
 * ±6 m of lateral — which says nothing about where the previous body went, so two
 * 4.6 m cars landing 1 m apart was a routine roll rather than bad luck. Three of
 * them in a 16x12 m window collide most of the time, and a static shell is a solid
 * box collider, so the result was a car standing inside another car.
 *
 * So a slot is now REJECTION-SAMPLED: candidates come off the same deterministic hash
 * stream with the attempt index mixed in, and the first one that clears everything by
 * WRECK_CLEARANCE_M is taken.
 *
 * AND IT CLEARS THE BUILDING. The building at a stop stands on the POI's OWN anchor
 * (`siteAt` is given the POI's `s` and `lateral`), so a field laid out blind runs
 * through its walls — measured by `tools/wreck-spacing.ts` over 219 container stops,
 * 62.1% put a body inside the building's measured footprint, the deepest 2.53 m in, and
 * at a stop that rolls the roadworthy find the body inside the wall is the car itself.
 * So the caller hands the layout the building (`WreckKeepOut`) and it is one more term in
 * the same margin.
 *
 * WHEN NOTHING CLEARS, A LATTICE FINISHES THE JOB. Accepting the roomiest draw however
 * deep it sat was survivable in an empty field and is not one with a 12 m building on
 * its anchor. So a slot that the stream cannot place takes the first position on a
 * WRECK_LATTICE_STEP_M lattice over the same field that clears everything. If even that
 * finds none — three lorries asked to share one field — the roomiest lattice position is
 * taken, so a field still always lays out, never loops, and an impossible one is as far
 * from every neighbour as the ground allows.
 *
 * Separation uses each body's CIRCUMSCRIBED footprint radius, so the test holds at
 * whatever yaw, roll and sink the slot draws afterwards. Body-to-body distance is
 * measured in (arclength, lateral) road coordinates; over a 25 m field the road's
 * curvature moves that by centimetres. The building is NOT approximated that way: it is
 * a real object in the world, so the keep-out test places each candidate on the road and
 * measures it against the building where it actually stands. Doing it in the field's flat
 * frame left a body 0.28 m inside a wall on a curve, which is what the bench caught.
 *
 * The whole field is laid out before anything is built, so a slot's position cannot
 * depend on whether an earlier working car has already been driven away.
 */
const WRECK_CLEARANCE_M = 1.4;
/**
 * Metres of road the field is strung along, and its lateral spread, round an empty
 * anchor. With a building on the anchor the field is lengthened along the road by the
 * building's own size, so the cars stand beside it rather than being asked to fit in a
 * 26 m window a 25 m house already fills.
 */
const WRECK_S_SPREAD = 26;
const WRECK_LAT_SPREAD = 12;
/** Candidate draws per slot before the lattice takes over. */
const WRECK_PLACEMENT_ATTEMPTS = 48;
/** Lattice spacing the fallback searches the field at, metres. */
const WRECK_LATTICE_STEP_M = 1;

export interface WreckSlot {
  readonly def: CarModelDef;
  /** Footprint radius, metres: yaw-independent, so the gap holds at any pose. */
  readonly radius: number;
  readonly sDelta: number;
  readonly latDelta: number;
}

/**
 * The building a field must lay out around: where it stands, which way it faces, and its
 * measured half extents in its own frame, in world XZ.
 *
 * A rectangle is the only shape that fits — the circumscribed disc of a 12 x 10 m
 * building is 7.8 m in radius and covers the field's whole 12 m lateral spread, so no
 * field would lay out at all. The half extents are the measured ones the site fit and the
 * collider already use, and they CONTAIN the merged solid the collider is cut from
 * (roofs widen the bounds and are excluded from the trimesh), so clearing them clears the
 * wall the player hits.
 */
export interface WreckKeepOut {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly halfX: number;
  readonly halfZ: number;
}

export function layOutWreckField(poi: Poi, road: Road, keepOut?: WreckKeepOut): WreckSlot[] {
  const sSpread = WRECK_S_SPREAD + (keepOut ? 2 * Math.max(keepOut.halfX, keepOut.halfZ) : 0);
  // A scrapyard strings 1..3 bodies round its yard; any other stop 1..2.
  const count = 1 + Math.floor(hash01(poi.variantSeed, 10) * (poi.stock === 'salvage' ? 3 : 2));
  const slots: WreckSlot[] = [];

  for (let w = 0; w < count; w++) {
    const def: CarModelDef = pick(CAR_MODELS, poi.variantSeed, w, 10);
    const half = carModelMeasure(def.id).halfExtents;
    const radius = Math.hypot(half[0], half[2]);

    // A candidate's margin is the smaller of its gap off the building and its gap to
    // every body already placed.
    const marginAt = (sDelta: number, latDelta: number): number => {
      let margin = Infinity;
      if (keepOut) {
        // Distance to the building's oriented rectangle: negative inside it. The
        // rotation is the inverse of `rotateXZ`, the convention the whole placement
        // shares — local (x, z) maps to world (c·x + s·z, -s·x + c·z).
        const point = road.offsetPoint(poi.s + sDelta, poi.lateral + latDelta);
        const c = Math.cos(keepOut.yaw);
        const s = Math.sin(keepOut.yaw);
        const dx = point.x - keepOut.x;
        const dz = point.z - keepOut.z;
        const lx = c * dx - s * dz;
        const lz = s * dx + c * dz;
        margin =
          Math.hypot(
            Math.max(Math.abs(lx) - keepOut.halfX, 0),
            Math.max(Math.abs(lz) - keepOut.halfZ, 0),
          ) - radius;
      }
      for (const other of slots) {
        const gap =
          Math.hypot(sDelta - other.sDelta, latDelta - other.latDelta) - radius - other.radius;
        if (gap < margin) margin = gap;
      }
      return margin;
    };

    let chosen = { sDelta: 0, latDelta: 0, margin: -Infinity };
    for (let attempt = 0; attempt < WRECK_PLACEMENT_ATTEMPTS; attempt++) {
      const sDelta = (hash01(poi.variantSeed, w, 11, attempt) - 0.5) * sSpread;
      const latDelta = (hash01(poi.variantSeed, w, 12, attempt) - 0.5) * WRECK_LAT_SPREAD;
      const margin = marginAt(sDelta, latDelta);
      if (margin > chosen.margin) chosen = { sDelta, latDelta, margin };
      if (margin >= WRECK_CLEARANCE_M) break;
    }

    // Nothing in the stream cleared: walk a lattice over the same field and take the first
    // position that does, or the roomiest one if even that finds none.
    if (chosen.margin < WRECK_CLEARANCE_M) {
      let settled = false;
      for (
        let sDelta = -sSpread / 2;
        sDelta <= sSpread / 2 && !settled;
        sDelta += WRECK_LATTICE_STEP_M
      ) {
        for (
          let latDelta = -WRECK_LAT_SPREAD / 2;
          latDelta <= WRECK_LAT_SPREAD / 2;
          latDelta += WRECK_LATTICE_STEP_M
        ) {
          const margin = marginAt(sDelta, latDelta);
          if (margin > chosen.margin) chosen = { sDelta, latDelta, margin };
          if (margin >= WRECK_CLEARANCE_M) {
            settled = true;
            break;
          }
        }
      }
    }

    slots.push({ def, radius, sDelta: chosen.sDelta, latDelta: chosen.latDelta });
  }
  return slots;
}

/**
 * A half-buried shell still carries salvage.
 *
 * The bonnet keeps its five service cells, but not necessarily filled: an engine is
 * the likeliest find, the radiator, tank and air filter each take their own roll, and
 * the factory-optional turbocharger is the rarest. Engines are usually the Soviet units
 * a body of that class was built around, but an import a breaker pulled turns up
 * occasionally. Parts come out WORN — dust, rust, a clogged element — because the car
 * has stood in the sand long enough to be a wreck, not because the find is worthless.
 *
 * The boot holds what a driver leaves in a car: cans, a tool, a spray can, medicine,
 * gum. Never a sticker or a courier envelope — those belong to the delivery economy and
 * to the cars the player actually drives.
 *
 * Every roll is seeded from the POI and the slot, so a given wreck yields the same
 * contents on every pass; the guard that keeps an emptied POI empty (`poi_looted`) is
 * what stops the world restocking it.
 */
/** Chance each bonnet cell (in `BONNET_SLOT_KINDS` order) still holds its part. */
const WRECK_BONNET_FILL: readonly number[] = [0.55, 0.15, 0.45, 0.4, 0.5];
/** Of the wrecks that kept an engine, this share kept an import instead. */
const WRECK_IMPORT_ENGINE_CHANCE = 0.18;
/** Chance each of a wreck's sixteen boot cells holds a find. */
const WRECK_TRUNK_FILL_CHANCE = 0.24;

type WreckFind =
  | 'petrol_can'
  | 'water_can'
  | 'oil_can'
  | 'sponge'
  | 'medicine'
  | 'gum'
  | 'spray_can';

/**
 * What a wreck's boot yields, by weight: the fluids a stranded driver needed, the two
 * cleaning tools, and the small odds and ends a glovebox holds.
 */
const WRECK_TRUNK_FINDS: readonly { readonly find: WreckFind; readonly weight: number }[] = [
  { find: 'petrol_can', weight: 0.3 },
  { find: 'water_can', weight: 0.1 },
  { find: 'oil_can', weight: 0.1 },
  { find: 'sponge', weight: 0.2 },
  { find: 'medicine', weight: 0.08 },
  { find: 'gum', weight: 0.1 },
  { find: 'spray_can', weight: 0.12 },
];

/** A part pulled from a shell, worn the way a find in the sand is. */
function wreckPartItem(
  world: GameWorld,
  poi: Poi,
  wreckIndex: number,
  slot: number,
  variantId: string,
): PartItem {
  const id = world.generatedPartId('wreck-part', poi.index, wreckIndex * 32 + slot);
  const part: PartInstance = {
    id,
    variantId,
    dirt: 0.35 + hash01(poi.variantSeed, wreckIndex, 220 + slot) * 0.45,
    rust: 0.15 + hash01(poi.variantSeed, wreckIndex, 230 + slot) * 0.4,
  };
  if (variant(variantId).kind === 'air_filter') {
    // Filtered a lot of desert before the car stopped: worn past the point it would
    // run well, which is why a wreck's filter is worth taking and cleaning, not using.
    part.clog = 0.5 + hash01(poi.variantSeed, wreckIndex, 240 + slot) * 0.7;
  }
  return { type: 'part', id, part };
}

/** An engine the wreck's body class could have carried; imports are the rare draw. */
function wreckEngineVariant(
  poi: Poi,
  wreckIndex: number,
  bodyClass: BodyClass,
): string | null {
  const fitted = variantsOfKind('engine', bodyClass);
  if (fitted.length === 0) return null;
  const imports = fitted.filter((candidate) => IMPORT_ENGINE_IDS.includes(candidate.id));
  if (imports.length > 0 && hash01(poi.variantSeed, wreckIndex, 216) < WRECK_IMPORT_ENGINE_CHANCE) {
    return pick(imports, poi.variantSeed, wreckIndex, 217).id;
  }
  const domestic = fitted.filter((candidate) => !IMPORT_ENGINE_IDS.includes(candidate.id));
  return pick(domestic.length > 0 ? domestic : fitted, poi.variantSeed, wreckIndex, 218).id;
}

/** One boot find, with its own stable id. */
function makeWreckItem(
  ctx: ChunkContext,
  poi: Poi,
  wreckIndex: number,
  cell: number,
): Item {
  const id = ctx.world.generatedPartId('wreck-item', poi.index, wreckIndex * 32 + 16 + cell);
  const roll = hash01(poi.variantSeed, wreckIndex, 260 + cell);
  let find = WRECK_TRUNK_FINDS[WRECK_TRUNK_FINDS.length - 1]!.find;
  let acc = 0;
  for (const entry of WRECK_TRUNK_FINDS) {
    acc += entry.weight;
    if (roll < acc) {
      find = entry.find;
      break;
    }
  }
  switch (find) {
    case 'petrol_can':
    case 'water_can':
    case 'oil_can': {
      const fluid: FluidKind = find === 'petrol_can' ? 'petrol' : find === 'water_can' ? 'water' : 'oil';
      // A stranded car's can is part-used, never sealed: 3-5 L of the small fluids,
      // 6-20 L of petrol.
      const capacity = fluid === 'petrol' ? 20 : 5;
      const litres =
        Math.round(capacity * (0.3 + hash01(poi.variantSeed, wreckIndex, 270 + cell) * 0.65) * 10) / 10;
      return { type: 'fluid_can', id, fluid, capacity, litres };
    }
    case 'sponge':
      // Somebody used it on this car once: half to nearly all of its life left.
      return makeSponge(
        id,
        hash01(poi.variantSeed, wreckIndex, 281 + cell),
        0.5 + hash01(poi.variantSeed, wreckIndex, 280 + cell) * 0.5,
      );
    case 'medicine':
      return { type: 'medicine', id };
    case 'gum':
      return {
        type: 'bubble_gum',
        id,
        charges: 1 + Math.floor(hash01(poi.variantSeed, wreckIndex, 290 + cell) * 4),
      };
    case 'spray_can':
      return {
        type: 'spray_can',
        id,
        paint: pick(CAR_PAINTS, poi.variantSeed, wreckIndex, 300 + cell).hex,
        charge: 0.25 + hash01(poi.variantSeed, wreckIndex, 310 + cell) * 0.6,
      };
  }
}

/** Writes one shell's bonnet and boot contents into the world state, in one delta. */
function stockWreckLoot(
  ctx: ChunkContext,
  poi: Poi,
  wreckId: string,
  wreckIndex: number,
  bodyClass: BodyClass,
): void {
  const bonnet = new Array<Item | null>(BONNET_SLOT_COUNT).fill(null);
  for (let cell = 0; cell < BONNET_SLOT_KINDS.length; cell++) {
    if (hash01(poi.variantSeed, wreckIndex, 120 + cell) >= WRECK_BONNET_FILL[cell]!) continue;
    const kind = BONNET_SLOT_KINDS[cell]!;
    let variantId: string | null;
    if (kind === 'engine') {
      variantId = wreckEngineVariant(poi, wreckIndex, bodyClass);
    } else {
      const fitted = variantsOfKind(kind, bodyClass);
      variantId = fitted.length === 0 ? null : pick(fitted, poi.variantSeed, wreckIndex, 250 + cell).id;
    }
    if (variantId === null) continue;
    bonnet[cell] = wreckPartItem(ctx.world, poi, wreckIndex, cell, variantId);
  }
  const trunk = new Array<Item | null>(TRUNK_CELL_COUNT).fill(null);
  for (let cell = 0; cell < TRUNK_CELL_COUNT; cell++) {
    if (hash01(poi.variantSeed, wreckIndex, 200 + cell) >= WRECK_TRUNK_FILL_CHANCE) continue;
    trunk[cell] = makeWreckItem(ctx, poi, wreckIndex, cell);
  }
  ctx.world.apply({ t: 'wreck_loot', wreckId, bonnet, trunk });
}

/**
 * One to three complete models scattered through a roadside wreck field, and rarely
 * one upright slot that is a working car instead of a shell. Both draw from the
 * whole catalogue: a wreck is a state a body is found in, not a class of body, so
 * the same car you can drive is the one you find sunk in the sand beside it.
 */
function buildWrecks(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  wreckTrunks: WreckTrunkField,
  registeredWrecks: string[],
  deferredVisuals: Array<() => void>,
  keepOut: WreckKeepOut,
  /** Whether this POI's loot is being materialised for the first time. */
  shouldLoot: boolean,
): void {
  const anchor = anchorXZ(ctx, poi);
  const ox = ctx.originX;
  const oz = ctx.originZ;
  const slots = layOutWreckField(poi, ctx.road, keepOut);
  const count = slots.length;

  const workingChance = poi.stock === 'salvage' ? WORKING_CAR_CHANCE : ROADSIDE_WORKING_CAR_CHANCE;
  const hasWorkingCar =
    poi.guaranteedCar === true || hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 0) < workingChance;
  const workingSlot = hasWorkingCar
    ? Math.floor(hash01(poi.variantSeed, WORKING_CAR_DOMAIN, 1) * count)
    : -1;

  for (let w = 0; w < count; w++) {
    const isWorkingCar = w === workingSlot;
    const def = slots[w]!.def;
    const measure = carModelMeasure(def.id);
    const half = measure.halfExtents;
    const carId = ctx.world.generatedPartId('poi-car', poi.index, w);

    // A generated working car stays in world state after it is driven away. Never
    // rebuild a shell or a second car at its original POI.
    if (isWorkingCar && ctx.world.state.cars[carId]) continue;

    const { sDelta, latDelta } = slots[w]!;
    const p = groundPoint(ctx, poi, sDelta, latDelta);

    const yawRoll = hash01(poi.variantSeed, w, 13);
    let yaw = anchor.heading + (hash01(poi.variantSeed, w, 14) - 0.5) * 0.6;
    if (!isWorkingCar) {
      if (yawRoll < 0.32) yaw += Math.PI;
      else if (yawRoll > 0.82) {
        yaw += (hash01(poi.variantSeed, w, 15) < 0.5 ? 1 : -1) * Math.PI * 0.5;
      }
    }

    // The shell lies ALONG the ground and then adds its own derelict lean; the
    // fitted plane is what stops a body bridging a dune face on two wheels.
    const plane = fitGround(ctx.terrain, p.x, p.z, yaw, half[0], half[2], poi.s);
    const sink = isWorkingCar ? 0.02 : 0.25 + hash01(poi.variantSeed, w, 16) * half[1] * 0.5;
    const roll = plane.roll + (isWorkingCar ? 0 : (hash01(poi.variantSeed, w, 17) - 0.5) * 0.3);
    const pitch = plane.pitch + (isWorkingCar ? 0 : (hash01(poi.variantSeed, w, 18) - 0.5) * 0.22);
    const originY = plane.centreY + half[1] - sink;

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
    const addShell = (): void => {
      const shell = createStaticCarModel(def.id, carId);
      setFromMatrix(shell, matrix);
      group.add(shell);
    };
    if (isCarModelLoaded(def.id)) {
      addShell();
    } else {
      let cancelled = false;
      deferredVisuals.push(() => {
        cancelled = true;
      });
      void loadCarModel(def.id).then(
        () => {
          if (!cancelled) addShell();
        },
        (error: unknown) => {
          console.error(`failed to load static car model "${def.id}"`, error);
        },
      );
    }

    // A box approximates a static shell well enough for a solid obstacle.
    const collider = addStaticCollider(
      ctx,
      new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
      matrix,
      SurfaceType.Rock,
      bodies,
      colliders,
    );
    const rotation = new THREE.Quaternion().setFromRotationMatrix(matrix);
    if (!isWorkingCar && collider) {
      wreckTrunks.register({
        id: carId,
        modelId: def.id,
        x: p.x,
        y: originY,
        z: p.z,
        qx: rotation.x,
        qy: rotation.y,
        qz: rotation.z,
        qw: rotation.w,
        halfExtents: half,
      });
      registeredWrecks.push(carId);
      // The shell only takes loot the first time it is built: `poi_looted` is what
      // keeps an emptied wreck empty across every later chunk rebuild.
      if (shouldLoot) stockWreckLoot(ctx, poi, carId, w, def.bodyClass);
    }
  }
}

/** Fraction of fuel stops with a trailer left beside the house. */
const TRAILER_STOP_CHANCE = 0.45;
/** Domain tag for the trailer roll. */
const TRAILER_DOMAIN = 0x54524c31; // 'TRL1'

/**
 * Builds roadside and desert stops plus the sparse courier network. Static trunk
 * registries exist only for the live physics band; their edited contents remain in
 * WorldState.
 */
export class PoiProvider implements ChunkProvider {
  readonly id = 'poi';

  constructor(
    private readonly loose: LoosePartField,
    private readonly trailers: TrailerField,
    private readonly wreckTrunks: WreckTrunkField,
    private readonly couriers: CourierField,
    private readonly roadDistance: RoadDistance,
    private readonly dancers: DancerField,
  ) {}

  build(ctx: ChunkContext): ChunkContent | null {
    const spacing = POI_SPACING;
    const pois = poisBetween(ctx.world.seed, ctx.sStart, ctx.sEnd, spacing);
    const desert = desertPoisBetween(ctx.world.seed, ctx.sStart, ctx.sEnd, spacing).filter(
      (poi) =>
        desertPoiClearOfRoad(poi, ctx.road, this.roadDistance) &&
        desertPoiClearOfNeighbours(poi, ctx.world.seed, spacing, ctx.road),
    );

    const group = new THREE.Group();
    group.name = 'poi';
    const bodies: RAPIER.RigidBody[] = [];
    const colliders: RAPIER.Collider[] = [];
    const deferredVisuals: Array<() => void> = [];
    const registeredWrecks: string[] = [];
    const registeredCouriers: string[] = [];
    const registeredDancers: DancerHandle[] = [];

    for (const poi of [...pois, ...desert]) {
      buildPoi(
        ctx,
        poi,
        group,
        bodies,
        colliders,
        deferredVisuals,
        this.loose,
        this.trailers,
        this.wreckTrunks,
        registeredWrecks,
      );
    }
    for (const stop of couriersBetween(ctx.world.seed, ctx.sStart, ctx.sEnd, POI_SPACING)) {
      const courierPoi = pois.find((poi) => poi.s === stop.s);
      if (!courierPoi) continue;
      buildCourier(
        ctx,
        {
          ...stop,
          lateral: courierParkingLateral(courierPoi.lateral),
        },
        group,
        bodies,
        colliders,
        this.couriers,
        registeredCouriers,
        this.dancers,
        registeredDancers,
        deferredVisuals,
      );
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        this.wreckTrunks.forget(registeredWrecks);
        this.couriers.forget(registeredCouriers);
        this.dancers.forget(registeredDancers);
        for (const cancel of deferredVisuals) cancel();
      },
    };
  }
}
