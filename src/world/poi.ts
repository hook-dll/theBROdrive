import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { hash, hash01 } from '../core/rng';
import { GAMEPLAY_CONFIG } from '../config';
import { SurfaceType } from '../core/surfaces';
import { ROAD_LENGTH, type Road } from './road';
import type { MarketField } from './market';
import { buildShop } from './vending';
import { disposeKitMerged } from './poi/kit';
import { buildLotSign, lotModel, makeLotCar } from './carlot';
import {
  carModelMeasure,
  carSpawnYAboveGround,
  createStaticCarModel,
  isCarModelLoaded,
  loadCarModel,
} from '../render/carmodel';
import { carPrice } from '../economy/economy';
import type { ChunkContext, ChunkContent, ChunkProvider } from './chunks';
import { buildHaulBay, postHaulBay } from './haulbay';
import { setReflectorEmission } from './props/delineators';
import { postStop } from './poststops';
import { fitGround } from './footprint';
import { halfWidthAt } from './roadprofile';
import { BASIN_OUTER_M, lakeSites, type LakeSite } from './lakes';
import { mesaFieldOf } from './mesas';
import type { RoadDistance } from './roaddistance';
import type { Terrain } from './terrain';
import type { VariantInstance } from './poivariantbuild';
import { createStructureInstance, structureDef } from './poistructures';
import { roadsideSlot, roadsideSlotOfIndex, roadsideSlotsBetween, rollStructure, slotPost } from './poislots';
import { settlementLayout, spotPose, type SettlementHouse, type SettlementLayout, type SettlementSpot } from './settlement';
import type { FixtureField } from './fixturefield';
import { buildPost } from './post';
import { buildToyBox } from './toybox';
import { buildBarrelStand } from './barrels';
import { buildKeyBox } from './keybox';
import { newRegionMix, regionAt } from './regions';

/**
 * Points of interest: the buildings that give the drive a reason to continue.
 *
 * Two populations, one model. ROADSIDE stops stand on the roadside slots (world/
 * poislots.ts), which follow the post network: a settlement of houses on both sides with
 * its service strip at every post stop, sometimes one house in a long gap between two
 * (world/settlement.ts lays both out). DESERT ones stand on a lattice of their own,
 * one per side, anywhere from 70 m to the better part of a kilometre out and facing
 * wherever they were left facing: a house you only find by leaving the asphalt.
 *
 * Both are pure functions of the integer seed. A desert POI is computed from its slot
 * index alone; a roadside one from the post network's gaps, which every reader draws
 * from the seed into the same table (world/poststops.ts). So chunk streaming can
 * materialise any stretch of road in any order and a save always restores the same stop.
 *
 * The building is drawn from `POI_STRUCTURES` (world/poistructures.ts). Nothing lies
 * about a stop for the taking: what a stop offers is sold (economy plan).
 *
 * A stop's one world object, the car for sale, is materialised once, keyed by its own id
 * in world state; everything else is scenery, built every time the chunk is.
 */

/** Arclength between desert slots, from `config/gameplay.json`. */
export const DESERT_SPACING_M = GAMEPLAY_CONFIG.desertPoiSpacingMetres;
/** Domain tag for the desert slots. */
const DESERT_DOMAIN = 0x44534b31; // 'DSK1'
/**
 * Chance that one side of one desert slot has a building on it, at the ring's mean;
 * each region scales it by its `houses` (world/regions.ts).
 */
const DESERT_OCCUPANCY = 0.36;
/** Even the most lived-in region leaves a side of a slot empty now and then. */
const DESERT_OCCUPANCY_MAX = 0.85;
const desertRegion = newRegionMix();
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
 * Where the desert population's identities start (the roadside one's base is in
 * world/poislots.ts).
 *
 * Both are offset past anything a save written before the dwellings could hold: those
 * saves recorded the old buildings' slot indices, and the loot they left behind was laid
 * INSIDE buildings that now stand as closed shells. A fresh index gives every stop in an
 * old save its loot again, outside, instead of none.
 */
const DESERT_INDEX_BASE = 60_000_000;


export interface Poi {
  /** Identity in every generated item and car id. Stable forever. */
  readonly index: number;
  /** Arclength of the stop, metres from the house. */
  readonly s: number;
  /** Signed lateral offset from the centreline; negative is left of travel. */
  readonly lateral: number;
  /** Index into `POI_STRUCTURES`: the building that stands here. */
  readonly structure: number;
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
function roadsidePoi(seed: number, slot: number): Poi | null {
  const roll = roadsideSlot(seed, slot);
  if (!roll) return null;
  return {
    index: roll.index,
    s: roll.s,
    lateral: roll.side * (halfWidthAt(seed, roll.s) + roll.verge + halfStructure(roll.structure)),
    structure: roll.structure,
    desert: false,
    variantSeed: roll.variantSeed,
  };
}

/**
 * Roadside POIs whose slot falls in [fromS, toS). Pure and order-independent: no road
 * or terrain sampling happens here.
 */
export function poisBetween(seed: number, fromS: number, toS: number): Poi[] {
  const result: Poi[] = [];
  for (const slot of roadsideSlotsBetween(seed, fromS, toS)) {
    const poi = roadsidePoi(seed, slot);
    if (poi) result.push(poi);
  }
  return result;
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
 * A desert slot every `spacing` carries one candidate on each side, each moved up to
 * 40% of a spacing along the road so the two sides do not pair up. Its arclength decides
 * which chunk builds it, exactly as a roadside one's does.
 * What this cannot know without the road's geometry is whether another pass of the road
 * runs past the spot; `PoiProvider` checks that where it has the road.
 */
export function desertPoisBetween(
  seed: number,
  fromS: number,
  toS: number,
  spacing = DESERT_SPACING_M,
): Poi[] {
  const result: Poi[] = [];
  // One slot either side of the range: a jittered slot can land inside it from next door.
  const firstSlot = Math.max(0, Math.floor(fromS / spacing) - 1);
  const lastSlot = Math.ceil(toS / spacing) + 1;
  for (let slot = firstSlot; slot <= lastSlot; slot++) {
    for (const side of [-1, 1] as const) {
      const key = slot * 2 + (side > 0 ? 1 : 0);
      const s = (slot + 0.5 + (hash01(seed, DESERT_DOMAIN, key, 2) - 0.5) * 0.8) * spacing;
      if (s < fromS || s >= toS) continue;
      if (s < DESERT_END_CLEARANCE_M || s > ROAD_LENGTH - DESERT_END_CLEARANCE_M) continue;
      const occupancy = Math.min(DESERT_OCCUPANCY_MAX, DESERT_OCCUPANCY * regionAt(s, desertRegion).houses);
      if (hash01(seed, DESERT_DOMAIN, key) >= occupancy) continue;
      const structure = rollStructure(seed, DESERT_DOMAIN, key, s);
      const half = halfStructure(structure);
      const out = hash01(seed, DESERT_DOMAIN, key, 3);
      const lateral = side * (halfWidthAt(seed, s) + DESERT_NEAR_M + half + out * out * DESERT_SPAN_M);
      if (inLakeBasin(seed, s, lateral, half)) continue;
      result.push({
        index: DESERT_INDEX_BASE + key,
        s,
        lateral,
        structure,
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

// ---------------------------------------------------------------------------
// Building a stop. Scenery is built unconditionally; the one world object, the car for
// sale, only once, guarded by the car's own id in world state.
//
// NOTHING LIES ABOUT A STOP FOR THE TAKING (economy plan): fuel, fluids and parts are
// bought at a settlement's machine; a car is bought from its lot.
// ---------------------------------------------------------------------------

/**
 * Which way a building faces: toward the road it stands beside.
 *
 * "Toward the road" is not the road's heading. A building sits off to one side, so the
 * direction it should face is the one that turns its front — authored as -Z — toward the
 * centreline, which is its own lateral offset reversed. A small hash wobble keeps a row
 * of them from looking stamped out. A roadside stop's houses carry the same turn as a yaw
 * relative to the road (world/settlement.ts).
 */
function faceRoadYaw(heading: number, lateral: number, variantSeed: number): number {
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
 * One structure on the sand at an absolute spot, with its collider.
 *
 * See `NO APRON` below for how it meets the ground; `s` is any arclength near the spot,
 * the hint the terrain samples with.
 */
function seatStructure(
  ctx: ChunkContext,
  structure: number,
  x: number,
  z: number,
  yaw: number,
  s: number,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
): void {
  const instance: VariantInstance = createStructureInstance(structure);
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
  // The plane is fitted over the larger of the measured bounds and the authored footprint:
  // a mast compound's measured bounds stop at its masts, and the guy anchors, the hut's
  // step and the cable runs past them still have to meet the sand. Five by five, not the
  // default three: the residual is only as honest as the samples it is taken over, and a
  // 30 m mast compound on the berm's curve hid 0.14 m of daylight under a wall between
  // the nine a 3x3 grid takes.
  const plane = fitGround(
    ctx.terrain,
    x,
    z,
    yaw,
    Math.max(instance.halfExtentX, instance.footprint[0] / 2),
    Math.max(instance.halfExtentZ, instance.footprint[1] / 2),
    s,
    5,
  );
  const seatY = plane.centreY - plane.residual - SEAT_BURY_MARGIN;
  instance.group.position.set(x - ctx.originX, seatY, z - ctx.originZ);
  instance.group.rotation.set(plane.pitch, yaw, plane.roll, 'YXZ');
  instance.group.updateMatrixWorld(true);
  group.add(instance.group);

  if (!ctx.hasPhysics) return;
  const matrix = poseMatrix(x, seatY, z, yaw, plane.roll, plane.pitch, ctx.originX, ctx.originZ);
  const trimesh = geometryToTrimesh(instance.solid, matrix);
  if (trimesh.indices.length === 0) return;
  const collider = ctx.physics.addStaticTrimesh(trimesh.vertices, trimesh.indices, SurfaceType.Concrete);
  colliders.push(collider);
  const parent = collider.parent();
  if (parent) bodies.push(parent);
}

/** Clear ground between two of a stop's houses as they stand in the world, metres. */
const HOUSE_CLEARANCE_M = 2;
/** Clear ground between a house's corner radius and a mesa's footprint, metres. */
const HOUSE_MESA_CLEARANCE_M = 4;
/**
 * Clear ground between a house's corner radius and the asphalt of ANOTHER pass of the
 * road, metres. Its own pass it clears by its verge; where the road doubles back, a house
 * across from the stop can stand on the next leg.
 */
const HOUSE_OTHER_PASS_CLEARANCE_M = 10;
/** Arclength apart beyond which the nearest asphalt is another pass of the road, metres. */
const OTHER_PASS_S_M = 200;

/** A building's rectangle on the ground: centre, yaw, half extents in its own frame. */
export interface GroundRect {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly halfX: number;
  readonly halfZ: number;
}

/**
 * Gap between two rectangles along the axis that separates them best: positive is clear
 * ground, negative an overlap. Exact for the separating-axis test; as a distance it is
 * the larger of the per-axis gaps, which is all a minimum spacing needs.
 */
export function rectGap(a: GroundRect, b: GroundRect): number {
  let best = -Infinity;
  for (const yaw of [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2]) {
    // The axis is local +X of a rectangle at `yaw` (`rotateXZ(1, 0, yaw)`).
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    const reach = (r: GroundRect): number =>
      Math.abs(Math.cos(r.yaw) * ax - Math.sin(r.yaw) * az) * r.halfX
      + Math.abs(Math.sin(r.yaw) * ax + Math.cos(r.yaw) * az) * r.halfZ;
    const centre = Math.abs((b.x - a.x) * ax + (b.z - a.z) * az);
    best = Math.max(best, centre - reach(a) - reach(b));
  }
  return best;
}

/** A house's ground rectangle where it stands on `road`. */
export function houseRect(road: Road, house: SettlementHouse): GroundRect {
  const pose = spotPose(road, house);
  return { x: pose.x, z: pose.z, yaw: pose.yaw, halfX: house.halfX, halfZ: house.halfZ };
}

/**
 * The houses of a roadside stop that actually stand: the pure layout less any house the
 * ground or the road will not have. A house on a landform's slope, in a mesa or a lake
 * basin, or on another pass of the road is dropped, and so is one that the road's curve
 * has brought into an earlier one (the layout spaces them in the road frame; on the
 * inside of a bend that frame converges). Earlier in the layout wins, whichever chunk
 * asks. Exported for tools/poi-placement.ts, which measures what this keeps.
 */
export function standingHouses(
  layout: SettlementLayout,
  road: Road,
  terrain: Terrain,
  roadDistance: RoadDistance,
): SettlementHouse[] {
  const standing: SettlementHouse[] = [];
  const rects: GroundRect[] = [];
  for (const house of layout.houses) {
    const rect = houseRect(road, house);
    const radius = Math.hypot(house.halfX, house.halfZ);
    if (inLakeBasin(road.seed, house.s, house.lateral, radius)) continue;
    if (terrain.landforms.covers(rect.x, rect.z, house.s, radius)) continue;
    if (mesaFieldOf(road, terrain).blocks(rect.x, rect.z, radius + HOUSE_MESA_CLEARANCE_M)) continue;
    const owner = roadDistance.ownerAt(rect.x, rect.z, DESERT_OWNER_LATTICE_M);
    const nearest = road.project(rect.x, rect.z, owner);
    if (
      Math.abs(nearest.s - house.s) > OTHER_PASS_S_M
      && Math.abs(nearest.lateral) - road.halfWidthAt(nearest.s) - radius < HOUSE_OTHER_PASS_CLEARANCE_M
    ) {
      continue;
    }
    if (rects.some((other) => rectGap(rect, other) < HOUSE_CLEARANCE_M)) continue;
    standing.push(house);
    rects.push(rect);
  }
  return standing;
}

/** The car for sale's price board stands this far off its road-side flank, metres. */
const LOT_BOARD_OUT_M = 0.9;
/** The key box's post stands this far beside the price board's, along the board, metres. */
const KEY_BOX_BESIDE_M = 0.65;

/**
 * A settlement's car for sale, at its `lot` spot, with its price board on the road-side
 * flank (world/carlot.ts). The car is a real car in world state from the moment its chunk
 * enters the physics band, carrying its price until it is bought; out there, distant
 * scenery shows it as an upright static model.
 */
function buildLot(
  ctx: ChunkContext,
  poi: Poi,
  lot: SettlementSpot,
  side: 1 | -1,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  deferredVisuals: Array<() => void>,
  market: MarketField,
  registeredMarket: string[],
  fixtures: FixtureField,
  registeredFixtures: string[],
): void {
  const def = lotModel(ctx.world.seed, poi);
  if (!def) return;
  const measure = carModelMeasure(def.id);
  const half = measure.halfExtents;
  const carId = ctx.world.generatedPartId('lot-car', poi.index, 0);
  const pose = spotPose(ctx.road, lot);
  const groundY = ctx.terrain.heightAt(pose.x, pose.z, lot.s);

  // The price board, facing the road, and the key box on its post beside it, the same
  // way round (world/keybox.ts); only while the car is still for sale.
  const priceBoard = (price: number): void => {
    const at = ctx.road.offsetPoint(lot.s, lot.lateral - side * (half[0] + LOT_BOARD_OUT_M));
    const y = ctx.terrain.heightAt(at.x, at.z, lot.s);
    const road = ctx.road.offsetPoint(lot.s, 0);
    const face = Math.atan2(road.x - at.x, road.z - at.z);
    buildLotSign(ctx, group, carId, def, at.x, y, at.z, face, market, registeredMarket);
    const boxX = at.x + Math.cos(face) * KEY_BOX_BESIDE_M;
    const boxZ = at.z - Math.sin(face) * KEY_BOX_BESIDE_M;
    buildKeyBox(
      ctx, carId, price, boxX, ctx.terrain.heightAt(boxX, boxZ, lot.s), boxZ, face,
      group, bodies, colliders, fixtures, registeredFixtures, market,
    );
  };

  // A car made at a lot lives in world state from then on, sold or not, boxed or out.
  const existing = ctx.world.state.cars[carId] ?? ctx.world.state.toyBox[carId];
  if (existing) {
    if (existing.lotPrice !== undefined) priceBoard(existing.lotPrice);
    return;
  }
  priceBoard(carPrice(def.id));
  if (ctx.hasPhysics) {
    // Created in clear air, so gravity and suspension find its ride height.
    ctx.world.apply({
      t: 'car_add',
      car: makeLotCar(poi, carId, def, pose.x, carSpawnYAboveGround(measure, groundY), pose.z, pose.yaw),
    });
    return;
  }
  const plane = fitGround(ctx.terrain, pose.x, pose.z, pose.yaw, half[0], half[2], lot.s);
  const matrix = poseMatrix(
    pose.x,
    plane.centreY + half[1] - 0.02,
    pose.z,
    pose.yaw,
    plane.roll,
    plane.pitch,
    ctx.originX,
    ctx.originZ,
  );
  const addPreview = (): void => {
    const preview = createStaticCarModel(def.id, carId);
    setFromMatrix(preview, matrix);
    group.add(preview);
  };
  if (isCarModelLoaded(def.id)) {
    addPreview();
    return;
  }
  let cancelled = false;
  deferredVisuals.push(() => {
    cancelled = true;
  });
  void loadCarModel(def.id).then(
    () => {
      if (!cancelled) addPreview();
    },
    (error: unknown) => {
      console.error(`failed to load lot car model "${def.id}"`, error);
    },
  );
}

/**
 * One stop. Out in the desert: its building, facing wherever it was left facing. At the
 * road: its layout (world/settlement.ts) — a lone house, or a settlement's houses on both
 * sides, its «ПОЧТА» machine (world/post.ts), toy box (world/toybox.ts) and haul bay
 * (world/haulbay.ts), the shop's machine, the car for sale with its key box, a barrel
 * stand. True when it built a haul bay, whose reflectors follow the night.
 */
function buildPoi(
  ctx: ChunkContext,
  poi: Poi,
  roadDistance: RoadDistance,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  deferredVisuals: Array<() => void>,
  market: MarketField,
  registeredMarket: string[],
  fixtures: FixtureField,
  registeredFixtures: string[],
  disposers: Array<() => void>,
): boolean {
  if (poi.desert) {
    const at = ctx.road.offsetPoint(poi.s, poi.lateral);
    const yaw = poiYaw(poi, ctx.road.headingAt(poi.s));
    seatStructure(ctx, poi.structure, at.x, at.z, yaw, poi.s, group, bodies, colliders);
    return false;
  }

  const layout = settlementLayout(ctx.world.seed, poi);
  for (const house of standingHouses(layout, ctx.road, ctx.terrain, roadDistance)) {
    const pose = spotPose(ctx.road, house);
    seatStructure(ctx, house.structure, pose.x, pose.z, pose.yaw, house.s, group, bodies, colliders);
  }
  let bay = false;
  if (layout.post) {
    const stop = postStop(ctx.world.seed, slotPost(roadsideSlotOfIndex(poi.index)));
    const pose = spotPose(ctx.road, layout.post);
    buildPost(ctx, stop, pose.x, pose.z, pose.yaw, group, bodies, colliders, fixtures, registeredFixtures, disposers);
    if (layout.toybox) buildToyBox(ctx, stop, layout.toybox, group, bodies, colliders, fixtures, registeredFixtures, disposers);
    if (layout.bay) {
      buildHaulBay(ctx, postHaulBay(ctx.world.seed, ctx.road, stop.index), group, bodies, colliders);
      bay = true;
    }
  }
  if (layout.shop) {
    const pose = spotPose(ctx.road, layout.shop);
    buildShop(ctx, poi, pose.x, pose.z, pose.yaw, group, bodies, colliders, fixtures, registeredFixtures, disposers);
  }
  if (layout.barrels) {
    const pose = spotPose(ctx.road, layout.barrels);
    buildBarrelStand(ctx, poi, pose.x, pose.z, pose.yaw, group, bodies, colliders, fixtures, registeredFixtures);
  }
  if (layout.lot) {
    buildLot(
      ctx, poi, layout.lot, layout.side, group, bodies, colliders, deferredVisuals,
      market, registeredMarket, fixtures, registeredFixtures,
    );
  }
  return bay;
}

/**
 * Builds roadside and desert stops, the post network's machines among them. Fixture and
 * market registries exist only for the live physics band; what is edited at them remains
 * in WorldState.
 */
export class PoiProvider implements ChunkProvider {
  readonly id = 'poi';

  constructor(
    private readonly roadDistance: RoadDistance,
    /** The vending machines and lot cars' registry (world/market.ts). */
    private readonly market: MarketField,
    /** The streamed mechanical fixtures (world/fixturefield.ts): post, barrels, key boxes. */
    private readonly fixtures: FixtureField,
  ) {}

  build(ctx: ChunkContext): ChunkContent | null {
    const spacing = DESERT_SPACING_M;
    const pois = poisBetween(ctx.world.seed, ctx.sStart, ctx.sEnd);
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
    const registeredMarket: string[] = [];
    /** Ids of the world fixtures this chunk registered; forgotten with it. */
    const registeredFixtures: string[] = [];

    let bays = false;
    for (const poi of [...pois, ...desert]) {
      const bay = buildPoi(
        ctx,
        poi,
        this.roadDistance,
        group,
        bodies,
        colliders,
        deferredVisuals,
        this.market,
        registeredMarket,
        this.fixtures,
        registeredFixtures,
        deferredVisuals,
      );
      bays ||= bay;
    }

    return {
      group,
      bodies,
      colliders,
      dispose: () => {
        // The fixtures' merged boxes (world/poi/kit.ts `mergeKitStatics`) are this chunk's own.
        disposeKitMerged(group);
        this.market.forget(registeredMarket);
        this.fixtures.forget(registeredFixtures);
        for (const cancel of deferredVisuals) cancel();
      },
      // The haul bays' reflector chips share the delineators' material.
      ...(bays ? { setLamps: setReflectorEmission } : {}),
    };
  }
}
