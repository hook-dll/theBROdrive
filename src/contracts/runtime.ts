/**
 * The per-tick walk over live contracts. It visits the places a contract cargo
 * can be and the hauls taken (`WorldState.hauls`, place `haul`), runs the urgent clocks
 * from the moment a contract leaves its source post's stock and hands each contract to
 * the composition root (the delivery target).
 *
 * Nothing is scored on the way but a thing's condition (game-design2.md §11.1): the
 * knocks the car it rides in takes, the harsh driving of the car the player drives
 * (trip/ride.ts) and its drops to the ground wear it down. What reaches it through a car
 * is softened by that car's comfort (`comfortFactor`, §11.2). Below `BROKEN_BELOW` it is
 * broken: the contract closes there and then, undelivered, and is FINED
 * (economy/economy.ts `fine`, `FINE_SHELLS`) in the same step — the break is saved on the
 * item (`progress.broken`) and is found already made after a reload, so it is never fined
 * twice; the thing stays a souvenir, and handing it back later fines nothing more. The
 * tick scans state rather than holding its own list of contracts, so an item picked up,
 * swapped into another boot or dropped is followed with no bookkeeping.
 */

import { fine, FINE_SHELLS, formatFine } from '../economy/economy';
import type { CarState, GameWorld } from '../game/state';
import { contractIdOf, contractThing, type ContractCargoItem, type Item } from '../items/items';
import { thingWears, thingWearShare } from '../items/things';
import type { RideMeter } from '../trip/ride';
import { carModel, comfortFactor, type CarComfort } from '../vehicle/carmodels';
import { BROKEN_BELOW, defaultProgress, type ContractPlace } from './types';

/**
 * Called for every live contract, once per tick, with where it is and which car carries
 * it: a thing's item, or a taken haul's card (place `haul`, no car). The composition root
 * gathers the HUD's delivery target from it.
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
 * the paint (`SCRATCH_*`, vehicle/vehicletuning.ts: (severity − 1.8 m/s) × 0.06), read
 * from the body's unsaturated running total (`CarImpacts`). A
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
 * True only on the wear that broke it.
 */
export function wearThing(item: ContractCargoItem, wear: number): boolean {
  if (wear <= 0 || item.progress.broken) return false;
  const condition = Math.max(0, (item.progress.condition ?? 1) - wear);
  item.progress.condition = condition;
  if (condition >= BROKEN_BELOW) return false;
  item.progress.broken = true;
  return true;
}

/**
 * The shell damage a live car has taken since it was built (vehicle/vehicle.ts
 * `impactTotal`), or null for a car with no live body. Unlike `CarState.scratches` it never
 * saturates and the sponge never lowers it, so a fully scratched car still passes on its
 * knocks.
 */
export type CarImpacts = (carId: string) => number | null;

export class ContractRuntime {
  /** Each live car's `impactTotal` at the last tick, to see the knocks it took since. */
  private readonly lastImpact = new Map<string, number>();
  /** Where each live thing was at the last tick, to see a drop (runtime-only). */
  private readonly lastPlace = new Map<string, ContractPlace>();
  /** Simulation seconds the urgent clocks advance this tick (`tick`). */
  private clockS = 0;

  constructor(
    private readonly world: GameWorld,
    private readonly ride: RideMeter,
    private readonly impacts: CarImpacts,
    /** A one-line message on the HUD: the thing broken and the fine it cost. */
    private readonly notify: (text: string) => void,
  ) {}

  /**
   * One fixed step. `clockS` is what the urgent clocks advance: the step's simulation
   * seconds, or 0 while the watch winds the day forward. A paused game or an open menu
   * runs no step at all, so no clock moves then.
   */
  tick(onContractItem: ContractItemVisitor, clockS: number): void {
    this.clockS = clockS;
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
    // What TAKE gave into a post machine's grid: out of the stock, its clock running.
    for (const key of Object.keys(state.machineGrids)) {
      const cells = state.machineGrids[key];
      if (!cells) continue;
      for (const item of cells) {
        if (isCargo(item)) this.visit(item, 'machine', null, 0, onContractItem);
      }
    }
    // The hauls taken: the card is the contract, the load is in the world.
    for (const haul of Object.values(state.hauls)) this.visit(haul.contract, 'haul', null, 0, onContractItem);
  }

  /** `carBorneWear` of the knocks `car` took since the last tick and the ride driven in it. */
  private carWear(carId: string, car: CarState, rideExcess: number): number {
    const impact = this.impacts(carId);
    let knock = 0;
    if (impact === null) this.lastImpact.delete(carId);
    else {
      // A body built afresh starts its total at 0: no knock from that.
      knock = Math.max(0, impact - (this.lastImpact.get(carId) ?? impact));
      this.lastImpact.set(carId, impact);
    }
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
    onContractItem(item, place, carId);
    // A hand-made or very old item may lack the record; the runtime owns it.
    if (!item.progress) item.progress = defaultProgress();
    // The urgent clock runs from TAKE, wherever the thing is (`ContractProgress.elapsedS`).
    if (place !== 'post' && item.urgentS !== undefined && !item.progress.broken && this.clockS > 0) {
      item.progress.elapsedS = (item.progress.elapsedS ?? 0) + this.clockS;
    }
    const thing = contractThing(item);
    if (!thingWears(thing) || item.progress.broken) return;
    const previous = this.lastPlace.get(item.id);
    this.lastPlace.set(item.id, place);
    const dropped = place === 'loose' && (previous === 'hand' || previous === 'car');
    if (!wearThing(item, (carWear + (dropped ? DROP_WEAR : 0)) * thingWearShare(thing))) return;
    // Broken: its job closed undelivered there and then, and fined with the break — unless
    // the job was closed already and this is only its souvenir.
    if (this.world.state.completedContractIds.includes(contractIdOf(item))) return;
    this.notify(`the ${thing.name} broke — the job is off, ${formatFine(fine(this.world, FINE_SHELLS))}`);
  }
}
