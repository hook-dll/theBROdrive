import type * as THREE from 'three';
import { emptyInput, type InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import { mulberry32 } from '../core/rng';
import { createServiceableCarState } from '../game/spawn';
import { GameWorld, newWorldState } from '../game/state';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { Autopilot, AUTOPILOT_MODES, type AutopilotMode } from '../vehicle/autopilot';
import type { Settings } from '../game/settings';
import { CAR_MODELS } from '../vehicle/carmodels';
import { Vehicle } from '../vehicle/vehicle';
import { ReversedHazardIndex, type HazardField } from './hazards';
import type { WorldOrigin } from './origin';
import type { DriveRoad } from './road';
import { ReversedRoad } from './reversedroad';
import { PHYSICS_REACH_M } from './chunks';

/**
 * Thirty physical cars is the upper setting: the live stream deliberately fluctuates
 * below this cap so a long drive does not become a perfectly repeated convoy.
 */
const MAX_TRAFFIC = 30;
const SPAWN_MIN_M = 140;
/**
 * THE BAND ENDS WHERE THE GROUND DOES.
 *
 * A spawn needs a fixed collider under it (`spawnSiteClear` -> `hasSpawnGround`),
 * and the streamer only builds colliders within `PHYSICS_REACH_M`. The band used to
 * run to 700 m, so two sites in three passed selection, held the single `pending`
 * slot through a model load, and were then thrown away on arrival — measured at 207
 * of 300 attempts, a refill rate of 0.38 cars/s against the 2/s the cooldown allows.
 * The stream sagged to half its target after every density change for no other
 * reason. Sites are now drawn only where a car can actually stand.
 */
const SPAWN_MAX_M = PHYSICS_REACH_M;
/**
 * TRAFFIC ALSO COMES UP FROM BEHIND.
 *
 * Spawning only ahead makes the mirror a graveyard: the player overtakes nearly
 * everything (ambient caps are 42-105 km/h), and every overtaken car then holds a
 * slot out of sight until the rear despawn. A driver whose cap genuinely beats the
 * player's current speed is instead put behind, closes, and arrives in view — the
 * only way a car can populate the road AHEAD of the spawn band.
 */
const REAR_SPAWN_MIN_M = 250;
const REAR_SPAWN_MAX_M = 360;
/** Speed advantage over the player that makes a rear spawn worth its slot. */
const REAR_SPAWN_CLOSING_MPS = 2.5;
/**
 * Road the player may have covered between a spawn being chosen and its model
 * finishing loading. See `finishSpawn`.
 */
const SPAWN_ARRIVAL_SLACK_M = 60;
const DESPAWN_M = 850;
/**
 * Behind, the budget is spent much sooner. A car dropped by the player is invisible
 * from the moment it leaves the mirror, and past `PHYSICS_REACH_M` it has no road
 * under it at all — it free-falls while holding one of the thirty slots. Recycling
 * it into a spawn the player can see is worth the shorter tail.
 */
const DESPAWN_BEHIND_M = PHYSICS_REACH_M;
/**
 * A density trim may only take a car this far BEHIND the player, where its removal
 * cannot be watched. `DESPAWN_M` still applies in both directions.
 */
const OFFSCREEN_TRIM_M = 90;
/** Same-lane separation for the normal stream; dense 30-car mode packs to 32 m. */
const SPAWN_ROAD_GAP_M = 70;
const DENSE_SPAWN_ROAD_GAP_M = 32;
const SPAWN_WORLD_GAP_M = 30;
const SPAWN_HAZARD_GAP_M = 18;
/** Never materialize an opposing car inside a pass that was clear when committed. */
const PASSING_SPAWN_EXCLUSION_M = 300;
const TRAFFIC_HALF_WIDTH_M = 1.1;
/**
 * Lateral, measured in a car's own direction sense, past which it is genuinely out
 * in the opposing lane rather than merely wandering inside its own.
 *
 * Lane centre is `ROAD_HALF_WIDTH / 2` = 1.45 m, so testing the body edge against
 * the crown (`> -TRAFFIC_HALF_WIDTH_M`) left 0.35 m of slack: ordinary lane-keeping
 * error on a bend read as an overtake in progress and blacked out 300 m of road for
 * spawning. Measured at 419 of 1540 rejected sites on one seed and none on another,
 * i.e. a silent, seed-dependent density loss. This is the autopilot's own
 * wrong-side test — half a body past the crown, and committed to it.
 */
const OPPOSING_LANE_INTRUSION_M = TRAFFIC_HALF_WIDTH_M * 0.5;
const SPAWN_INTERVAL_S = 1;
const DENSE_SPAWN_INTERVAL_S = 0.5;
const DENSITY_CHANGE_MIN_S = 36;
const DENSITY_CHANGE_MAX_S = 72;
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
/** Bumper-to-bumper enough that a car behind is in the way of a reverse. */
const YIELD_CHAIN_GAP_M = 14;
/** While one car is out in the opposing lane, oncoming traffic this close waits. */
const OPPOSING_PASS_EXCLUSION_M = 260;
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
  readonly headwayS: number;
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
  readonly headwayS: number;
  readonly mode: AutopilotMode;
  readonly speedCap: number;
  /** Drawn from the rear band, so arrival is revalidated against the rear limits. */
  readonly rear: boolean;
}

export interface TrafficStatus {
  readonly enabled: boolean;
  /**
   * Live cars in front of the player — the part of the quota he can actually see.
   * The stream is spawned ahead and collected behind, so this is the number the
   * traffic setting is judged by, not `count`.
   */
  readonly ahead: number;
  readonly count: number;
  readonly sameDirection: number;
  readonly oncoming: number;
  readonly pending: boolean;
  readonly sleeper: number;
  readonly hurried: number;
  readonly frantic: number;
  readonly cautious: number;
  readonly passing: number;
  readonly passes: number;
  readonly impacts: number;
  readonly modelIds: readonly string[];
  readonly nearestRoadDistance: number;
  readonly movingSameDirection: number;
  readonly movingOncoming: number;
  /** Retained in status telemetry; autonomous traffic must leave this at zero. */
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
  /** User setting: the maximum number of live ambient cars. */
  private targetCount = 0;
  /** Current natural-looking density, always at or below targetCount. */
  private desiredCount = 0;
  private densityTimer = 0;
  private generation = 0;
  private serial = 0;
  private spawnCooldown = 0;
  private pending: PendingSpawn | null = null;
  private playerS = 0;
  /**
   * Smoothed player pace along the road. A rear spawn is only worth a slot if its
   * driver can actually close on this; see `queueSpawn`.
   */
  private playerSpeed = 0;
  private readonly spawnPoint = { x: 0, y: 0, z: 0 };
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
    let hurried = 0;
    let frantic = 0;
    let cautious = 0;
    let passing = 0;
    let ahead = 0;
    for (const car of this.carList) {
      if (car.direction === 1) {
        sameDirection++;
        if (car.forwardS > car.spawnS + 1) movingSameDirection++;
      } else if (car.forwardS < car.spawnS - 1) {
        movingOncoming++;
      }
      modelIds.push(car.modelId);
      if (car.autopilot.mode === 'frantic') frantic++;
      else if (car.autopilot.mode === 'hurried') hurried++;
      else sleeper++;
      if (car.style === 'cautious') cautious++;
      if (car.autopilot.activity === 'pass') passing++;
      if (car.vehicle.headlights === 'high') highBeams++;
      else if (car.vehicle.headlights === 'low') lowBeams++;
      if (car.forwardS > this.playerS) ahead++;
      nearestRoadDistance = Math.min(
        nearestRoadDistance,
        Math.abs(car.forwardS - this.playerS),
      );
    }
    return {
      enabled: this.targetCount > 0,
      count: this.carList.length,
      ahead,
      sameDirection,
      oncoming: this.carList.length - sameDirection,
      pending: this.pending !== null,
      sleeper,
      hurried,
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

  /** Sets the upper bound; the live stream chooses a changing count below it. */
  setTargetCount(count: number): void {
    const next = Math.min(MAX_TRAFFIC, Math.max(0, Math.round(count / 2) * 2));
    // 120 is above MAX_TRAFFIC on purpose: overtaking is on at every density while
    // the dense stream is being judged in play. Back to 12 restores the old gate.
    for (const car of this.carList) car.autopilot.setPassingEnabled(next <= 120);
    if (this.targetCount === next) return;
    this.targetCount = next;
    this.desiredCount = next > 0 ? this.drawDesiredCount(next) : 0;
    this.densityTimer = next > 0 ? this.drawDensityInterval() : 0;
    this.generation++;
    this.pending = null;
    this.spawnCooldown = next > 0 ? 0 : SPAWN_INTERVAL_S;
    if (next === 0) {
      this.clear();
      return;
    }
    this.trimTo(this.desiredCount, true);
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

  /**
   * WHEN THE HEAD OF A QUEUE HAS TO BACK UP, THE QUEUE BACKS UP WITH IT.
   *
   * A car wedged against a rock reverses out of it — and cannot, because the next
   * car is against its bumper and the one behind that against ITS bumper. Seen in
   * play: a line of traffic stopped at a rock, the head shuffling into the car
   * behind, nothing moving, the player at the back of it waiting for good.
   *
   * So the request travels down the line. Each car within `YIELD_CHAIN_GAP_M` of
   * one that needs room is asked to give ground, and its own follower is asked in
   * turn — the chain is walked front to back until it stops. Each driver reverses
   * only while its own rear is clear, so the queue unwinds from the end.
   */
  private assignReverseRoom(): void {
    for (const car of this.carList) car.autopilot.setYieldReverse(false);
    for (const direction of [1, -1] as const) {
      const queue = this.carList
        .filter((car) => car.direction === direction && car.settleFor <= 0)
        // Front of the queue first, in this direction's own sense of forward.
        .sort((a, b) => (b.forwardS - a.forwardS) * direction);
      for (let i = 0; i < queue.length; i++) {
        const ahead = queue[i]!;
        if (!ahead.autopilot.needsReverseRoom) continue;
        const behind = queue[i + 1];
        if (!behind) continue;
        const gap = Math.abs(ahead.forwardS - behind.forwardS);
        if (gap > YIELD_CHAIN_GAP_M) continue;
        behind.autopilot.setYieldReverse(true);
      }
    }
  }

  /**
   * ONE CAR AT A TIME IN THE OPPOSING LANE.
   *
   * Each driver checks the opposing lane for itself and finds it clear, because the
   * car coming the other way is in its OWN lane, minding its own business — right
   * up until it makes the same decision. Two individually correct overtakes then
   * meet head-on, and nothing inside a single car can see that coming. So the
   * coordinator owns it: while a car is out in the wrong lane, nothing coming the
   * other way within `OPPOSING_PASS_EXCLUSION_M` may start a pass of its own.
   */
  private assignPassPermissions(): void {
    for (const car of this.carList) {
      const blocked = this.carList.some(
        (other) =>
          other !== car &&
          other.direction !== car.direction &&
          other.autopilot.activity === 'pass' &&
          Math.abs(other.forwardS - car.forwardS) < OPPOSING_PASS_EXCLUSION_M,
      );
      car.autopilot.setPassingEnabled(!blocked && this.targetCount <= 120);
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
    // A jump this large is a teleport (load, fast travel, the despawn-range test),
    // not motion, and must not be read as a speed no traffic could ever match.
    const advance = playerS - this.playerS;
    this.playerSpeed =
      dt > 0 && Math.abs(advance) < 50
        ? this.playerSpeed * 0.9 + (advance / dt) * 0.1
        : 0;
    this.playerS = playerS;
    this.syncSettings();
    if (this.targetCount === 0 && this.carList.length === 0) return;
    this.trimTo(this.targetCount, true);
    this.clockSync -= dt;
    if (this.clockSync <= 0) {
      this.trafficWorld.apply({
        t: 'time_of_day',
        timeOfDay: this.sourceWorld.state.timeOfDay,
      });
      this.clockSync = CLOCK_SYNC_S;
    }
    this.densityTimer -= dt;
    if (this.densityTimer <= 0) {
      this.desiredCount = this.drawDesiredCount(this.targetCount);
      this.densityTimer = this.drawDensityInterval();
    }
    this.trimTo(this.desiredCount, false);

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
    this.assignReverseRoom();
    this.assignPassPermissions();
    for (let i = this.carList.length - 1; i >= 0; i--) {
      const car = this.carList[i]!;
      car.autopilot.setLightingConditions(
        this.daylightFactor,
        this.nearestOncomingDistance(car.forwardS, car.direction, car.id),
      );
      car.lifetimeTimer -= dt;
      if (car.lifetimeTimer <= 0) {
        car.lifetimeTimer = LIFETIME_SAMPLE_S;
        const offset = car.forwardS - playerS;
        if (offset > DESPAWN_M || -offset > DESPAWN_BEHIND_M) {
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
    if (
      this.spawnCooldown <= 0 &&
      this.pending === null &&
      this.carList.length < this.desiredCount
    ) {
      this.queueSpawn();
      this.spawnCooldown =
        this.desiredCount > 12 ? DENSE_SPAWN_INTERVAL_S : SPAWN_INTERVAL_S;
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
    // The driver is drawn BEFORE the site, because which road is worth searching
    // depends on the cap it was given. A car slower than the player that starts
    // behind him is a car he will never see: it only falls further back until the
    // rear despawn collects it. Oncoming traffic behind him is worse still — it
    // drives away from the moment it exists.
    const driver = this.drawDriver(direction);
    const fromBehind =
      direction === 1 && driver.speedCap > this.playerSpeed + REAR_SPAWN_CLOSING_MPS;
    const forwardS = this.findSpawnS(direction, fromBehind);
    if (forwardS === null) return;
    const model = CAR_MODELS[Math.floor(this.random() * CAR_MODELS.length)]!;
    const request: PendingSpawn = {
      generation: this.generation,
      direction,
      forwardS,
      modelId: model.id,
      id: `${TRAFFIC_ID_PREFIX}${(this.serial++).toString(36)}`,
      style: driver.style,
      headwayS: driver.headwayS,
      mode: driver.mode,
      speedCap: driver.speedCap,
      rear: forwardS < this.playerS,
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
    // THE PLAYER MOVES WHILE THE MODEL LOADS.
    //
    // The site was picked at least `SPAWN_MIN_M` (140 m) ahead, and this runs when
    // the car's model finishes loading — several ticks later, and a whole load if
    // that model has never been used this session. At 90 km/h the player covers 25
    // metres a second, so the band check failed by one or two metres and the spawn
    // was thrown away. Cached models resolve inside a tick and never saw it, which
    // is why it only showed up after CHANGING the traffic setting: the new draws
    // pull models that are not in the cache yet, every spawn was discarded on
    // arrival, and a road that had twenty cars quietly emptied to none.
    //
    // A spawn that arrives slightly closer than intended is still a spawn behind a
    // crest or a bend, so the band is allowed to have shrunk by the road a loading
    // screen can cover. Closer than THAT is a car appearing in view, and is still
    // refused. A REAR spawn drifts the other way — the player is driving away from
    // it — so its far edge is the one that has to hold, or the car materialises
    // already outside `DESPAWN_BEHIND_M` and is collected on its first sample.
    const offset = request.forwardS - this.playerS;
    const arrivalOk = request.rear
      ? -offset >= REAR_SPAWN_MIN_M - SPAWN_ARRIVAL_SLACK_M && -offset <= REAR_SPAWN_MAX_M
      : offset >= SPAWN_MIN_M - SPAWN_ARRIVAL_SLACK_M && offset <= SPAWN_MAX_M;
    if (
      this.desiredCount === 0 ||
      this.carList.length >= this.desiredCount ||
      request.generation !== this.generation ||
      this.pending !== request ||
      !arrivalOk
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
    autopilot.setPassingEnabled(this.targetCount <= 120);
    autopilot.setFollowingHeadway(request.headwayS);
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
      headwayS: request.headwayS,
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
    const maxPerDirection = this.desiredCount / 2;
    if (same >= maxPerDirection && oncoming >= maxPerDirection) return null;
    if (same === 0 || oncoming >= maxPerDirection) return 1;
    if (oncoming === 0 || same >= maxPerDirection) return -1;
    return this.random() < 0.5 ? 1 : -1;
  }

  /**
   * `fromBehind` searches the rear band first. It is a preference, not a mode: a
   * rear site that is blocked must not cost the whole spawn, so the later attempts
   * fall back to the road ahead.
   */
  private findSpawnS(direction: TrafficDirection, fromBehind: boolean): number | null {
    for (let attempt = 0; attempt < 12; attempt++) {
      const behind = fromBehind && attempt < 6;
      const distance = behind
        ? -(REAR_SPAWN_MIN_M + this.random() * (REAR_SPAWN_MAX_M - REAR_SPAWN_MIN_M))
        : SPAWN_MIN_M + this.random() * (SPAWN_MAX_M - SPAWN_MIN_M);
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
    if (!clear) return false;
    // Ground is part of whether a site EXISTS, not a last-moment veto. Left to
    // `finishSpawn`, an unsupported site still consumed the one pending slot and a
    // model load before being discarded; here the search simply moves on and the
    // same tick can offer a supported one.
    const point = this.road.offsetPoint(s, lane, this.spawnPoint);
    return this.hasSpawnGround(point.x, point.y, point.z);
  }

  private roadGapClear(s: number, direction: TrafficDirection): boolean {
    const sameDirectionGap =
      this.desiredCount > 12 ? DENSE_SPAWN_ROAD_GAP_M : SPAWN_ROAD_GAP_M;
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
          car.roadLateral * car.direction > OPPOSING_LANE_INTRUSION_M) &&
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
   *
   * WHY THESE SPEEDS.
   *
   * A cap is the pace on CLEAN asphalt, and this road has almost none: measured on
   * seed 1337 it is 50% cracked asphalt, 46% graded gravel and 4% clean, and the
   * autopilot's surface factor scales the cap by the surface it is on. The old caps
   * — 42-52, 58-70, 85-105 — therefore put ordinary traffic on a 26-31 km/h target
   * over nearly half the drive, and the pedal law held it under 25. That is the
   * Zhiguli the player watched creep up a hill.
   *
   * The spread matters as much as the middle: an overtake is only an overtake if the
   * differential survives being multiplied by the surface. An ordinary car and a
   * hurried one used to differ by 15-47 km/h on clean asphalt but only by 12-21 on
   * gravel — from a 26-31 km/h base, so a pass was two cars crawling side by side,
   * which is what read as easing round rather than going past. They now sit at
   * 46 and 61 km/h on gravel and 74 and 97 on cracked asphalt, so the same
   * differential is spent from a pace where the manoeuvre is over in seconds.
   *
   * A cap above its mode's own cruise does nothing — the planner takes the lower of
   * the two — so the top of each band is deliberately just past the ceiling it draws
   * against (sleeper 80, hurried 105) rather than far past it.
   */
  private drawDriver(direction: TrafficDirection): {
    style: TrafficDriverStyle;
    headwayS: number;
    mode: AutopilotMode;
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
        headwayS: 2.2 + this.random() * 0.8,
        mode: 'sleeper',
        speedCap: (58 + this.random() * 12) / 3.6,
      };
    }
    // One car in five is in a hurry, and it drives the HURRIED mode, not frantic:
    // ambient traffic that overtakes into windows it would take itself. Frantic —
    // the smaller gap, the shorter patience — belongs to the player's own autopilot,
    // where somebody is watching the road it is taking.
    if (directionCount === 2 || styleRoll >= 0.8) {
      return {
        style: 'hurried',
        headwayS: 1.0 + this.random() * 0.6,
        mode: 'hurried',
        speedCap: (95 + this.random() * 20) / 3.6,
      };
    }
    return {
      style: 'normal',
      headwayS: 1.5 + this.random() * 0.9,
      mode: 'sleeper',
      speedCap: (72 + this.random() * 12) / 3.6,
    };
  }

  private drawDesiredCount(cap: number): number {
    if (cap <= 0) return 0;
    if (cap === 1) return 1;
    const floor = Math.max(1, Math.ceil(cap * 0.65));
    return floor + Math.floor(this.random() * (cap - floor + 1));
  }

  private drawDensityInterval(): number {
    return (
      DENSITY_CHANGE_MIN_S +
      this.random() * (DENSITY_CHANGE_MAX_S - DENSITY_CHANGE_MIN_S)
    );
  }

  /**
   * Thins the live stream down to `count`.
   *
   * A car is only ever taken out where its disappearance cannot be watched: behind
   * the player, farthest first. The density resampler used to drop the LAST entry
   * of an append-ordered list, i.e. usually the most recently spawned car — and a
   * fresh spawn sits 140–700 m AHEAD. So an oncoming car would materialise, drive
   * at the player and blink out in the middle of the windscreen. Nothing can hide
   * that: a traffic car is a full Vehicle and removal is instant, with no fade.
   *
   * `visible` is the escape hatch for the hard cap, which the player has just set
   * and which MUST be honoured: with nothing behind, it gives up the farthest car
   * in either direction. The soft density target instead stays unmet for a few
   * seconds until something falls behind, which nobody can see.
   */
  private trimTo(count: number, visible: boolean): void {
    while (this.carList.length > count) {
      const index = this.pickTrimIndex(visible);
      if (index < 0) return;
      this.removeAt(index);
    }
  }

  /**
   * Farthest car behind the player, or — only for a hard cap — the farthest car in
   * either direction. Traffic always spawns ahead and the player always drives with
   * increasing `s`, so "behind" is exactly `playerS - forwardS`.
   */
  private pickTrimIndex(visible: boolean): number {
    let best = -1;
    let bestBehind = OFFSCREEN_TRIM_M;
    for (let i = 0; i < this.carList.length; i++) {
      const behind = this.playerS - this.carList[i]!.forwardS;
      if (behind > bestBehind) {
        bestBehind = behind;
        best = i;
      }
    }
    if (best >= 0 || !visible) return best;
    let farthest = 0;
    for (let i = 1; i < this.carList.length; i++) {
      if (
        Math.abs(this.carList[i]!.forwardS - this.playerS) >
        Math.abs(this.carList[farthest]!.forwardS - this.playerS)
      ) {
        farthest = i;
      }
    }
    return farthest;
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
