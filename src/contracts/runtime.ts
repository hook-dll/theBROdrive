/**
 * The per-tick walk over live contracts. It visits the places a contract cargo
 * can be, marks the cargo started once it has left its source post, and hands
 * each item to the composition root (world objects, race, delivery target).
 *
 * Nothing is scored on the way but a thing's condition (game-design2.md §11.1): the
 * knocks the car it rides in takes, the harsh driving of the car the player drives
 * (trip/ride.ts) and its drops to the ground wear it down. What reaches it through a car
 * is softened by that car's comfort (`comfortFactor`, §11.2). Below `BROKEN_BELOW` it is
 * broken: the contract closes there and then, and the thing stays a souvenir. The tick
 * scans state rather than holding its own list of contracts, so an item picked up,
 * swapped into another boot or dropped is followed with no bookkeeping.
 */

import type { CarState, GameWorld } from '../game/state';
import { contractThing, type ContractCargoItem, type Item } from '../items/items';
import { thingWears, thingWearShare } from '../items/things';
import type { RideMeter } from '../trip/ride';
import { carModel, comfortFactor, type CarComfort } from '../vehicle/carmodels';
import { BROKEN_BELOW, defaultProgress, type ContractPlace } from './types';

/**
 * Called for every live cargo item, once per tick, with where it is and which car
 * carries it. The composition root uses it to keep the contract's own world objects
 * (a loaded trailer, a car to be transferred) spawned exactly once: the callback only
 * fires for cargo that exists, so a delivered one cannot be re-created.
 */
export type ContractItemVisitor = (item: ContractCargoItem, place: ContractPlace, carId: string | null) => void;

function isCargo(item: Item | null | undefined): item is ContractCargoItem {
  return item?.type === 'contract_cargo';
}

/*
 * WEAR RATES, for a fragile thing in a comfort-1 car (factor 1). An ordinary thing takes
 * `thingWearShare` of each (items/things.ts), so in practice only a crash marks it.
 */

/**
 * Condition lost per unit of shell damage the car takes: the same knocks that scratch
 * the paint (`SCRATCH_*`, vehicle/vehicletuning.ts: (severity − 1.8 m/s) × 0.06). A
 * 5 m/s shunt scratches 0.19, so it costs a fragile thing 29% in a comfort-1 car, 20% in
 * a comfort-3 one and 13% in a comfort-5 one; an ordinary thing a fifth of that (4% at
 * comfort 3). Three hard shunts in a comfort-3 car break a fragile thing.
 */
const WEAR_PER_SCRATCH = 1.5;
/**
 * Condition lost per (m/s² above `RIDE_EASY_MPS2`) · second of the driven car's ride: a
 * five-second 0.5 g stop (12.5) costs a fragile thing 5% at comfort 1, 3.5% at comfort
 * 3. Driving that stays under 2.5 m/s² (pulling away, a firm stop at a junction, a brisk
 * bend) costs nothing, so a calm drive delivers it whole.
 */
const WEAR_PER_RIDE_EXCESS = 1 / 250;
/** One drop onto the ground from a hand or a boot: no car between it and the ground. */
const DROP_WEAR = 0.12;

/**
 * What a car passes on to a fragile thing it carries this tick: its knock and, for the car
 * the player drives, the ride's harshness, softened by its comfort.
 */
export function carBorneWear(comfort: CarComfort, knock: number, rideExcess: number): number {
  return (knock * WEAR_PER_SCRATCH + rideExcess * WEAR_PER_RIDE_EXCESS) * comfortFactor(comfort);
}

/**
 * Takes `wear` (already scaled by the thing's own share) off the item's condition, and
 * breaks it the moment it falls under `BROKEN_BELOW`. A broken thing wears no further.
 */
export function wearThing(item: ContractCargoItem, wear: number): void {
  if (wear <= 0 || item.progress.broken) return;
  const condition = Math.max(0, (item.progress.condition ?? 1) - wear);
  item.progress.condition = condition;
  if (condition < BROKEN_BELOW) item.progress.broken = true;
}

export class ContractRuntime {
  /** Each car's `scratches` at the last tick, to see the knocks it took since. */
  private readonly lastScratches = new Map<string, number>();
  /** Where each live thing was at the last tick, to see a drop (runtime-only). */
  private readonly lastPlace = new Map<string, ContractPlace>();

  constructor(
    private readonly world: GameWorld,
    private readonly ride: RideMeter,
  ) {}

  tick(onContractItem: ContractItemVisitor): void {
    const state = this.world.state;
    const player = state.player;
    // The ride is the car the player drives; whatever was driven since the last tick.
    const rideExcess = this.ride.takeExcess();
    const drivenId = player.drivingCarId !== null && player.seat === 'driver' ? player.drivingCarId : null;
    // What is in his hands rides with him, in whichever seat.
    let handWear = 0;
    for (const carId of Object.keys(state.cars)) {
      const car = state.cars[carId];
      if (!car) continue;
      const wear = this.carWear(carId, car, carId === drivenId ? rideExcess : 0);
      if (carId === player.drivingCarId) handWear = wear;
      for (const item of car.storage) {
        if (isCargo(item)) this.visit(item, 'car', carId, wear, onContractItem);
      }
      for (const item of car.cabin) {
        if (isCargo(item)) this.visit(item, 'car', carId, wear, onContractItem);
      }
    }
    for (const item of player.carried) {
      if (isCargo(item)) this.visit(item, 'hand', null, handWear, onContractItem);
    }
    for (const key of Object.keys(state.looseItems)) {
      const item = state.looseItems[key]?.item;
      if (isCargo(item)) this.visit(item, 'loose', null, 0, onContractItem);
    }
    // The offers still in a post's stock (`courierStorage`, a saved key).
    for (const key of Object.keys(state.courierStorage)) {
      const cells = state.courierStorage[key];
      if (!cells) continue;
      for (const item of cells) {
        if (isCargo(item)) this.visit(item, 'post', null, 0, onContractItem);
      }
    }
  }

  /** `carBorneWear` of the knocks `car` took since the last tick and the ride driven in it. */
  private carWear(carId: string, car: CarState, rideExcess: number): number {
    // Only gains count: the sponge polishing scratches off is no knock.
    const knock = Math.max(0, car.scratches - (this.lastScratches.get(carId) ?? car.scratches));
    this.lastScratches.set(carId, car.scratches);
    if (knock <= 0 && rideExcess <= 0) return 0;
    return carBorneWear(carModel(car.modelId).comfort, knock, rideExcess);
  }

  private visit(
    item: ContractCargoItem,
    place: ContractPlace,
    carId: string | null,
    carWear: number,
    onContractItem: ContractItemVisitor,
  ): void {
    // The kind's own world object (a contract trailer or car) is ensured before
    // anything else reads the item.
    onContractItem(item, place, carId);
    // A hand-made or very old item may lack the record; the runtime owns it.
    if (!item.progress) item.progress = defaultProgress();
    if (place !== 'post') item.progress.started = true;
    const thing = contractThing(item);
    if (!thingWears(thing) || item.progress.broken) return;
    const previous = this.lastPlace.get(item.id);
    this.lastPlace.set(item.id, place);
    const dropped = place === 'loose' && (previous === 'hand' || previous === 'car');
    wearThing(item, (carWear + (dropped ? DROP_WEAR : 0)) * thingWearShare(thing));
  }
}
