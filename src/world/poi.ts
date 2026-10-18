import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { hash, hash01, pick } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { ROAD_LENGTH, type Road } from './road';
import type { MarketField } from './market';
import { buildVendingMachine, vendingAssortment } from './vending';
import { buildLotSign, lotOffer, makeLotCar } from './carlot';
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
import type { TrailerField } from '../vehicle/trailer';
import type { WreckTrunkField } from './wrecktrunks';
import { courierDefaultStorage } from '../contracts/offers';
import {
  courierId,
  courierParkingLateral,
  couriersBetween,
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
import { mesaFieldOf } from './mesas';
import type { RoadDistance } from './roaddistance';
import type { Terrain } from './terrain';
import type { VariantInstance } from './poivariantbuild';
import { createStructureInstance, structureDef } from './poistructures';
import { POI_SPACING, roadsideSlot, rollStructure, type PoiStock } from './poislots';
import { laybyCourierLateral, laybyNear, laybyOuterAt } from './layby';

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
 * WHAT STANDS THERE AND WHAT IT IS FOR ARE TWO ROLLS. The building is drawn from
 * `POI_STRUCTURES` (world/poistructures.ts); what kind of stop it is — fuel, store,
 * home, a salvage field — is its `PoiStock`, rolled separately. Nothing lies about a
 * stop for the taking: what a stop offers is sold (economy plan).
 *
 * A stop's world objects (a trailer, a car field's cars) are materialised exactly
 * once, keyed by `Poi.index`. `poi_looted` is the idempotency guard: on any later
 * rebuild that generation is skipped entirely.
 */

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
 * Where the desert population's identities live in `lootedPois` (the roadside one's
 * base is in world/poislots.ts).
 *
 * Both are offset past anything a save written before the dwellings could hold: those
 * saves recorded the old buildings' slot indices, and the loot they left behind was laid
 * INSIDE buildings that now stand as closed shells. A fresh index gives every stop in an
 * old save its loot again, outside, instead of none.
 */
const DESERT_INDEX_BASE = 60_000_000;


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
 * One roadside slot, resolved: null when it is empty desert. The roll itself is
 * world/poislots.ts, shared with the lay-bys; what is added here is the offset this
 * PARTICULAR building needs: the asphalt half width at this arclength, plus the verge,
 * plus the building's own half-extent. The AUTHORED footprint is used rather than a
 * measured one because this is pure and cheap by contract — `poisBetween` resolves a
 * stretch of road without building a single triangle.
 */
function roadsidePoi(seed: number, slot: number, spacing: number): Poi | null {
  const roll = roadsideSlot(seed, slot, spacing);
  if (!roll) return null;
  return {
    index: roll.index,
    s: roll.s,
    lateral: roll.side * (halfWidthAt(seed, roll.s) + roll.verge + halfStructure(roll.structure)),
    structure: roll.structure,
    stock: roll.stock,
    desert: false,
    variantSeed: roll.variantSeed,
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
 * Whether a desert POI's spot is off every roadside landform (`landforms.ts`). A
 * building wants level ground, and a basin wall or the flank of a gap is a quarter
 * of slope; like a lake basin, it simply has no building on it.
 */
function desertPoiClearOfLandforms(poi: Poi, road: Road, terrain: Terrain): boolean {
  const point = road.offsetPoint(poi.s, poi.lateral);
  return !terrain.landforms.covers(point.x, point.z, poi.s, radiusStructure(poi.structure));
}

/**
 * Clear ground between a desert building's corner radius and a mesa's footprint,
 * metres. More than the building: its yard (the parked car, a spare trailer, the lot)
 * spreads tens of metres round it, and none of that belongs inside the rock either.
 */
const DESERT_MESA_CLEARANCE_M = 40;

/** Whether a desert POI's yard stays out of every mesa (`world/mesas.ts`). */
function desertPoiClearOfMesas(poi: Poi, road: Road, terrain: Terrain): boolean {
  const point = road.offsetPoint(poi.s, poi.lateral);
  return !mesaFieldOf(road, terrain).blocks(
    point.x,
    point.z,
    radiusStructure(poi.structure) + DESERT_MESA_CLEARANCE_M,
  );
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

// ---------------------------------------------------------------------------
// Kind builders. Each builds its scenery unconditionally and its world objects only
// when `shouldLoot` is set, so a stop built once never builds them again.
//
// NOTHING LIES ABOUT A STOP FOR THE TAKING (economy plan): no cans, tools, gum,
// medicine or parts by the front wall, and the buried shells' bonnets and boots are
// empty. Fuel, fluids and parts are bought at a stop's vending machine.
// ---------------------------------------------------------------------------

/**
 * The strip of ground around a building where its vending machine stands.
 *
 * None of the buildings can be entered, so a machine stands where a person would put one
 * at a house: by a wall, on the sand, its back a hand's width off it (`machineSpot`).
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
 * One stop: a building on the sand, its collider, and its car field.
 */
function buildStructurePoi(
  ctx: ChunkContext,
  poi: Poi,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  trailers: TrailerField,
  wreckTrunks: WreckTrunkField,
  registeredWrecks: string[],
  deferredVisuals: Array<() => void>,
  shouldLoot: boolean,
  market: MarketField,
  registeredMarket: string[],
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
      market,
      registeredMarket,
    );
  }

  // A fuel stop leaves a trailer beside the house: a world object, never owned.
  if (shouldLoot && poi.stock === 'fuel') stockTrailer(ctx, poi, { site, halfX, halfZ }, trailers);

  // Every stop with a building sells from a machine (a mast has none), its back a hand's
  // width off the wall that faces the road, so it is seen from the asphalt.
  const assortment = vendingAssortment(poi);
  if (assortment) {
    const spot = machineSpot(ctx, poi, { site, halfX, halfZ });
    buildVendingMachine(ctx, poi, assortment, spot.x, spot.z, spot.yaw, group, bodies, colliders, market, registeredMarket);
  }
}

/**
 * Where a stop's vending machine stands and which way it faces. A roadside building's
 * front faces the road: the machine stands by it toward the end away from the trailer,
 * far enough along that a courier parked in front of the middle (`buildCourier`, a car's
 * half length either side of the stop) does not hide it from the road.
 * A desert building faces anywhere, so the machine stands by whichever of its four walls
 * faces the road best, facing out. The trailer stands along the right wall (+X, see
 * `stockTrailer`) toward the front, so by that wall the machine keeps to the back end.
 * Every wall's strip is clear of the car field (`salvageKeepOut`).
 */
function machineSpot(ctx: ChunkContext, poi: Poi, yard: Yard): { x: number; z: number; yaw: number } {
  let wall = 0;
  if (poi.desert) {
    const road = ctx.road.offsetPoint(poi.s, 0);
    const toRoadX = road.x - yard.site.x;
    const toRoadZ = road.z - yard.site.z;
    let best = -Infinity;
    for (let k = 0; k < 4; k++) {
      // The wall's outward normal: its machine's front, local -Z at the turned yaw.
      const out = rotateXZ(0, -1, yard.site.yaw + (k * Math.PI) / 2);
      const facing = out.x * toRoadX + out.z * toRoadZ;
      if (facing > best) {
        best = facing;
        wall = k;
      }
    }
  }
  const yaw = yard.site.yaw + (wall * Math.PI) / 2;
  const along = wall % 2 === 0 ? yard.halfX : yard.halfZ;
  const depth = wall % 2 === 0 ? yard.halfZ : yard.halfX;
  const across = (wall === 3 ? 0.85 : -0.85) * Math.min(along, 4.5);
  const o = rotateXZ(across, -(depth + 0.45), yaw);
  return { x: yard.site.x + o.x, z: yard.site.z + o.z, yaw };
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
    // A desert building's machine may stand by a side wall (`machineSpot`): the strip
    // runs round all four there.
    halfX: instance.halfExtentX + (poi.desert ? YARD_DEPTH_M : 0),
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
  trailers: TrailerField,
  wreckTrunks: WreckTrunkField,
  registeredWrecks: string[],
  market: MarketField,
  registeredMarket: string[],
): void {
  const shouldLoot = ctx.hasPhysics && !ctx.world.state.lootedPois.includes(poi.index);

  buildStructurePoi(
    ctx,
    poi,
    group,
    bodies,
    colliders,
    trailers,
    wreckTrunks,
    registeredWrecks,
    deferredVisuals,
    shouldLoot,
    market,
    registeredMarket,
  );

  // Record that this POI's world objects are now materialised. The flag alone is the
  // whole idempotency guard across chunk promotion / unload / reload.
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
  const collider = addStaticCollider(
    ctx,
    new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
    matrix,
    SurfaceType.Rock,
    bodies,
    colliders,
  );
  if (collider) {
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
      defaultStorage: courierDefaultStorage(ctx.world.seed, stop.index),
    });
    registeredCouriers.push(id);
  }

  // After the registration, so the boot lid joins a registered courier.
  const addModel = (): void => {
    const courier = createCourierCarModel(def.id, id);
    setFromMatrix(courier.model, matrix);
    group.add(courier.model);
    // Only a registered courier is within the player's reach; its boot lid is eased there.
    if (courier.lids) courierField.attachLids(id, courier.lids);
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
  if (!collider) return;

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
  // The stop's lay-by, if it has one: no body is parked on its asphalt.
  const nearLayby = poi.desert ? null : laybyNear(road.seed, poi.s);
  const layby = nearLayby?.poiIndex === poi.index ? nearLayby : null;

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
      if (layby) {
        // Gap off the lay-by's asphalt outline, in the road frame; zero and below
        // (only the radius left) anywhere on it.
        const s = poi.s + sDelta;
        const sc = Math.min(layby.sExit, Math.max(layby.sEntry, s));
        const u = (poi.lateral + latDelta) * layby.side;
        const gap =
          Math.hypot(Math.max(0, u - laybyOuterAt(layby, sc, road.halfWidthAt(sc))), s - sc) - radius;
        if (gap < margin) margin = gap;
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
 * One to three complete models scattered through a roadside wreck field, and at some
 * stops one upright car among them for sale (world/carlot.ts). Both draw from the whole
 * catalogue: a wreck is a state a body is found in, not a class of body, so the same car
 * you can buy is the one you find sunk in the sand beside it.
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
  market: MarketField,
  registeredMarket: string[],
): void {
  const anchor = anchorXZ(ctx, poi);
  const ox = ctx.originX;
  const oz = ctx.originZ;
  const slots = layOutWreckField(poi, ctx.road, keepOut);
  const count = slots.length;

  const lot = lotOffer(ctx.world.seed, poi, count);

  for (let w = 0; w < count; w++) {
    const isLotCar = lot !== null && w === lot.slot;
    const def = isLotCar ? lot.def : slots[w]!.def;
    const measure = carModelMeasure(def.id);
    const half = measure.halfExtents;
    const carId = ctx.world.generatedPartId('poi-car', poi.index, w);
    const { sDelta, latDelta } = slots[w]!;
    const p = groundPoint(ctx, poi, sDelta, latDelta);

    // The lot's price board, at the car's road-side flank and facing the road; only
    // while the car is still for sale.
    const priceBoard = (): void => {
      const side = poi.lateral < 0 ? -1 : 1;
      const at = groundPoint(ctx, poi, sDelta, latDelta - side * (half[0] + 0.9));
      const road = ctx.road.offsetPoint(poi.s + sDelta, 0);
      buildLotSign(ctx, group, carId, def, at.x, at.y, at.z, Math.atan2(road.x - at.x, road.z - at.z), market, registeredMarket);
    };

    // A car made at a stop lives in world state from then on, sold or not (or, in a save
    // from before the lots, taken for free): never a shell or a second car where it stood.
    const existing = ctx.world.state.cars[carId];
    if (existing) {
      if (isLotCar && existing.lotPrice !== undefined) priceBoard();
      continue;
    }

    const yawRoll = hash01(poi.variantSeed, w, 13);
    let yaw = anchor.heading + (hash01(poi.variantSeed, w, 14) - 0.5) * 0.6;
    if (!isLotCar) {
      if (yawRoll < 0.32) yaw += Math.PI;
      else if (yawRoll > 0.82) {
        yaw += (hash01(poi.variantSeed, w, 15) < 0.5 ? 1 : -1) * Math.PI * 0.5;
      }
    }

    // The shell lies ALONG the ground and then adds its own derelict lean; the
    // fitted plane is what stops a body bridging a dune face on two wheels.
    const plane = fitGround(ctx.terrain, p.x, p.z, yaw, half[0], half[2], poi.s);
    const sink = isLotCar ? 0.02 : 0.25 + hash01(poi.variantSeed, w, 16) * half[1] * 0.5;
    const roll = plane.roll + (isLotCar ? 0 : (hash01(poi.variantSeed, w, 17) - 0.5) * 0.3);
    const pitch = plane.pitch + (isLotCar ? 0 : (hash01(poi.variantSeed, w, 18) - 0.5) * 0.22);
    const originY = plane.centreY + half[1] - sink;

    // Distant scenery shows the lot car as an upright static model. Promotion into the
    // physics band replaces it with a real Vehicle, priced until it is bought.
    if (isLotCar) priceBoard();
    if (isLotCar && ctx.hasPhysics) {
      // The distant static preview stands on the terrain; promotion creates the
      // physical car in clear air so gravity and suspension determine its ride height.
      const spawnY = carSpawnYAboveGround(measure, p.y);
      ctx.world.apply({
        t: 'car_add',
        car: makeLotCar(poi, carId, def, p.x, spawnY, p.z, yaw),
      });
      continue;
    }
    const matrix = poseMatrix(p.x, originY, p.z, yaw, roll, pitch, ox, oz);
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
    if (!isLotCar && collider) {
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
      // The shell is empty: nothing in the world is free for the taking.
    }
    // After the registration, so the shell's lids join a registered wreck.
    const addShell = (): void => {
      const shell = createStaticCarModel(def.id, carId);
      setFromMatrix(shell.model, matrix);
      group.add(shell.model);
      // Only a registered shell is within the player's reach; its lids are eased there.
      if (shell.lids) wreckTrunks.attachLids(carId, shell.lids);
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
    private readonly trailers: TrailerField,
    private readonly wreckTrunks: WreckTrunkField,
    private readonly couriers: CourierField,
    private readonly roadDistance: RoadDistance,
    private readonly dancers: DancerField,
    /** The vending machines and lot cars' registry (world/market.ts). */
    private readonly market: MarketField,
  ) {}

  build(ctx: ChunkContext): ChunkContent | null {
    const spacing = POI_SPACING;
    const pois = poisBetween(ctx.world.seed, ctx.sStart, ctx.sEnd, spacing);
    const desert = desertPoisBetween(ctx.world.seed, ctx.sStart, ctx.sEnd, spacing).filter(
      (poi) =>
        desertPoiClearOfRoad(poi, ctx.road, this.roadDistance) &&
        desertPoiClearOfLandforms(poi, ctx.road, ctx.terrain) &&
        desertPoiClearOfMesas(poi, ctx.road, ctx.terrain) &&
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
    const registeredMarket: string[] = [];

    for (const poi of [...pois, ...desert]) {
      buildPoi(
        ctx,
        poi,
        group,
        bodies,
        colliders,
        deferredVisuals,
        this.trailers,
        this.wreckTrunks,
        registeredWrecks,
        this.market,
        registeredMarket,
      );
    }
    for (const stop of couriersBetween(ctx.world.seed, ctx.sStart, ctx.sEnd, POI_SPACING)) {
      const courierPoi = pois.find((poi) => poi.s === stop.s);
      if (!courierPoi) continue;
      // On the stop's lay-by when it has one, on its building side so the parking line
      // beside it stays free (world/layby.ts); a mast has none, and the car stands on
      // the verge as it always did.
      const layby = laybyNear(ctx.world.seed, stop.s);
      buildCourier(
        ctx,
        {
          ...stop,
          lateral:
            layby?.poiIndex === courierPoi.index
              ? laybyCourierLateral(layby)
              : courierParkingLateral(courierPoi.lateral),
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
        this.market.forget(registeredMarket);
        for (const cancel of deferredVisuals) cancel();
      },
    };
  }
}
