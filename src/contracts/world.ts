/**
 * The world objects a contract is about: the loaded trailer of the equipment and
 * oversize kinds, and the car of the transfer kind.
 *
 * A contract names its object after the offer (`generatedSeed`), so the same trailer
 * or car is the same object across a session, a save and a reload, with nothing
 * extra stored: `contract-trailer:<seed>` and `contract-car:<seed>` are in world
 * state like any other trailer or car.
 *
 * SPAWNED ONCE, ON THE FIRST PICKUP. The object appears next to the SOURCE courier
 * the first time the cargo leaves that courier's boot, which is the moment the
 * contract becomes physical. The guard is plain existence — an id already in state
 * is never spawned again — so dropping and re-picking the cargo, stowing it in
 * another boot, or reloading a save cannot duplicate the object, and after delivery
 * the cargo is gone and there is nothing left to drive a respawn.
 *
 * `ContractRuntime.tick` calls this for every live cargo item
 * (`ContractTickInput.onContractItem`), so it also heals a save written before the
 * kind existed: the next tick spawns what the contract was missing.
 */

import { hash01, pick } from '../core/rng';
import type { CarState, GameWorld, TrailerLoad, TrailerState } from '../game/state';
import { createServiceableCarState, poseOnGround } from '../game/spawn';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { CAR_MODELS } from '../vehicle/carmodels';
import type { ContractCargoItem } from '../items/items';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import { courierId, courierStop, type CourierField } from '../world/couriers';
import type { ContractPlace } from './types';

/** 'CTW1', 'CTL1', 'CTC1': the trailer cargo, the oversize load and the car model. */
const EQUIPMENT_CARGO_DOMAIN = 0x43545731;
const OVERSIZE_LOAD_DOMAIN = 0x43544c31;
const OVERSIZE_MASS_DOMAIN = 0x43544d31;
const CAR_MODEL_DOMAIN = 0x43544331;
/** Where a contract car is staggered around its courier, so two do not coincide. */
const CAR_STAGGER_DOMAIN = 0x43545331;

/** Equipment on the trailer of kind 6, kg: a real load, light enough to tow. */
const EQUIPMENT_MIN_KG = 180;
const EQUIPMENT_RANGE_KG = 241;
/** Pipes or beams on the trailer of kind 7, kg. Well under the 700 kg bed limit. */
const OVERSIZE_MIN_KG = 320;
const OVERSIZE_RANGE_KG = 141;

/**
 * Courier centre to the trailer parked behind it, m: the courier's own rear half
 * plus 0.9 m of drawbar and a short gap, so the trailer stands clear with its
 * drawbar pointing at the car that is supposed to take it.
 */
const TRAILER_CENTRE_GAP_M = 2.7;
/** Courier centre to the car parked ahead of it, m, on top of both half-lengths. */
const CAR_CENTRE_GAP_M = 1.2;
/**
 * Rear half-length used for a courier whose chunk is not built. A courier is an
 * ordinary car model, and this is about the longest catalogue half, so a fallback
 * stamp is always clear rather than sometimes inside the car.
 */
const FALLBACK_COURIER_HALF_Z = 2.7;

export interface ContractWorldDeps {
  readonly world: GameWorld;
  readonly road: Road;
  readonly terrain: Terrain;
  /** Live courier registrations; empty when the source POI's chunk is unloaded. */
  readonly couriers: CourierField;
}

/** The trailer the equipment and oversize kinds are about. */
export function contractTrailerId(item: ContractCargoItem): string {
  return `contract-trailer:${item.generatedSeed.toString(36)}`;
}

/** The car the transfer kind is about. */
export function contractCarId(item: ContractCargoItem): string {
  return `contract-car:${item.generatedSeed.toString(36)}`;
}

/**
 * The overhanging load of an oversize trailer: a bundle of pipes or a pair of beams,
 * about 3.8 m long against a 2.8 m bed, so it overhangs each end by half a metre and
 * is what the traffic and the rocks get to hit. It was 5.5-5.8 m, and the front
 * overhang reached the towing car's tail: the trailer could hardly be hitched.
 * Deterministic from the offer seed.
 */
export function oversizeLoad(seed: number): TrailerLoad {
  return hash01(seed, OVERSIZE_LOAD_DOMAIN, 0) < 0.5
    ? { kind: 'pipes', halfExtents: [0.6, 0.19, 1.85] }
    : { kind: 'beams', halfExtents: [0.5, 0.3, 1.95] };
}

/** Mass on the bed of a contract trailer, kg. */
export function contractTrailerCargoKg(item: ContractCargoItem): number {
  if (item.contractKind === 'oversize') {
    return OVERSIZE_MIN_KG + Math.floor(hash01(item.generatedSeed, OVERSIZE_MASS_DOMAIN) * OVERSIZE_RANGE_KG);
  }
  return EQUIPMENT_MIN_KG + Math.floor(hash01(item.generatedSeed, EQUIPMENT_CARGO_DOMAIN) * EQUIPMENT_RANGE_KG);
}

interface CourierPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Half-length of the courier, m: what a spawn has to clear to stand behind it. */
  halfZ: number;
  /** Arclength hint for terrain sampling. */
  s: number;
}

/**
 * Where the source courier parks, from the live registration when its chunk is built
 * and from the seed otherwise. Both agree because the chunk build derives the same
 * pose from the same stop.
 */
function courierPose(deps: ContractWorldDeps, index: number): CourierPose | null {
  const live = deps.couriers.get(courierId(index));
  if (live) {
    return {
      x: live.x,
      y: live.y,
      z: live.z,
      // The courier is a car tilted onto its ground plane; the heading is the yaw of
      // that rotation, which the placement built from the road's heading.
      yaw: Math.atan2(
        2 * (live.qw * live.qy + live.qx * live.qz),
        1 - 2 * (live.qy * live.qy + live.qz * live.qz),
      ),
      halfZ: live.halfExtents[2],
      s: deps.road.project(live.x, live.z).s,
    };
  }
  const stop = courierStop(deps.world.seed, index);
  const point = deps.road.offsetPoint(stop.s, stop.lateral);
  const road = deps.road.sampleAt(stop.s);
  return {
    x: point.x,
    y: deps.terrain.heightAt(point.x, point.z, stop.s),
    z: point.z,
    yaw: road.heading,
    halfZ: FALLBACK_COURIER_HALF_Z,
    s: stop.s,
  };
}

/**
 * Spawns a contract's own world object the first time the cargo leaves its source
 * courier. Idempotent: an id already in state, or cargo still in the boot, returns
 * at once.
 */
export function ensureContractWorldObjects(
  deps: ContractWorldDeps,
  item: ContractCargoItem,
  place: ContractPlace,
): void {
  if (place === 'courier') return;
  const kind = item.contractKind;
  if (
    kind !== 'trailer_equipment' &&
    kind !== 'oversize' &&
    kind !== 'car_transfer' &&
    kind !== 'towing' &&
    kind !== 'convoy'
  ) {
    return;
  }
  const pose = courierPose(deps, item.sourceCourierIndex);
  if (!pose) return;
  if (kind === 'trailer_equipment' || kind === 'oversize') spawnContractTrailer(deps, item, pose);
  else spawnContractCar(deps, item, pose);
}

function spawnContractTrailer(
  deps: ContractWorldDeps,
  item: ContractCargoItem,
  pose: CourierPose,
): void {
  const id = contractTrailerId(item);
  if (deps.world.state.trailers[id]) return;
  // Behind the courier, nose to the boot that holds the papers.
  const back = pose.halfZ + TRAILER_CENTRE_GAP_M;
  const x = pose.x - Math.sin(pose.yaw) * back;
  const z = pose.z - Math.cos(pose.yaw) * back;
  const yaw = pose.yaw + Math.PI;
  const trailer: TrailerState = {
    id,
    hitchedTo: null,
    cargoKg: contractTrailerCargoKg(item),
    x,
    // Clear of the ground so it drops onto its own suspension rather than starting
    // inside the terrain, exactly as a POI's spare trailer does.
    y: deps.terrain.heightAt(x, z, pose.s) + 0.9,
    z,
    qx: 0,
    qy: Math.sin(yaw / 2),
    qz: 0,
    qw: Math.cos(yaw / 2),
  };
  if (item.contractKind === 'oversize') trailer.load = oversizeLoad(item.generatedSeed);
  deps.world.apply({ t: 'trailer_add', trailer });
}

function spawnContractCar(
  deps: ContractWorldDeps,
  item: ContractCargoItem,
  pose: CourierPose,
): void {
  const id = contractCarId(item);
  if (deps.world.state.cars[id]) return;
  const def = pick(CAR_MODELS, item.generatedSeed, CAR_MODEL_DOMAIN);
  const measure = carModelMeasure(def.id);
  // Ahead of the courier: the trailer takes the space behind it. Two offers at the
  // same courier would otherwise put two contract cars in one spot, so the seed
  // staggers this one across the verge and along the road by a couple of metres.
  const stagger = hash01(item.generatedSeed, CAR_STAGGER_DOMAIN, 0);
  const lateral = (stagger - 0.5) * 2.6;
  const ahead = pose.halfZ + measure.halfExtents[2] + CAR_CENTRE_GAP_M + stagger * 2.2;
  const x = pose.x + Math.sin(pose.yaw) * ahead + Math.cos(pose.yaw) * lateral;
  const z = pose.z + Math.cos(pose.yaw) * ahead - Math.sin(pose.yaw) * lateral;
  const plane = poseOnGround(measure.wheels, x, z, pose.yaw, (gx, gz) => deps.terrain.heightAt(gx, gz));
  const groundY = plane ? plane.groundY : deps.terrain.heightAt(x, z, pose.s);
  const car: CarState = createServiceableCarState(
    id,
    def.id,
    x,
    carSpawnYAboveGround(measure, groundY),
    z,
    pose.yaw,
  );
  if (plane) {
    // Stood on its own wheels, tilted as the ground is; the same fit a POI's
    // working car gets, so the transfer car is not the one car in the world that
    // starts level on a grade.
    car.qx = plane.qx;
    car.qy = plane.qy;
    car.qz = plane.qz;
    car.qw = plane.qw;
  }
  // The towed car of kind 17 leaves the works with NO ENGINE: it cannot idle, it
  // cannot be driven, and the papers commission a tow rather than a drive. Removing
  // the part rather than destroying it is the honest state — there is nothing in
  // the engine bay to fail, and the car's own mass drops by the engine's.
  if (item.contractKind === 'towing') car.bonnet[0] = null;
  deps.world.apply({ t: 'car_add', car });
}
