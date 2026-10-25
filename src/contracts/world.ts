/**
 * The world objects a haul is about: the loaded trailer of a trailer load, and the car
 * of a car to tow or to drive over.
 *
 * A contract names its object after the offer (`generatedSeed`), so the same trailer
 * or car is the same object across a session, a save and a reload, with nothing
 * extra stored: `contract-trailer:<seed>` and `contract-car:<seed>` are in world
 * state like any other trailer or car.
 *
 * SPAWNED ONCE, ON THE FIRST PICKUP. The object appears on the SOURCE post's lay-by
 * the first time the cargo leaves that post's stock (its lever hands over the papers),
 * which is the moment the contract becomes physical. The guard is plain existence — an id already in state
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
import { TRAILER_BALL_Z } from '../vehicle/trailer';
import { contractKindOf, contractThing, type ContractCargoItem } from '../items/items';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import { laybyHaulLateral, laybyNear } from '../world/layby';
import { postStop } from '../world/poststops';
import type { ContractPlace } from './types';

/** 'CTC1': the car model. */
const CAR_MODEL_DOMAIN = 0x43544331;
/** Where a contract car is staggered around its place, so two do not coincide. */
const CAR_STAGGER_DOMAIN = 0x43545331;

/**
 * The haul's place on the lay-by to the trailer parked behind it, m: half a car's
 * length plus 0.9 m of drawbar and a short gap, so the trailer stands with its drawbar
 * pointing up the pad at the car that is supposed to take it.
 */
const TRAILER_CENTRE_GAP_M = 2.7;
/** The haul's place to the car parked ahead of it, m, on top of both half-lengths. */
const CAR_CENTRE_GAP_M = 1.2;
/**
 * Half a car's length kept clear round the haul's place, m: about the longest catalogue
 * half, so the trailer and the car stand clear of each other.
 */
const HAUL_PLACE_HALF_Z = 2.7;

export interface ContractWorldDeps {
  readonly world: GameWorld;
  readonly road: Road;
  readonly terrain: Terrain;
}

const CONTRACT_TRAILER_PREFIX = 'contract-trailer:';
const CONTRACT_CAR_PREFIX = 'contract-car:';

/** The trailer a trailer load is about. */
export function contractTrailerId(item: ContractCargoItem): string {
  return `${CONTRACT_TRAILER_PREFIX}${item.generatedSeed.toString(36)}`;
}

/** The car a tow or a transfer is about. */
export function contractCarId(item: ContractCargoItem): string {
  return `${CONTRACT_CAR_PREFIX}${item.generatedSeed.toString(36)}`;
}

/** A car that is itself a haul (a car to tow or to drive over), not one of the player's. */
export function isContractCarId(carId: string): boolean {
  return carId.startsWith(CONTRACT_CAR_PREFIX);
}

/**
 * The long load (game-design2.md §7.3): the bed with its frame and boards, 3.2 m against
 * the trailer's 2.8 m bed, so it overhangs each end and is what the traffic and the
 * rocks get to hit. Every other trailer load rides as the bed's own crate.
 */
const BED_LOAD: TrailerLoad = { halfExtents: [0.8, 0.28, 1.6] };

/**
 * Where the long load sits along the bed: its front end this far behind the tow ball,
 * the room the drawbar needs to swing under the overhang. A longer load is a lighter
 * tongue, which is the real reason a long load is the more nervous tow
 * (vehicle/trailer.ts, `tongueLoadN`).
 */
const LONG_LOAD_BALL_CLEARANCE_M = 0.45;

interface HaulPose {
  x: number;
  z: number;
  yaw: number;
  /** Arclength hint for terrain sampling. */
  s: number;
}

/**
 * Where a post leaves its hauls: on its lay-by's building side, at the stop, heading
 * along the road (`laybyHaulLateral`). Pure from the seed, so it needs no chunk built;
 * the deliveries measure against the same place (`DeliveryProbe.postX`/`postZ`).
 */
export function postHaulPlace(seed: number, road: Road, index: number): HaulPose {
  const stop = postStop(seed, index);
  const layby = laybyNear(seed, stop.s);
  const lateral = layby && Math.abs(layby.s - stop.s) < 1 ? laybyHaulLateral(layby) : 0;
  const point = road.offsetPoint(stop.s, lateral);
  return { x: point.x, z: point.z, yaw: road.headingAt(stop.s), s: stop.s };
}

/**
 * Spawns a contract's own world object the first time the cargo leaves its source
 * post. Idempotent: an id already in state, or an offer still in the post's stock,
 * returns at once.
 */
export function ensureContractWorldObjects(
  deps: ContractWorldDeps,
  item: ContractCargoItem,
  place: ContractPlace,
): void {
  if (place === 'post') return;
  const kind = contractKindOf(item);
  if (kind !== 'trailer' && kind !== 'car_transfer' && kind !== 'towing') return;
  const pose = postHaulPlace(deps.world.seed, deps.road, item.sourceCourierIndex);
  if (kind === 'trailer') spawnContractTrailer(deps, item, pose);
  else spawnContractCar(deps, item, pose);
}

function spawnContractTrailer(
  deps: ContractWorldDeps,
  item: ContractCargoItem,
  pose: HaulPose,
): void {
  const id = contractTrailerId(item);
  if (deps.world.state.trailers[id]) return;
  // Behind the haul's place, drawbar up the pad.
  const back = HAUL_PLACE_HALF_Z + TRAILER_CENTRE_GAP_M;
  const x = pose.x - Math.sin(pose.yaw) * back;
  const z = pose.z - Math.cos(pose.yaw) * back;
  const yaw = pose.yaw + Math.PI;
  const trailer: TrailerState = {
    id,
    hitchedTo: null,
    // The thing itself is the load: its own mass on the bed, drawn as itself.
    cargoKg: contractThing(item).massKg,
    loadThing: item.thing,
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
  if (item.thing === 'bed') {
    trailer.load = BED_LOAD;
    trailer.cargoZ = TRAILER_BALL_Z - LONG_LOAD_BALL_CLEARANCE_M - BED_LOAD.halfExtents[2];
  }
  deps.world.apply({ t: 'trailer_add', trailer });
}

function spawnContractCar(
  deps: ContractWorldDeps,
  item: ContractCargoItem,
  pose: HaulPose,
): void {
  const id = contractCarId(item);
  if (deps.world.state.cars[id]) return;
  const def = pick(CAR_MODELS, item.generatedSeed, CAR_MODEL_DOMAIN);
  const measure = carModelMeasure(def.id);
  // Ahead of the haul's place: the trailer takes the space behind it. Two offers at the
  // same post would otherwise put two contract cars in one spot, so the seed
  // staggers this one across the verge and along the road by a couple of metres.
  const stagger = hash01(item.generatedSeed, CAR_STAGGER_DOMAIN, 0);
  const lateral = (stagger - 0.5) * 2.6;
  const ahead = HAUL_PLACE_HALF_Z + measure.halfExtents[2] + CAR_CENTRE_GAP_M + stagger * 2.2;
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
  // The broken toy car leaves for the repair with NO ENGINE: it cannot idle, it cannot
  // be driven, and the papers commission a tow rather than a drive. Removing the part
  // rather than destroying it is the honest state — there is nothing in the engine bay
  // to fail, and the car's own mass drops by the engine's.
  if (contractKindOf(item) === 'towing') car.bonnet[0] = null;
  deps.world.apply({ t: 'car_add', car });
}
