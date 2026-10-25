/**
 * The world objects a haul is about: the loaded trailer of a trailer load, and the car
 * of a car to tow or to drive over.
 *
 * A contract names its object after the offer (`generatedSeed`), so the same trailer
 * or car is the same object across a session, a save and a reload, with nothing
 * extra stored: `contract-trailer:<seed>` and `contract-car:<seed>` are in world
 * state like any other trailer or car.
 *
 * SPAWNED ONCE, ON THE FIRST PICKUP. The object appears in the SOURCE post's haul bay
 * (world/haulbay.ts) the first time the cargo leaves that post's stock (its lever hands
 * over the papers), nose out as if reversed in, which is the moment the contract becomes
 * physical. The guard is plain existence — an id already in state
 * is never spawned again — so dropping and re-picking the cargo, stowing it in
 * another boot, or reloading a save cannot duplicate the object, and after delivery
 * the cargo is gone and there is nothing left to drive a respawn.
 *
 * `ContractRuntime.tick` calls this for every live cargo item
 * (`ContractTickInput.onContractItem`), so it also heals a save written before the
 * kind existed: the next tick spawns what the contract was missing.
 */

import { pick } from '../core/rng';
import type { CarState, GameWorld, TrailerLoad, TrailerState } from '../game/state';
import { createServiceableCarState, poseOnGround } from '../game/spawn';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { CAR_MODELS } from '../vehicle/carmodels';
import { TRAILER_BALL_Z, TRAILER_HALF_LENGTH, TRAILER_SPAWN_HEIGHT } from '../vehicle/trailer';
import { contractKindOf, contractThing, type ContractCargoItem } from '../items/items';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';
import { postHaulBay, type HaulBay } from '../world/haulbay';
import type { ContractPlace } from './types';

/** 'CTC1': the car model. */
const CAR_MODEL_DOMAIN = 0x43544331;
/**
 * The loaded trailer is set down this far above its settled ride height, m, not
 * dropped. Dropped 0.5 m, it lands wheels first, the nose comes down on the prop leg
 * and bounces back up 13°; a piano rides high enough (its centre of mass 0.53 m over
 * the axle, 0.16 m ahead of it) that anything past 17° tips the trailer onto its tail,
 * and it stood there at 28° nose-up on the lay-by. Set down 0.085 m it settles within
 * 0.8° (measured in game, 230 kg).
 */
const TRAILER_SETTLE_CLEARANCE_M = 0.085;

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
 * The long load (game-design2.md §7.3): the bed with its frame and boards, 3.2 m long and
 * 1.6 m wide against the KMZ's 1.9 x 1.26 m box, so it lies across the tops of the sides
 * (vehicle/trailer.ts), overhangs both ends and is what the traffic and the rocks get to
 * hit. Centred on the box, its front end clears the ball by half a metre for the drawbar
 * to swing under. Every other load stands on the deck.
 */
const BED_LOAD: TrailerLoad = { halfExtents: [0.8, 0.28, 1.6] };

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
  const bay = postHaulBay(deps.world.seed, deps.road, item.sourceCourierIndex);
  if (kind === 'trailer') spawnContractTrailer(deps, item, bay);
  else spawnContractCar(deps, item, bay);
}

function spawnContractTrailer(
  deps: ContractWorldDeps,
  item: ContractCargoItem,
  bay: HaulBay,
): void {
  const id = contractTrailerId(item);
  if (deps.world.state.trailers[id]) return;
  // Drawbar out of the opening, the trailer's length from its tail to the ball centred
  // in the bay: a car backs up to the ball from the pad.
  const back = (TRAILER_BALL_Z - TRAILER_HALF_LENGTH) / 2;
  const yaw = bay.yaw;
  const x = bay.x - Math.sin(yaw) * back;
  const z = bay.z - Math.cos(yaw) * back;
  const trailer: TrailerState = {
    id,
    hitchedTo: null,
    // The thing itself is the load: its own mass on the bed, drawn as itself.
    cargoKg: contractThing(item).massKg,
    loadThing: item.thing,
    // Loaded the way a load goes on a trailer, against the headboard: a metre forward
    // is further than any box holds a thing, so the trailer stands it as far forward
    // as its box lets it (`Trailer.cargoZ`). That ahead-of-the-axle placement is what
    // puts a towable share of the weight on the ball of a KMZ, whose axle sits under
    // the middle of its box; a thing as long as the box simply stays in the middle.
    cargoZ: 1,
    x,
    // Set down on its own suspension; see TRAILER_SETTLE_CLEARANCE_M.
    y: deps.terrain.heightAt(x, z, bay.s) + TRAILER_SPAWN_HEIGHT + TRAILER_SETTLE_CLEARANCE_M,
    z,
    qx: 0,
    qy: Math.sin(yaw / 2),
    qz: 0,
    qw: Math.cos(yaw / 2),
  };
  if (item.thing === 'bed') trailer.load = BED_LOAD;
  deps.world.apply({ t: 'trailer_add', trailer });
}

function spawnContractCar(
  deps: ContractWorldDeps,
  item: ContractCargoItem,
  bay: HaulBay,
): void {
  const id = contractCarId(item);
  if (deps.world.state.cars[id]) return;
  const def = pick(CAR_MODELS, item.generatedSeed, CAR_MODEL_DOMAIN);
  const measure = carModelMeasure(def.id);
  // In the middle of the bay, nose out: the longest car has 0.86 m either end.
  const { x, z, yaw } = bay;
  const plane = poseOnGround(measure.wheels, x, z, yaw, (gx, gz) => deps.terrain.heightAt(gx, gz));
  const groundY = plane ? plane.groundY : deps.terrain.heightAt(x, z, bay.s);
  const car: CarState = createServiceableCarState(
    id,
    def.id,
    x,
    carSpawnYAboveGround(measure, groundY),
    z,
    yaw,
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
