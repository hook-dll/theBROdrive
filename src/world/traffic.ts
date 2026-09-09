import type * as THREE from 'three';
import { emptyInput, type InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import { mulberry32 } from '../core/rng';
import { createServiceableCarState } from '../game/spawn';
import { GameWorld, newWorldState } from '../game/state';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { Autopilot, AUTOPILOT_MODES } from '../vehicle/autopilot';
import type { Settings } from '../game/settings';
import { CAR_MODELS } from '../vehicle/carmodels';
import { Vehicle } from '../vehicle/vehicle';
import { ReversedHazardIndex, type HazardField } from './hazards';
import type { WorldOrigin } from './origin';
import type { DriveRoad } from './road';
import { ReversedRoad } from './reversedroad';

/** Six physical cars are enough to make the road inhabited without becoming a queue. */
const MAX_TRAFFIC = 6;
const MAX_PER_DIRECTION = MAX_TRAFFIC / 2;
/** Cars appear well outside reaction distance and leave beyond the active physics band. */
const SPAWN_MIN_M = 360;
const SPAWN_MAX_M = 700;
const DESPAWN_M = 950;
/** Centreline separation at creation; long enough for even two buses to settle cleanly. */
const SPAWN_ROAD_GAP_M = 75;
const SPAWN_WORLD_GAP_M = 30;
const SPAWN_HAZARD_GAP_M = 18;
const TRAFFIC_HALF_WIDTH_M = 1.1;
const SPAWN_INTERVAL_S = 2.5;
const DROP_SETTLE_S = 0.8;
const LIFETIME_SAMPLE_S = 0.5;
const CLOCK_SYNC_S = 1;
const END_MARGIN_M = 80;
const TRAFFIC_ID_PREFIX = 'traffic:';

type TrafficDirection = 1 | -1;

interface TrafficCar {
  readonly id: string;
  readonly direction: TrafficDirection;
  readonly modelId: string;
  readonly spawnS: number;
  readonly vehicle: Vehicle;
  readonly autopilot: Autopilot;
  readonly input: InputFrame;
  forwardS: number;
  settleFor: number;
  lifetimeTimer: number;
}

interface PendingSpawn {
  readonly generation: number;
  readonly direction: TrafficDirection;
  readonly forwardS: number;
  readonly modelId: string;
  readonly id: string;
}

export interface TrafficStatus {
  readonly enabled: boolean;
  readonly count: number;
  readonly sameDirection: number;
  readonly oncoming: number;
  readonly pending: boolean;
  readonly allSleeper: boolean;
  readonly modelIds: readonly string[];
  readonly nearestRoadDistance: number;
  readonly movingSameDirection: number;
  readonly movingOncoming: number;
}

/**
 * A small, session-only stream of ordinary physical Vehicles around the player.
 *
 * Traffic owns a private GameWorld so fuel, temperature and automatic gearbox state
 * remain authoritative for Vehicle without temporary cars entering the player's save.
 * Models load one at a time, then the spawn is revalidated against the player's newer
 * position before a body is created. Disable invalidates in-flight work immediately.
 */
export class RoadTraffic {
  private readonly trafficWorld: GameWorld;
  private readonly reverseRoad: ReversedRoad;
  private readonly reverseHazards: ReversedHazardIndex;
  private readonly random: () => number;
  private readonly carList: TrafficCar[] = [];
  private enabledValue = false;
  private generation = 0;
  private serial = 0;
  private spawnCooldown = 0;
  private pending: PendingSpawn | null = null;
  private playerS = 0;
  private readonly position = { x: 0, y: 0, z: 0 };
  private settingsRef: Settings | null = null;
  private clockSync = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly sourceWorld: GameWorld,
    private readonly scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly road: DriveRoad,
    private readonly hazards: HazardField,
    private readonly prepareModel: (modelId: string) => Promise<void>,
    private readonly isSpawnClear: (x: number, z: number, radius: number) => boolean,
  ) {
    this.trafficWorld = new GameWorld(newWorldState(sourceWorld.seed));
    this.reverseRoad = new ReversedRoad(road);
    this.reverseHazards = new ReversedHazardIndex(hazards, road.length);
    this.random = mulberry32(sourceWorld.seed ^ 0x74726166);
    this.syncSettings();
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  get status(): TrafficStatus {
    let sameDirection = 0;
    let nearestRoadDistance = Infinity;
    let movingSameDirection = 0;
    let movingOncoming = 0;
    const modelIds: string[] = [];
    for (const car of this.carList) {
      if (car.direction === 1) {
        sameDirection++;
        if (car.forwardS > car.spawnS + 1) movingSameDirection++;
      } else if (car.forwardS < car.spawnS - 1) {
        movingOncoming++;
      }
      modelIds.push(car.modelId);
      nearestRoadDistance = Math.min(
        nearestRoadDistance,
        Math.abs(car.forwardS - this.playerS),
      );
    }
    return {
      enabled: this.enabledValue,
      count: this.carList.length,
      sameDirection,
      oncoming: this.carList.length - sameDirection,
      pending: this.pending !== null,
      allSleeper: this.carList.every((car) => car.autopilot.mode === 'sleeper'),
      modelIds,
      nearestRoadDistance,
      movingSameDirection,
      movingOncoming,
    };
  }

  setEnabled(enabled: boolean): void {
    if (this.enabledValue === enabled) return;
    this.enabledValue = enabled;
    this.generation++;
    this.pending = null;
    this.spawnCooldown = enabled ? 0 : SPAWN_INTERVAL_S;
    if (enabled) this.clockSync = 0;
    if (!enabled) this.clear();
  }

  toggle(): boolean {
    this.setEnabled(!this.enabledValue);
    return this.enabledValue;
  }

  /** Writes every traffic controller before the shared physics step. */
  fixedUpdate(dt: number, playerS: number, originX: number, originZ: number): void {
    this.playerS = playerS;
    if (!this.enabledValue && this.carList.length === 0) return;
    this.syncSettings();
    this.clockSync -= dt;
    if (this.clockSync <= 0) {
      this.trafficWorld.apply({
        t: 'time_of_day',
        timeOfDay: this.sourceWorld.state.timeOfDay,
      });
      this.clockSync = CLOCK_SYNC_S;
    }

    for (let i = this.carList.length - 1; i >= 0; i--) {
      const car = this.carList[i]!;
      car.lifetimeTimer -= dt;
      if (car.lifetimeTimer <= 0) {
        car.vehicle.absoluteTranslation(this.position);
        car.forwardS = this.road.project(this.position.x, this.position.z, car.forwardS).s;
        car.lifetimeTimer = LIFETIME_SAMPLE_S;
        if (Math.abs(car.forwardS - playerS) > DESPAWN_M) {
          this.removeAt(i);
          continue;
        }
      }
      if (car.settleFor > 0) {
        car.settleFor -= dt;
        car.vehicle.settle(dt);
      } else {
        car.autopilot.drive(dt, car.vehicle, car.input, originX, originZ);
        car.vehicle.fixedUpdate(dt, car.input);
      }
    }

    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0 && this.pending === null && this.carList.length < MAX_TRAFFIC) {
      this.queueSpawn();
      this.spawnCooldown = SPAWN_INTERVAL_S;
    }
  }

  postStep(): void {
    for (const car of this.carList) car.vehicle.postStep();
  }

  syncVisuals(alpha: number): void {
    for (const car of this.carList) car.vehicle.syncVisuals(alpha);
  }

  dispose(): void {
    this.enabledValue = false;
    this.generation++;
    this.pending = null;
    this.clear();
  }

  private syncSettings(): void {
    const source = this.sourceWorld.state.settings;
    if (this.settingsRef === source && this.trafficWorld.state.settings.gearboxMode === 'automatic') {
      return;
    }
    this.settingsRef = source;
    this.trafficWorld.apply({
      t: 'settings',
      settings: {
        ...source,
        gearboxMode: 'automatic',
        keyBindings: { ...source.keyBindings },
      },
    });
  }

  private queueSpawn(): void {
    const direction = this.nextDirection();
    if (direction === null) return;
    const forwardS = this.findSpawnS(direction);
    if (forwardS === null) return;
    const model = CAR_MODELS[Math.floor(this.random() * CAR_MODELS.length)]!;
    const request: PendingSpawn = {
      generation: this.generation,
      direction,
      forwardS,
      modelId: model.id,
      id: `${TRAFFIC_ID_PREFIX}${(this.serial++).toString(36)}`,
    };
    this.pending = request;
    void this.prepareModel(request.modelId)
      .then(() => this.finishSpawn(request))
      .catch((error: unknown) => console.error(`failed to load traffic model "${request.modelId}"`, error))
      .finally(() => {
        if (this.pending === request) this.pending = null;
      });
  }

  private finishSpawn(request: PendingSpawn): void {
    if (
      !this.enabledValue ||
      request.generation !== this.generation ||
      this.pending !== request ||
      Math.abs(request.forwardS - this.playerS) < SPAWN_MIN_M ||
      Math.abs(request.forwardS - this.playerS) > SPAWN_MAX_M
    ) {
      return;
    }
    if (!this.spawnSiteClear(request.forwardS, request.direction)) return;

    const roadPoint = this.road.sampleAt(request.forwardS);
    const forwardLateral =
      request.direction === 1
        ? AUTOPILOT_MODES.sleeper.laneOffset
        : -AUTOPILOT_MODES.sleeper.laneOffset;
    const x = roadPoint.x + Math.cos(roadPoint.heading) * forwardLateral;
    const z = roadPoint.z - Math.sin(roadPoint.heading) * forwardLateral;
    if (!this.isSpawnClear(x, z, SPAWN_WORLD_GAP_M)) return;

    const heading = roadPoint.heading + (request.direction === -1 ? Math.PI : 0);
    const y = carSpawnYAboveGround(carModelMeasure(request.modelId), roadPoint.y);
    const state = createServiceableCarState(
      request.id,
      request.modelId,
      x,
      y,
      z,
      heading,
    );
    this.trafficWorld.apply({ t: 'car_add', car: state });
    const vehicle = new Vehicle(
      this.physics,
      this.trafficWorld,
      state,
      this.scene,
      this.origin,
    );
    const autopilot = new Autopilot(
      request.direction === 1 ? this.road : this.reverseRoad,
      request.direction === 1 ? this.hazards : this.reverseHazards,
      this.physics,
    );
    autopilot.setMode('sleeper');
    autopilot.setEngaged(true);
    this.carList.push({
      id: request.id,
      direction: request.direction,
      vehicle,
      modelId: request.modelId,
      spawnS: request.forwardS,
      autopilot,
      input: emptyInput(),
      forwardS: request.forwardS,
      settleFor: DROP_SETTLE_S,
      lifetimeTimer: LIFETIME_SAMPLE_S,
    });
  }

  private nextDirection(): TrafficDirection | null {
    let same = 0;
    let oncoming = 0;
    for (const car of this.carList) {
      if (car.direction === 1) same++;
      else oncoming++;
    }
    if (same >= MAX_PER_DIRECTION && oncoming >= MAX_PER_DIRECTION) return null;
    if (same === 0 || oncoming >= MAX_PER_DIRECTION) return 1;
    if (oncoming === 0 || same >= MAX_PER_DIRECTION) return -1;
    return this.random() < 0.5 ? 1 : -1;
  }

  private findSpawnS(direction: TrafficDirection): number | null {
    for (let attempt = 0; attempt < 8; attempt++) {
      const distance = SPAWN_MIN_M + this.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
      const s = this.playerS + distance;
      if (s < END_MARGIN_M || s > this.road.length - END_MARGIN_M) continue;
      if (this.spawnSiteClear(s, direction)) return s;
    }
    return null;
  }

  private spawnSiteClear(s: number, direction: TrafficDirection): boolean {
    if (!this.roadGapClear(s)) return false;
    const lane =
      direction === 1
        ? AUTOPILOT_MODES.sleeper.laneOffset
        : -AUTOPILOT_MODES.sleeper.laneOffset;
    let clear = true;
    this.hazards.forEachAhead(
      Math.max(0, s - SPAWN_HAZARD_GAP_M),
      SPAWN_HAZARD_GAP_M * 2,
      (hazard) => {
        if (Math.abs(hazard.lateral - lane) <= hazard.radius + TRAFFIC_HALF_WIDTH_M) {
          clear = false;
        }
      },
    );
    return clear;
  }

  private roadGapClear(s: number): boolean {
    for (const car of this.carList) {
      if (Math.abs(car.forwardS - s) < SPAWN_ROAD_GAP_M) return false;
    }
    return true;
  }

  private removeAt(index: number): void {
    const car = this.carList[index]!;
    car.autopilot.setEngaged(false);
    car.vehicle.dispose();
    this.trafficWorld.apply({ t: 'car_remove', carId: car.id });
    this.carList.splice(index, 1);
  }

  private clear(): void {
    for (let i = this.carList.length - 1; i >= 0; i--) this.removeAt(i);
  }
}
