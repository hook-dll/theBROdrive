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

/**
 * Thirty physical cars is the upper setting: enough for a dense road while keeping the
 * full Vehicle + Autopilot path affordable on a capable machine.
 */
const MAX_TRAFFIC = 30;
const SPAWN_MIN_M = 140;
const SPAWN_MAX_M = 700;
const DESPAWN_M = 850;
/** Same-lane separation for the normal stream; dense 30-car mode packs to 32 m. */
const SPAWN_ROAD_GAP_M = 70;
const DENSE_SPAWN_ROAD_GAP_M = 32;
const SPAWN_WORLD_GAP_M = 30;
const SPAWN_HAZARD_GAP_M = 18;
/** Never materialize an opposing car inside a pass that was clear when committed. */
const PASSING_SPAWN_EXCLUSION_M = 300;
const TRAFFIC_HALF_WIDTH_M = 1.1;
const SPAWN_INTERVAL_S = 1;
const DENSE_SPAWN_INTERVAL_S = 0.5;
const DROP_SETTLE_S = 0.8;
/** Traffic starts at its fitted wheel-contact height; settle mode handles road grade. */
const TRAFFIC_SPAWN_DROP_M = 0;
const SPAWN_GROUND_PROBE_UP_M = 2;
const SPAWN_GROUND_PROBE_DEPTH_M = 4;
const LIFETIME_SAMPLE_S = 0.5;
const CLOCK_SYNC_S = 1;
const END_MARGIN_M = 80;
const TRAFFIC_ID_PREFIX = 'traffic:';
const DEADLOCK_ROAD_GAP_M = 18;
const DEADLOCK_STOP_SPEED_MPS = 1.5;

type TrafficDirection = 1 | -1;
export type TrafficDriverStyle = 'cautious' | 'normal' | 'hurried';


interface TrafficCar {
  readonly id: string;
  readonly direction: TrafficDirection;
  readonly modelId: string;
  readonly spawnS: number;
  readonly vehicle: Vehicle;
  readonly autopilot: Autopilot;
  readonly style: TrafficDriverStyle;
  readonly speedCap: number;
  roadLateral: number;
  readonly input: InputFrame;
  forwardS: number;
  settleFor: number;
  lifetimeTimer: number;
  wasPassing: boolean;
}

interface PendingSpawn {
  readonly generation: number;
  readonly direction: TrafficDirection;
  readonly forwardS: number;
  readonly modelId: string;
  readonly id: string;
  readonly style: TrafficDriverStyle;
  readonly mode: 'sleeper' | 'frantic';
  readonly speedCap: number;
}

export interface TrafficStatus {
  readonly enabled: boolean;
  readonly count: number;
  readonly sameDirection: number;
  readonly oncoming: number;
  readonly pending: boolean;
  readonly sleeper: number;
  readonly frantic: number;
  readonly cautious: number;
  readonly passing: number;
  readonly passes: number;
  readonly impacts: number;
  readonly modelIds: readonly string[];
  readonly nearestRoadDistance: number;
  readonly movingSameDirection: number;
  readonly movingOncoming: number;
  readonly highBeams: number;
  readonly lowBeams: number;
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
  private targetCount = 0;
  private generation = 0;
  private serial = 0;
  private spawnCooldown = 0;
  private pending: PendingSpawn | null = null;
  private playerS = 0;
  private readonly position = { x: 0, y: 0, z: 0 };
  private readonly groundProbeOrigin = { x: 0, y: 0, z: 0 };
  private readonly groundProbeDirection = { x: 0, y: -1, z: 0 };
  private settingsRef: Settings | null = null;
  private clockSync = 0;
  private daylightFactor = 1;
  private impactCount = 0;
  private passCount = 0;

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
    return this.targetCount > 0;
  }

  get status(): TrafficStatus {
    let sameDirection = 0;
    let nearestRoadDistance = Infinity;
    let movingSameDirection = 0;
    let movingOncoming = 0;
    let highBeams = 0;
    let lowBeams = 0;
    const modelIds: string[] = [];
    let sleeper = 0;
    let frantic = 0;
    let cautious = 0;
    let passing = 0;
    for (const car of this.carList) {
      if (car.direction === 1) {
        sameDirection++;
        if (car.forwardS > car.spawnS + 1) movingSameDirection++;
      } else if (car.forwardS < car.spawnS - 1) {
        movingOncoming++;
      }
      modelIds.push(car.modelId);
      if (car.autopilot.mode === 'frantic') frantic++;
      else sleeper++;
      if (car.style === 'cautious') cautious++;
      if (car.autopilot.activity === 'pass') passing++;
      if (car.vehicle.headlights === 'high') highBeams++;
      else if (car.vehicle.headlights === 'low') lowBeams++;
      nearestRoadDistance = Math.min(
        nearestRoadDistance,
        Math.abs(car.forwardS - this.playerS),
      );
    }
    return {
      enabled: this.targetCount > 0,
      count: this.carList.length,
      sameDirection,
      oncoming: this.carList.length - sameDirection,
      pending: this.pending !== null,
      sleeper,
      frantic,
      cautious,
      passing,
      passes: this.passCount,
      impacts: this.impactCount,
      modelIds,
      nearestRoadDistance,
      movingSameDirection,
      movingOncoming,
      highBeams,
      lowBeams,
    };
  }

  setTargetCount(count: number): void {
    const next = Math.min(MAX_TRAFFIC, Math.max(0, Math.round(count / 2) * 2));
    for (const car of this.carList) car.autopilot.setPassingEnabled(next <= 12);
    if (this.targetCount === next) return;
    this.targetCount = next;
    this.generation++;
    this.pending = null;
    this.spawnCooldown = next > 0 ? 0 : SPAWN_INTERVAL_S;
    if (next === 0) {
      this.clear();
      return;
    }
    while (this.carList.length > next) {
      let farthest = 0;
      for (let i = 1; i < this.carList.length; i++) {
        if (
          Math.abs(this.carList[i]!.forwardS - this.playerS) >
          Math.abs(this.carList[farthest]!.forwardS - this.playerS)
        ) {
          farthest = i;
        }
      }
      this.removeAt(farthest);
    }
  }

  setDaylightFactor(daylightFactor: number): void {
    this.daylightFactor = Math.max(0, Math.min(1, daylightFactor));
  }

  /**
   * Distance along this driver's road direction to the nearest opposing car.
   * Negative distances are already behind and therefore cannot keep the beam dipped.
   */
  nearestOncomingDistance(
    forwardS: number,
    direction: TrafficDirection,
    excludeId?: string,
  ): number {
    let nearest = Infinity;
    if (direction === -1 && this.sourceWorld.state.player.drivingCarId !== null) {
      const playerAhead = (this.playerS - forwardS) * direction;
      if (playerAhead > 0) nearest = playerAhead;
    }
    for (const car of this.carList) {
      if (car.id === excludeId || car.direction === direction) continue;
      const ahead = (car.forwardS - forwardS) * direction;
      if (ahead > 0 && ahead < nearest) nearest = ahead;
    }
    return nearest;
  }

  /**
   * Resolves an opposing-queue stalemate centrally instead of letting every driver
   * guess. Only the forward-direction head receives permission; cars behind either
   * head remain ordinary followers. Separate clusters may resolve concurrently.
   */
  private assignDeadlockPermissions(): void {
    for (const car of this.carList) car.autopilot.setDeadlockPermission(false);
    for (const candidate of this.carList) {
      if (
        candidate.direction !== 1 ||
        candidate.settleFor > 0 ||
        (candidate.autopilot.obstacleGap === Infinity &&
          candidate.autopilot.activity !== 'offroad')
      ) {
        continue;
      }
      const velocity = candidate.vehicle.chassis.linvel();
      if (Math.hypot(velocity.x, velocity.z) >= DEADLOCK_STOP_SPEED_MPS) continue;

      let opposing: TrafficCar | null = null;
      let opposingGap = Infinity;
      for (const other of this.carList) {
        if (other.direction !== -1 || other.settleFor > 0) continue;
        const ahead = other.forwardS - candidate.forwardS;
        if (ahead > 0 && ahead < opposingGap) {
          opposing = other;
          opposingGap = ahead;
        }
      }
      if (!opposing || opposingGap > DEADLOCK_ROAD_GAP_M) continue;
      const opposingVelocity = opposing.vehicle.chassis.linvel();
      if (
        Math.hypot(opposingVelocity.x, opposingVelocity.z) >=
        DEADLOCK_STOP_SPEED_MPS
      ) {
        continue;
      }

      let headsMeet = true;
      for (const other of this.carList) {
        if (other === candidate || other === opposing) continue;
        if (other.direction === 1) {
          const ahead = other.forwardS - candidate.forwardS;
          if (ahead > 0 && ahead < opposingGap) {
            headsMeet = false;
            break;
          }
        } else {
          const ahead = opposing.forwardS - other.forwardS;
          if (ahead > 0 && ahead < opposingGap) {
            headsMeet = false;
            break;
          }
        }
      }
      if (headsMeet) candidate.autopilot.setDeadlockPermission(true);
    }
  }

  /** Visits every live temporary vehicle without exposing traffic ownership. */
  forEachVehicle(visitor: (id: string, vehicle: Vehicle) => void): void {
    for (const car of this.carList) visitor(car.id, car.vehicle);
  }

  /** Adds temporary vehicles to the shared fixed light pool without exposing ownership. */
  collectLitVehicles(output: Vehicle[], environmentFactor: number): void {
    for (const car of this.carList) {
      car.vehicle.setHeadlightEnvironmentFactor(environmentFactor);
      if (car.vehicle.hasLitLamps) output.push(car.vehicle);
    }
  }


  /** Writes every traffic controller before the shared physics step. */
  fixedUpdate(dt: number, playerS: number, originX: number, originZ: number): void {
    this.playerS = playerS;
    this.syncSettings();
    if (this.targetCount === 0 && this.carList.length === 0) return;
    while (this.carList.length > this.targetCount) this.removeAt(this.carList.length - 1);
    this.clockSync -= dt;
    if (this.clockSync <= 0) {
      this.trafficWorld.apply({
        t: 'time_of_day',
        timeOfDay: this.sourceWorld.state.timeOfDay,
      });
      this.clockSync = CLOCK_SYNC_S;
    }

    // Deadlock arbitration needs current ordering. The half-second lifetime sample is
    // sufficient for despawning, but stale positions can grant a reversing manoeuvre
    // after two opposing cars have already crossed.
    for (const car of this.carList) {
      car.vehicle.absoluteTranslation(this.position);
      const projection = this.road.project(this.position.x, this.position.z, car.forwardS);
      car.forwardS = projection.s;
      car.roadLateral = projection.lateral;
    }

    this.assignDeadlockPermissions();
    for (let i = this.carList.length - 1; i >= 0; i--) {
      const car = this.carList[i]!;
      car.autopilot.setLightingConditions(
        this.daylightFactor,
        this.nearestOncomingDistance(car.forwardS, car.direction, car.id),
      );
      car.lifetimeTimer -= dt;
      if (car.lifetimeTimer <= 0) {
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
        const passing = car.autopilot.activity === 'pass';
        if (passing && !car.wasPassing) this.passCount++;
        car.wasPassing = passing;
        car.vehicle.fixedUpdate(dt, car.input);
      }
    }

    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0 && this.pending === null && this.carList.length < this.targetCount) {
      this.queueSpawn();
      this.spawnCooldown =
        this.targetCount > 12 ? DENSE_SPAWN_INTERVAL_S : SPAWN_INTERVAL_S;
    }
  }

  postStep(): void {
    for (const car of this.carList) {
      car.vehicle.postStep();
      const impact = car.vehicle.lastImpact;
      if (impact && impact.severityMps > 1.8) this.impactCount++;
    }
  }

  syncVisuals(alpha: number): void {
    for (const car of this.carList) car.vehicle.syncVisuals(alpha);
  }

  dispose(): void {
    this.targetCount = 0;
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
    this.setTargetCount(source.trafficCount);
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
    const driver = this.drawDriver(direction);
    const request: PendingSpawn = {
      generation: this.generation,
      direction,
      forwardS,
      modelId: model.id,
      id: `${TRAFFIC_ID_PREFIX}${(this.serial++).toString(36)}`,
      style: driver.style,
      mode: driver.mode,
      speedCap: driver.speedCap,
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
      this.targetCount === 0 ||
      this.carList.length >= this.targetCount ||
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
    if (!this.hasSpawnGround(x, roadPoint.y, z)) return;

    const heading = roadPoint.heading + (request.direction === -1 ? Math.PI : 0);
    const y = carSpawnYAboveGround(
      carModelMeasure(request.modelId),
      roadPoint.y,
      TRAFFIC_SPAWN_DROP_M,
    );
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
    autopilot.setPassingEnabled(this.targetCount <= 12);
    autopilot.setMode(request.mode);
    autopilot.setSpeedCap(request.speedCap);
    autopilot.setTrafficRecoveryPolicy(true);
    autopilot.setEngaged(true);
    this.carList.push({
      id: request.id,
      direction: request.direction,
      vehicle,
      modelId: request.modelId,
      style: request.style,
      roadLateral: forwardLateral,
      speedCap: request.speedCap,
      spawnS: request.forwardS,
      autopilot,
      input: emptyInput(),
      forwardS: request.forwardS,
      settleFor: DROP_SETTLE_S,
      lifetimeTimer: LIFETIME_SAMPLE_S,
      wasPassing: false,
    });
  }

  /**
   * Far road samples can exist before their streamed collision chunks. Creating a
   * dynamic car there lets gravity drop it through empty space before the player can
   * see why. Require fixed support at the sampled road height; a later spawn attempt
   * will succeed once that chunk has entered the physical window.
   */
  private hasSpawnGround(x: number, y: number, z: number): boolean {
    this.groundProbeOrigin.x = x - this.origin.x;
    this.groundProbeOrigin.y = y + SPAWN_GROUND_PROBE_UP_M;
    this.groundProbeOrigin.z = z - this.origin.z;
    const hit = this.physics.raycast(
      this.groundProbeOrigin,
      this.groundProbeDirection,
      SPAWN_GROUND_PROBE_DEPTH_M,
    );
    if (!hit) return false;
    return this.physics.world.getCollider(hit.colliderHandle)?.parent()?.isFixed() ?? false;
  }

  private nextDirection(): TrafficDirection | null {
    let same = 0;
    let oncoming = 0;
    for (const car of this.carList) {
      if (car.direction === 1) same++;
      else oncoming++;
    }
    const maxPerDirection = this.targetCount / 2;
    if (same >= maxPerDirection && oncoming >= maxPerDirection) return null;
    if (same === 0 || oncoming >= maxPerDirection) return 1;
    if (oncoming === 0 || same >= maxPerDirection) return -1;
    return this.random() < 0.5 ? 1 : -1;
  }

  private findSpawnS(direction: TrafficDirection): number | null {
    for (let attempt = 0; attempt < 12; attempt++) {
      const distance = SPAWN_MIN_M + this.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
      const s = this.playerS + distance;
      if (s < END_MARGIN_M || s > this.road.length - END_MARGIN_M) continue;
      if (this.spawnSiteClear(s, direction)) return s;
    }
    return null;
  }

  private spawnSiteClear(s: number, direction: TrafficDirection): boolean {
    if (!this.roadGapClear(s, direction)) return false;
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

  private roadGapClear(s: number, direction: TrafficDirection): boolean {
    const sameDirectionGap =
      this.targetCount > 12 ? DENSE_SPAWN_ROAD_GAP_M : SPAWN_ROAD_GAP_M;
    for (const car of this.carList) {
      const gap = Math.abs(car.forwardS - s);
      if (car.direction === direction) {
        const spawnIsAhead = (s - car.forwardS) * direction > 0;
        const requiredGap = spawnIsAhead ? SPAWN_ROAD_GAP_M : sameDirectionGap;
        if (gap < requiredGap) return false;
      }
      if (
        car.direction !== direction &&
        (car.autopilot.activity === 'pass' ||
          car.roadLateral * car.direction > -TRAFFIC_HALF_WIDTH_M) &&
        gap < PASSING_SPAWN_EXCLUSION_M
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Draws behaviour independently of body choice. The first six in each direction
   * deliberately include one cautious and one hurried driver; otherwise a random
   * twelve-car sample can contain no vehicle capable of creating an overtake at all.
   */
  private drawDriver(direction: TrafficDirection): {
    style: TrafficDriverStyle;
    mode: 'sleeper' | 'frantic';
    speedCap: number;
  } {
    const directionCount = this.carList.reduce(
      (count, car) => count + Number(car.direction === direction),
      0,
    );
    const styleRoll = this.random();
    if (directionCount === 0 || styleRoll < 0.2) {
      return {
        style: 'cautious',
        mode: 'sleeper',
        speedCap: (42 + this.random() * 10) / 3.6,
      };
    }
    if (directionCount === 2 || styleRoll >= 0.85) {
      return {
        style: 'hurried',
        mode: 'frantic',
        speedCap: (85 + this.random() * 20) / 3.6,
      };
    }
    return {
      style: 'normal',
      mode: 'sleeper',
      speedCap: (58 + this.random() * 12) / 3.6,
    };
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
