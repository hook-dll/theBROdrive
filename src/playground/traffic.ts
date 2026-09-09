import type * as THREE from 'three';
import { emptyInput, type InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import type { GameWorld } from '../game/state';
import { Autopilot, AUTOPILOT_MODES, type AutopilotMode } from '../vehicle/autopilot';
import { Vehicle } from '../vehicle/vehicle';
import { HazardIndex } from '../world/hazards';
import type { WorldOrigin } from '../world/origin';
import { playgroundCarState } from './car';
import { PLAYGROUND_ORIGIN_X, PLAYGROUND_ORIGIN_Z, type PlaygroundCircuit } from './circuit';
import type { PlaygroundRoad } from './playgroundroad';
import { ReversedPlaygroundRoad } from './reversedroad';

/**
 * OTHER CARS, so that lane discipline and overtaking have something to be about.
 *
 * Every one of these is a full `Vehicle` with the shipped `Autopilot` on it — the
 * same class the player's car uses, at the same fixed step. Nothing here is a
 * kinematic dummy sliding along the centreline: the ego car's corridor probes see
 * real dynamic bodies, a pass has to fit between real widths, and a car that is
 * baulked really does queue up behind the one in front.
 *
 * The oncoming half drive `ReversedPlaygroundRoad`, so they hold THEIR right-hand
 * lane, which is the ego car's left. That is what puts a real cost on using the
 * other side of the road.
 */

/** Where a traffic car starts, in forward-lap arclength. */
export interface TrafficSlot {
  readonly s: number;
  readonly oncoming: boolean;
  readonly mode: AutopilotMode;
}

/**
 * The layout, chosen to make the interesting cases happen early and often:
 * four cars strung along the 700 m main straight and into the sweeper, so a frantic
 * ego car starting on the line meets a queue within seconds; two coming the other
 * way, spaced most of a lap apart, so some passing windows are clear and some are
 * not.
 */
export const TRAFFIC_SLOTS: readonly TrafficSlot[] = [
  { s: 95, oncoming: false, mode: 'sleeper' },
  { s: 205, oncoming: false, mode: 'sleeper' },
  { s: 355, oncoming: false, mode: 'sleeper' },
  { s: 560, oncoming: false, mode: 'sleeper' },
  { s: 1_250, oncoming: true, mode: 'sleeper' },
  { s: 2_150, oncoming: true, mode: 'sleeper' },
];

/** Lateral offset a stowed car is parked at, metres: out on the sand, out of the way. */
const STOW_LATERAL_M = -30;
/** Ride height the cars are dropped from, metres above the surface. */
const DROP_HEIGHT_M = 1.2;
/**
 * Seconds after being placed before a parked car pulls its handbrake.
 *
 * `Vehicle` turns a handbraked car at rest into a physically FIXED body, and a car
 * dropped from ride height is at rest in the only axis it tests — so pulling the
 * brake immediately froze the car in mid-air, 1.2 m up, where a corridor probe
 * passes underneath it and the obstacle the bench meant to place did not exist.
 */
const SETTLE_SECONDS = 0.8;
/**
 * Speed the traffic is held to, m/s. Slower than the careful mode's own cruise on
 * purpose: 50 km/h against a frantic ego is a real differential to overtake into,
 * and without one there is nothing to test — this lap's gradients hold everything to
 * roughly the same speed however fast its mode wants to go.
 */
const TRAFFIC_SPEED_CAP_MPS = 50 / 3.6;

export type TrafficState = 'rolling' | 'parked' | 'stowed';

export interface TrafficCar {
  readonly id: string;
  readonly vehicle: Vehicle;
  readonly autopilot: Autopilot;
  readonly input: InputFrame;
  readonly slot: TrafficSlot;
  /** Signed lateral of the lane it holds, in FORWARD-lap coordinates. */
  readonly lateral: number;
  /** Seconds left before it may hold itself still. See `SETTLE_SECONDS`. */
  settleFor: number;
}

export class PlaygroundTraffic {
  private readonly carList: TrafficCar[] = [];
  private stateValue: TrafficState = 'rolling';

  constructor(
    private readonly physics: PhysicsWorld,
    world: GameWorld,
    scene: THREE.Scene,
    origin: WorldOrigin,
    forward: PlaygroundRoad,
    private readonly circuit: PlaygroundCircuit,
    models: readonly string[],
    /** Layout to spawn. A bench overrides it to build one exact situation. */
    private readonly slots: readonly TrafficSlot[] = TRAFFIC_SLOTS,
  ) {
    // One reversed view is shared by every oncoming car: it is a pure projection of
    // the circuit, so it holds no per-car state. Built at the lap's own origin
    // constants, which is what makes its geometry the same asphalt.
    const reversed = new ReversedPlaygroundRoad(
      forward.seed,
      PLAYGROUND_ORIGIN_X,
      PLAYGROUND_ORIGIN_Z,
    );
    // The hazard index is shared and empty: the playground has no indexed props, so
    // traffic must discover the ego car the same way the ego car discovers it.
    const hazards = new HazardIndex();
    this.slots.forEach((slot, index) => {
      const lane = AUTOPILOT_MODES[slot.mode].laneOffset;
      const lateral = slot.oncoming ? -lane : lane;
      const id = `traffic-${index}`;
      const modelId = models[index % models.length]!;
      const at = this.poseFor(slot, lateral);
      const state = playgroundCarState(id, modelId, at.x, at.y, at.z, at.heading);
      world.state.cars[id] = state;
      const vehicle = new Vehicle(this.physics, world, state, scene, origin);
      const autopilot = new Autopilot(slot.oncoming ? reversed : forward, hazards, this.physics);
      autopilot.setMode(slot.mode);
      autopilot.setSpeedCap(TRAFFIC_SPEED_CAP_MPS);
      autopilot.setEngaged(true);
      this.carList.push({
        id,
        vehicle,
        autopilot,
        input: emptyInput(),
        slot,
        lateral,
        settleFor: SETTLE_SECONDS,
      });
    });
  }

  get cars(): readonly TrafficCar[] {
    return this.carList;
  }

  get state(): TrafficState {
    return this.stateValue;
  }

  /**
   * `rolling` drives, `parked` leaves them standing in their lane as obstacles, and
   * `stowed` puts them out on the sand so a mode can be watched on an empty lap.
   */
  setState(state: TrafficState): void {
    this.stateValue = state;
    this.reset();
  }

  /** Puts every car back on its slot, in the current state. */
  reset(): void {
    for (const car of this.carList) {
      const stowed = this.stateValue === 'stowed';
      const at = this.poseFor(car.slot, stowed ? STOW_LATERAL_M : car.lateral);
      car.vehicle.rescueTo(at.x, at.y, at.z, at.heading);
      car.autopilot.setEngaged(this.stateValue === 'rolling');
      car.settleFor = SETTLE_SECONDS;
      const input = car.input;
      input.throttle = 0;
      // The foot brake holds it while it drops; the handbrake, which is what freezes
      // the body in place, waits until it is actually standing on the road.
      input.brake = this.stateValue === 'rolling' ? 0 : 1;
      input.steer = 0;
      input.reverse = false;
      input.handbrake = false;
    }
  }

  /** Drives and integrates every car. The caller owns `physics.step()`. */
  fixedUpdate(dt: number, originX: number, originZ: number): void {
    for (const car of this.carList) {
      if (car.settleFor > 0) {
        car.settleFor -= dt;
        if (car.settleFor <= 0 && this.stateValue !== 'rolling') car.input.handbrake = true;
      }
      if (this.stateValue === 'rolling') {
        car.autopilot.drive(dt, car.vehicle, car.input, originX, originZ);
      }
      car.vehicle.fixedUpdate(dt, car.input);
    }
  }

  postStep(): void {
    for (const car of this.carList) car.vehicle.postStep();
  }

  syncVisuals(alpha: number): void {
    for (const car of this.carList) car.vehicle.syncVisuals(alpha);
  }

  dispose(): void {
    for (const car of this.carList) car.vehicle.dispose();
    this.carList.length = 0;
  }

  /** World pose of a slot at a lateral offset, dropped just above the surface. */
  private poseFor(
    slot: TrafficSlot,
    lateral: number,
  ): { x: number; y: number; z: number; heading: number } {
    const at = this.circuit.sampleAt(slot.s);
    return {
      x: at.x + Math.cos(at.heading) * lateral,
      y: this.circuit.surfaceY(slot.s, lateral) + DROP_HEIGHT_M,
      z: at.z - Math.sin(at.heading) * lateral,
      heading: at.heading + (slot.oncoming ? Math.PI : 0),
    };
  }
}
