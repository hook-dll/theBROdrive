import type * as THREE from 'three';
import { emptyInput, type InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import { SurfaceType } from '../core/surfaces';
import { mulberry32 } from '../core/rng';
import { createServiceableCarState } from '../game/spawn';
import { GameWorld, newWorldState } from '../game/state';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { Autopilot, AUTOPILOT_MODES, type AutopilotMode } from '../vehicle/autopilot';
import type { TrafficField, TrafficNeighbour } from '../vehicle/trafficfield';
import type { Settings } from '../game/settings';
import { CAR_MODELS } from '../vehicle/carmodels';
import { Vehicle } from '../vehicle/vehicle';
import { ReversedHazardIndex, type HazardField } from './hazards';
import type { WorldOrigin } from './origin';
import { laneHalfWidthFor, widenessAt } from './roadprofile';
import type { DriveRoad } from './road';
import { ReversedRoad } from './reversedroad';
import { TurnaroundRoad, TURNAROUND_ENTRY_S } from './turnaround';
import { PHYSICS_REACH_M } from './chunks';
import type { RoadConditionBuffer } from './gradient';

/**
 * THE STREAM'S SIZE COMES FROM THE CARRIAGEWAY, not from a setting.
 *
 * A two-lane road replenishes up to `NARROW_TRAFFIC` cars; a four-lane road up to
 * `WIDE_TRAFFIC`. In between the ceiling follows the widening. Existing visible
 * cars drain naturally rather than disappearing at a profile step. The density
 * samples the entire spawn band, not one point (see `refreshRoadCap`).
 *
 * It used to be a player setting with a menu slider, defaulting to OFF, that only ever
 * RAISED: a narrow road ran at the setting and a widened one ran up to a fixed ceiling of
 * thirty. That asked the player a question about a number they had no way to judge — the
 * honest answer is a property of the road, and the road already knows it.
 */
const NARROW_TRAFFIC = 12;
const WIDE_TRAFFIC = 24;
/**
 * The smallest target fraction of the cap, so a long drive keeps changing.
 * The target is a single draw in `[DENSITY_FLOOR * cap, cap]`, re-rolled
 * every 36-72 s, and the retained FRACTION is held between re-rolls — which is what lets
 * a widening fill smoothly instead of stepping at a profile boundary.
 *
 * A third, against the two thirds this started at and the fifth it was briefly set to.
 * The range is a rotation between "you own the road" and "you are in company", and both
 * ends have to be reachable to be worth having; a fifth was measured to reach the quiet
 * end too hard, leaving a narrow road with two or three cars and the player alone on it
 * for minutes at a time, which is what a fifth of twelve means in practice.
 */
const DENSITY_FLOOR = 0.35;
/**
 * Above this the stream packs tighter (see `SPAWN_ROAD_GAP_M`). It is the narrow road's
 * whole capacity, so the rule reads: a stream busier than a full two-lane road's worth
 * is a busy road and queues up. Only a widened carriageway can reach it.
 */
const DENSE_TRAFFIC_THRESHOLD = NARROW_TRAFFIC;
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
/** Extra room for numerical drift/acceleration beyond one step's measured travel. */
const PHYSICS_EDGE_SLACK_M = 1;
/**
 * A density trim may only take a car this far BEHIND the player, where its removal
 * cannot be watched. The physical support boundary still applies in both directions.
 */
const OFFSCREEN_TRIM_M = 90;
/** Seconds between spawn attempts on an ordinary road; the dense mode halves it. */
const SPAWN_INTERVAL_S = 1;
/** Same-lane separation for the normal stream; dense 30-car mode packs to 32 m. */
const SPAWN_ROAD_GAP_M = 70;
const DENSE_SPAWN_ROAD_GAP_M = 32;
/**
 * REAL TRAFFIC ARRIVES IN GROUPS, NOT AT AN EVEN SPACING.
 *
 * Every ordinary spawn draws an independent, uniformly-random arclength and is only
 * rejected if it lands inside another car's minimum gap (`roadGapClear`). Thinning a
 * uniform process by a hard minimum distance is a Matérn hard-core process, and its
 * signature is near-regular spacing: once the stream is near its cap, almost every
 * accepted gap sits close to the enforced floor. That reads as artificial exactly
 * where a two-lane road makes the player watch the oncoming lane closely, to plan a
 * pass — a four-lane road has two oncoming lanes to look at and the player is not
 * timing a crossing of them, so the same regularity there goes unnoticed.
 *
 * A real stream instead has a two-scale structure: cars that left the same junction,
 * merged together, or were held behind one slow driver arrive bunched, separated by
 * open road where nobody happens to be. So a spawn occasionally drags a second
 * (rarely third) car in behind it at a genuine close-following gap — the distance its
 * own headway would ask for at its own target speed, so the pair is already in trim
 * and does not visibly adjust — while solo spawns are untouched and still obey the
 * ordinary floor. The chance compounds per extra car (`P(pair) = 32%`,
 * `P(triplet+) = 10%`, `P(quad+) = 3%`), which matches groups being common,
 * three-plus rare, and never runaway.
 */
const PLATOON_CHANCE = 0.32;
/** Longest chain one roll may build, so a bad streak of rolls cannot eat a whole queue. */
const PLATOON_MAX_CHAIN = 4;
/** Floor under the headway-derived follow gap: body clearance, not a target distance. */
const PLATOON_MIN_GAP_M = 15;
const SPAWN_HAZARD_GAP_M = 18;
/** Never materialize an opposing car inside a pass that was clear when committed. */
const PASSING_SPAWN_EXCLUSION_M = 300;
const TRAFFIC_HALF_WIDTH_M = 1.1;
/**
 * The original exclusion stays on a one-lane road bit-for-bit. Once a second lane
 * exists it would reject valid side-by-side starts, so only body clearance remains —
 * and clearance has to mean a BODY, which 2.2 m of centre-to-centre distance is not.
 *
 * A car is 4.3 m long. A site 2.5 m behind another car's centre is inside that car,
 * and Rapier resolves being inside another car by throwing one of them: measured on
 * the real road, bodies logged 2-6 m BELOW the surface doing 150-200 km/h, each one a
 * spawn whose history is a single sample at v0. The radial figure is what the player
 * check gets, where a car must not appear alongside him at all; cars are checked
 * against each other in the road frame below, where along and across are separable
 * and a genuine side-by-side start is still allowed.
 */
const SPAWN_WORLD_GAP_M = 30;
const WIDE_SPAWN_WORLD_GAP_M = 6;
/**
 * Road-frame box a spawn keeps clear of every live body: one car length plus a margin
 * along the road, one car width plus a margin across it. Adjacent lane centres are
 * 2.9 m apart or more, so two cars may still be started abreast.
 */
const SPAWN_BODY_ALONG_M = 8;
const SPAWN_BODY_ACROSS_M = 2.6;
/**
 * Lateral, measured in a car's own direction sense, past which it has crossed the
 * crown into the other carriageway. Outer lanes remain on their own side whatever
 * the road width, so this is deliberately a crown test rather than an offset test.
 */
const CROWN_CROSSING_INTRUSION_M = TRAFFIC_HALF_WIDTH_M * 0.5;
const DENSE_SPAWN_INTERVAL_S = 0.5;
const DENSITY_CHANGE_MIN_S = 36;
const DENSITY_CHANGE_MAX_S = 72;
const DROP_SETTLE_S = 0.8;
/** Traffic starts at its fitted wheel-contact height; settle mode handles road grade. */
const TRAFFIC_SPAWN_DROP_M = 0;
const SPAWN_GROUND_PROBE_UP_M = 2;
const SPAWN_GROUND_PROBE_DEPTH_M = 4;
const LIFETIME_SAMPLE_S = 0.5;
/** Below this the car is standing, not crawling. */
const STUCK_SPEED_KMH = 2;
/** Seconds of standing still after which a car out of sight is recycled. */
const STUCK_RECYCLE_S = 18;
/** Never recycle a stopped car closer than this: the player would watch it vanish. */
const STUCK_RECYCLE_SIGHT_M = 70;
/** Even samples keep the local density response cheap and free of profile chatter. */
const DENSITY_PROFILE_SAMPLES = 5;
const CLOCK_SYNC_S = 1;
const END_MARGIN_M = 80;
const TRAFFIC_ID_PREFIX = 'traffic:';
const DEADLOCK_ROAD_GAP_M = 18;
/**
 * How far an opposing head may have drawn PAST this one and still count as part of
 * the same standoff.
 *
 * Two cars that met nose to nose almost never stop with a positive gap between
 * them: one creeps, they end up level, and a strictly-ahead test then found no
 * opposing head at all, granted nobody right of way, and left both queues standing
 * there indefinitely — reported from play as a five-minute wait.
 */
const DEADLOCK_OVERLAP_M = 7;
/** Bumper-to-bumper enough that a car behind is in the way of a reverse. */
const YIELD_CHAIN_GAP_M = 14;
/** While one car is out in the opposing lane, oncoming traffic this close waits. */
const OPPOSING_PASS_EXCLUSION_M = 260;
/**
 * And the car BEHIND the passer, in the same direction, waits its turn from this far
 * back. Shorter than the opposing figure on purpose: a driver 260 m behind an overtake
 * is not queueing behind it and has its own window to judge, while one inside this
 * distance is looking at the same gap in the same lane at the same moment.
 */
const LEADER_PASS_EXCLUSION_M = 120;
const DEADLOCK_STOP_SPEED_MPS = 1.5;
/**
 * Metres up the outgoing lane before a turning car is handed back to the ordinary road.
 *
 * Not zero: the line's exit tail IS the outgoing lane, and letting go at the moment the
 * two coincide hands the stream a car that is still finishing a 6 m hook, with a lateral
 * error the road's own planner then reads as a departure to recover from.
 */
const TURN_REJOIN_M = 25;
/**
 * Ambient drivers do not need a new multi-ray route plan at the 60 Hz suspension
 * rate. Forty-five decisions per second keep obstacle latency below 23 ms while
 * reducing the dominant traffic CPU cost; vehicle forces still advance every
 * physics step.
 */
const TRAFFIC_CONTROL_INTERVAL_S = 1 / 45;
/**
 * How often the coordinator's PAIRWISE rules are re-answered, seconds.
 *
 * Deadlock right-of-way, reverse room and pass permission are each O(cars²), and what
 * they hand out is latched until the next pass. See the note at the call site for why
 * a tenth of a second is not a staleness anybody can drive into.
 */
const COORDINATION_INTERVAL_S = 0.1;
/**
 * Body half-extents the traffic field reports, metres. One figure for the catalogue
 * rather than a per-model measure: the field is consulted to decide whether a body is
 * in a lane and whether it is closing, and being slightly pessimistic about the widest
 * saloon costs nothing while making every driver's answer the same.
 */
const NEIGHBOUR_HALF_WIDTH_M = 1.0;
const NEIGHBOUR_HALF_LENGTH_M = 2.3;
/** The id the player's own car is excluded by when it asks for a field of its own. */
export const PLAYER_FIELD_ID = 'player';
/**
 * What the traffic field needs to know about the driver asking: where it is along the
 * road and which way it is going. `TrafficCar` satisfies it, and so does a small
 * record kept by a bench or by the player's own wiring — the point is that the field
 * reads it LIVE, so a car that turns round at the road's end keeps a correct view.
 */
export interface FieldOwner {
  readonly forwardS: number;
  readonly direction: 1 | -1;
}

type TrafficDirection = 1 | -1;
export type TrafficDriverStyle = 'cautious' | 'normal' | 'hurried';


interface TrafficCar {
  readonly id: string;
  /**
   * Which way this car is driving. NOT fixed for life: a car that reaches the road's
   * start turns round in the bulb there and leaves in the other direction, and this
   * flips at the moment it is back in the outgoing lane (see `finishTurn`).
   */
  direction: TrafficDirection;
  readonly modelId: string;
  spawnS: number;
  readonly vehicle: Vehicle;
  readonly autopilot: Autopilot;
  readonly style: TrafficDriverStyle;
  readonly headwayS: number;
  readonly speedCap: number;
  /** Share of its mode's pace this driver uses; see `Autopilot.setPace`. */
  readonly pace: number;
  roadLateral: number;
  /** Current body projection across the road, including yaw/roll. */
  roadHalfWidth: number;
  readonly halfExtents: readonly [number, number, number];
  readonly bodyRadius: number;
  /**
   * Speed along the road's FORWARD direction, metres per second, refreshed with
   * `forwardS` every step. Published through the traffic field so a driver can know
   * what is catching it up without asking the physics for a ray it cannot trust; see
   * `vehicle/trafficfield.ts`.
   */
  forwardSpeed: number;
  readonly input: InputFrame;
  forwardS: number;
  settleFor: number;
  lifetimeTimer: number;
  /**
   * The lane this car was PLACED in, counted outward from the crown. Spawn
   * bookkeeping only: which lane it then drives in is its own driver's decision (see
   * the home lane in `Autopilot.drive`), so this stops describing reality the first
   * time the car passes anybody.
   */
  lane: number;
  /** Edge-detects the autopilot's pass activity so a manoeuvre counts once. */
  wasPassing: boolean;
  /** Seconds this car has been standing still; see the recycle rule in `fixedUpdate`. */
  stoppedFor: number;
  /**
   * Arclength along the turning-circle line while this car is on it, or -1 when it is
   * driving the ordinary road. A turning car is out of the road's frame entirely: it is
   * excluded from lane merges, passing, the deadlock coordinator and reverse-room, all
   * of which reason about who is ahead of whom in ONE direction of travel.
   */
  turnS: number;
  /** Schedule remainder, independent of elapsed time actually sent to drive. */
  controlAccumulator: number;
  controlElapsed: number;
}

const FORWARD_QUEUE_ORDER = (a: TrafficCar, b: TrafficCar): number =>
  b.forwardS - a.forwardS;
const REVERSE_QUEUE_ORDER = (a: TrafficCar, b: TrafficCar): number =>
  a.forwardS - b.forwardS;

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
  /** Share of its mode's pace this driver uses; see `Autopilot.setPace`. */
  readonly pace: number;
  readonly lane: number;
  readonly rear: boolean;
  /** Remaining chain budget for a platoon mate spawned off this one; see `queuePlatoonMate`. */
  readonly platoonChain?: number;
}

export interface TrafficStatus {
  /**
   * Live cars in front of the player — the part of the quota he can actually see.
   * The stream is spawned ahead and collected behind, so this is the number the
   * stream is judged by, not `count`.
   */
  readonly ahead: number;
  readonly count: number;
  /**
   * Cars the stream is currently trying to hold: one rotation of the density, between
   * `DENSITY_FLOOR` of `cap` and `cap` itself.
   */
  readonly target: number;
  /**
   * Replenishment ceiling from the carriageway: `NARROW_TRAFFIC` on two lanes and
   * `WIDE_TRAFFIC` on four. Existing visible cars can exceed it while a narrowing
   * drains naturally; it is not a hard limit on the live count.
   */
  readonly cap: number;
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
  /**
   * The line round the bulb at the road's start, and an empty hazard field to drive it
   * with. Hazards are indexed by the world road's arclength and there is nothing on the
   * paving to index anyway (`world/deserttiledata.ts` keeps tile props off it), so a
   * turning car sees other cars by proximity and nothing else.
   */
  private readonly turnaround: TurnaroundRoad;
  private readonly noHazards: HazardField = { forEachAhead: () => {} };
  private readonly random: () => number;
  private readonly carList: TrafficCar[] = [];
  /** Reused coordinator scratch; allocating and sorting two fresh arrays at 60 Hz caused GC churn. */
  private readonly forwardQueue: TrafficCar[] = [];
  private readonly reverseQueue: TrafficCar[] = [];
  /**
   * The widest stream this stretch of road will hold, from `widenessAt`. Recomputed
   * every step because the widening changes under the stream as it drives.
   */
  private roadCap = NARROW_TRAFFIC;
  /** Current natural-looking density, at or below `roadCap`. */
  private desiredCount = 0;
  /**
   * The present jitter draw as a fraction of the cap. Holding it between re-rolls
   * lets a widening carriageway fill smoothly instead of visibly changing density at
   * a profile sample boundary.
   */
  private densityFraction = 0;
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
  private playerStepTravel = 0;
  /**
   * The player's own lateral and whether he is in a car at all, maintained with
   * `playerS` so the traffic field can carry him. A driver's rearward sensing cannot
   * find him and the coordinator's rules ignored him entirely: he was the one vehicle
   * on the road that nothing arbitrated around.
   */
  private playerLateral = 0;
  private playerDriving = false;
  private readonly spawnPoint = { x: 0, y: 0, z: 0 };
  private readonly position = { x: 0, y: 0, z: 0 };
  private pedestrianActive = false;
  private pedestrianPrimed = false;
  private pedestrianX = 0;
  private pedestrianZ = 0;
  private pedestrianPreviousX = 0;
  private pedestrianPreviousZ = 0;
  private pedestrianVx = 0;
  private pedestrianVz = 0;
  private readonly groundProbeOrigin = { x: 0, y: 0, z: 0 };
  private readonly groundProbeDirection = { x: 0, y: -1, z: 0 };
  private readonly spawnCondition: RoadConditionBuffer = {
    surface: SurfaceType.Asphalt, decay: 0, sandCover: 0, markings: 0,
  };
  private settingsRef: Settings | null = null;
  private clockSync = 0;
  private coordinationTimer = 0;
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
    this.turnaround = new TurnaroundRoad(road);
    this.reverseHazards = new ReversedHazardIndex(hazards, road.length);
    this.random = mulberry32(sourceWorld.seed ^ 0x74726166);
    this.syncSettings();
    this.refreshRoadCap();
    this.redrawDesiredCount();
    this.densityTimer = this.drawDensityInterval();
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
      count: this.carList.length,
      ahead,
      target: this.desiredCount,
      cap: this.roadCap,
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
   * A view of every OTHER vehicle near one driver, in that driver's own frame.
   *
   * The coordinator already refreshes arclength, lateral and road speed for every car
   * once a step, and the player's arclength and pace arrive with `fixedUpdate`, so
   * this is a projection of data that exists rather than a second source of truth.
   * The player is in it: he is the one vehicle a driver most needs to know about, and
   * the one a rearward ray is least able to find.
   *
   * `excludeId` keeps a car out of its own answer. The buffer is reused per visit,
   * which is why `TrafficField` documents that it must not be retained.
   */
  fieldFor(owner: FieldOwner, excludeId: string): TrafficField {
    const buffer = {
      s: 0,
      lateral: 0,
      speed: 0,
      halfWidth: NEIGHBOUR_HALF_WIDTH_M,
      halfLength: NEIGHBOUR_HALF_LENGTH_M,
    };
    const visit = (
      otherS: number,
      otherLateral: number,
      otherSpeed: number,
      ownS: number,
      ahead: number,
      behind: number,
      fn: (neighbour: TrafficNeighbour) => void,
    ): void => {
      const along = (otherS - ownS) * owner.direction;
      // Centre to near face, with longitudinal overlap included in both queries.
      const faced = Math.sign(along) * Math.max(0, Math.abs(along) - NEIGHBOUR_HALF_LENGTH_M);
      if (faced > ahead || faced < -behind) return;
      buffer.s = faced;
      buffer.lateral = otherLateral * owner.direction;
      buffer.speed = otherSpeed * owner.direction;
      fn(buffer);
    };
    return {
      forEachNear: (ahead, behind, fn) => {
        const ownS = owner.forwardS;
        for (const car of this.carList) {
          if (car.id === excludeId || car.settleFor > 0 || car.turnS >= 0) continue;
          visit(car.forwardS, car.roadLateral, car.forwardSpeed, ownS, ahead, behind, fn);
        }
        if (excludeId !== PLAYER_FIELD_ID && this.playerDriving) {
          visit(
            this.playerS,
            this.playerLateral,
            this.playerSpeed,
            ownS,
            ahead,
            behind,
            fn,
          );
        }
      },
    };
  }

  /**
   * Resolves an opposing-queue stalemate centrally instead of letting every driver
   * guess. Only the forward-direction head receives permission; cars behind either
   * head remain ordinary followers. Separate clusters may resolve concurrently.
   */
  private assignDeadlockPermissions(): void {
    for (const car of this.carList) car.autopilot.setDeadlockPermission(false);
    for (const candidate of this.carList) {
      // THE STANDOFF IS ITS OWN EVIDENCE.
      //
      // This used to require the candidate to have something its own sensors could
      // report — a dynamic lead, or being off the road. A car held up by an INDEXED
      // prop with the opposing head level beside it has neither, and that is exactly
      // the arrangement that stood for minutes. Both cars stopped, nothing between
      // them, one of them facing the other: that is enough to hand somebody right of
      // way, and the tests below are what keep it to one car per cluster.
      if (candidate.direction !== 1 || candidate.settleFor > 0 || candidate.turnS >= 0) continue;
      const velocity = candidate.vehicle.chassis.linvel();
      if (Math.hypot(velocity.x, velocity.z) >= DEADLOCK_STOP_SPEED_MPS) continue;

      let opposing: TrafficCar | null = null;
      let opposingGap = Infinity;
      for (const other of this.carList) {
        if (other.direction !== -1 || other.settleFor > 0) continue;
        // Level counts. See DEADLOCK_OVERLAP_M: a standoff that has crept into an
        // overlap is still a standoff, and it used to be the one nobody resolved.
        const ahead = other.forwardS - candidate.forwardS;
        if (ahead > -DEADLOCK_OVERLAP_M && ahead < opposingGap) {
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

      // Nobody between them. With an overlapped pair the span is zero, so the test
      // degenerates to "no third car in the same place", which is the right answer.
      const span = Math.max(opposingGap, 0);
      let headsMeet = true;
      for (const other of this.carList) {
        if (other === candidate || other === opposing) continue;
        const ahead =
          other.direction === 1
            ? other.forwardS - candidate.forwardS
            : opposing.forwardS - other.forwardS;
        if (ahead > 0 && ahead < span) {
          headsMeet = false;
          break;
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
    this.forwardQueue.length = 0;
    this.reverseQueue.length = 0;
    for (const car of this.carList) {
      car.autopilot.setYieldReverse(false);
      if (car.settleFor > 0 || car.turnS >= 0) continue;
      (car.direction === 1 ? this.forwardQueue : this.reverseQueue).push(car);
    }
    this.forwardQueue.sort(FORWARD_QUEUE_ORDER);
    this.reverseQueue.sort(REVERSE_QUEUE_ORDER);
    this.assignReverseRoomInQueue(this.forwardQueue);
    this.assignReverseRoomInQueue(this.reverseQueue);
  }

  private assignReverseRoomInQueue(queue: readonly TrafficCar[]): void {
    for (let i = 0; i < queue.length; i++) {
      const ahead = queue[i]!;
      if (!ahead.autopilot.needsReverseRoom) continue;
      for (let j = i + 1; j < queue.length; j++) {
        const behind = queue[j]!;
        const gap = Math.abs(ahead.forwardS - behind.forwardS);
        if (gap > YIELD_CHAIN_GAP_M) break;
        if (Math.abs(ahead.roadLateral - behind.roadLateral) >= ahead.roadHalfWidth + behind.roadHalfWidth) {
          continue;
        }
        behind.autopilot.setYieldReverse(true);
        break;
      }
    }
  }

  /**
   * ONE CAR AT A TIME IN THE OPPOSING LANE, AND ONE OVERTAKE AT A TIME IN A QUEUE.
   *
   * Each driver checks the opposing lane for itself and finds it clear, because the
   * car coming the other way is in its OWN lane, minding its own business — right
   * up until it makes the same decision. Two individually correct overtakes then
   * meet head-on, and nothing inside a single car can see that coming. So the
   * coordinator owns it: while a car is out in the wrong lane, nothing coming the
   * other way within `OPPOSING_PASS_EXCLUSION_M` may start a pass of its own.
   *
   * THE CAR BEHIND THE PASSER IS THE OTHER HALF OF THE SAME RULE, and it was missing.
   * A driver whose leader has just pulled out sees a lane that is suddenly clear, its
   * own pace restored, and the same window — so it followed it out, two abreast in a
   * lane that holds one. Nothing inside either car can price that either: from behind,
   * the passer is simply traffic that has left the lane. The leader is the one who
   * committed first, so the follower waits, which is also what a driver does.
   */
  private assignPassPermissions(): void {
    // THE PLAYER COUNTS, AND HE DID NOT USED TO.
    //
    // The exclusion was computed over the coordinator's own cars, so a driver was
    // free to start an overtake into the one vehicle whose behaviour it could not
    // predict at all. If the player is out over the centreline — overtaking himself,
    // going round something, or simply wandering — nothing coming the other way near
    // him may borrow that lane as well, and nothing following him may either. His
    // lateral arrives with `fixedUpdate`; his direction is the road's forward sense,
    // which is what `activeS` is measured in.
    const playerAcrossCrown =
      this.playerDriving && this.playerLateral > CROWN_CROSSING_INTRUSION_M;
    for (const car of this.carList) {
      if (car.turnS >= 0) continue;
      const playerAhead = (this.playerS - car.forwardS) * car.direction;
      const blocked =
        (playerAcrossCrown &&
          car.direction === -1 &&
          Math.abs(this.playerS - car.forwardS) < OPPOSING_PASS_EXCLUSION_M) ||
        (playerAcrossCrown &&
          car.direction === 1 &&
          playerAhead > 0 &&
          playerAhead < LEADER_PASS_EXCLUSION_M) ||
        this.carList.some(
          (other) =>
            other !== car &&
            (other.autopilot.activity === 'pass' || this.isAcrossCrown(other)) &&
            (other.direction !== car.direction
              ? Math.abs(other.forwardS - car.forwardS) < OPPOSING_PASS_EXCLUSION_M
              : (other.forwardS - car.forwardS) * car.direction > 0 &&
                (other.forwardS - car.forwardS) * car.direction < LEADER_PASS_EXCLUSION_M),
        );
      car.autopilot.setPassingEnabled(!blocked);
    }
  }

  /**
   * `Road.laneCentreAt` is signed in the caller's travel frame. Spawning uses the
   * forward road's frame even for oncoming traffic, so mirror that signed answer
   * before passing it to the forward `offsetPoint` geometry.
   */
  private forwardLaneCentreAt(s: number, direction: TrafficDirection, lane: number): number {
    const ownRoad = direction === 1 ? this.road : this.reverseRoad;
    const ownS = direction === 1 ? s : this.road.length - s;
    const ownLateral = ownRoad.laneCentreAt(ownS, lane);
    return direction === 1 ? ownLateral : -ownLateral;
  }

  /** The sign corrected into a driver's frame makes this a literal crown crossing. */
  private isAcrossCrown(car: TrafficCar): boolean {
    return car.roadLateral * car.direction > CROWN_CROSSING_INTRUSION_M;
  }

  /** Makes the on-foot player visible to traffic without allocating a synthetic body. */
  setPedestrianObstacle(x: number, z: number): void {
    this.pedestrianActive = true;
    this.pedestrianX = x;
    this.pedestrianZ = z;
  }

  /** A seated player is already represented by the driven vehicle's chassis. */
  clearPedestrianObstacle(): void {
    this.pedestrianActive = false;
    this.pedestrianPrimed = false;
    this.pedestrianVx = 0;
    this.pedestrianVz = 0;
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


  /**
   * Writes every traffic controller before the shared physics step.
   *
   * `playerLateral` is the player's own signed offset from the centreline, in the
   * road's forward frame, and it is not decoration: it is what puts him into the
   * traffic field and therefore into the rules the stream arbitrates with. A negative
   * lateral means he is left of the centreline as the road runs.
   */
  fixedUpdate(
    dt: number,
    playerS: number,
    playerLateral: number,
    originX: number,
    originZ: number,
  ): void {
    // A jump this large is a teleport (load, fast travel, the despawn-range test),
    // not motion, and must not be read as a speed no traffic could ever match.
    const advance = playerS - this.playerS;
    this.playerSpeed =
      dt > 0 && Math.abs(advance) < 50
        ? this.playerSpeed * 0.9 + (advance / dt) * 0.1
        : 0;
    this.playerLateral = playerLateral;
    this.playerStepTravel = Math.abs(advance) < 50 ? Math.abs(advance) : 0;
    this.playerDriving = this.sourceWorld.state.player.drivingCarId !== null;
    this.playerS = playerS;
    if (this.pedestrianActive) {
      const dx = this.pedestrianX - this.pedestrianPreviousX;
      const dz = this.pedestrianZ - this.pedestrianPreviousZ;
      if (this.pedestrianPrimed && dt > 0 && dx * dx + dz * dz < 64) {
        this.pedestrianVx = dx / dt;
        this.pedestrianVz = dz / dt;
      } else {
        this.pedestrianVx = 0;
        this.pedestrianVz = 0;
      }
      this.pedestrianPreviousX = this.pedestrianX;
      this.pedestrianPreviousZ = this.pedestrianZ;
      this.pedestrianPrimed = true;
    }
    this.syncSettings();
    // Narrowing limits replenishment, not the lifetime of cars still in view.
    this.refreshRoadCap();
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
      this.redrawDesiredCount();
      this.densityTimer = this.drawDensityInterval();
    } else {
      this.desiredCount = this.scaleDesiredCount(this.roadCap);
    }

    // Refresh the shared road-frame snapshot before trimming or coordinating.
    // Support is checked every physics step, not on the slower stuck-car timer.
    for (let i = this.carList.length - 1; i >= 0; i--) {
      const car = this.carList[i]!;
      car.vehicle.absoluteTranslation(this.position);
      const projection = this.road.project(this.position.x, this.position.z, car.forwardS);
      car.forwardS = projection.s;
      car.roadLateral = projection.lateral;
      // Along the road, not along the body: a car halfway through a manoeuvre still
      // closes on what is in front of it at its road speed, and that is the number a
      // driver behind it has to reason about.
      const sample = this.road.sampleAt(projection.s);
      const velocity = car.vehicle.chassis.linvel();
      const half = car.halfExtents;
      const travelMargin = Math.hypot(velocity.x, velocity.z) * dt + this.playerStepTravel;
      if (Math.abs(car.forwardS - playerS) + car.bodyRadius + travelMargin + PHYSICS_EDGE_SLACK_M >= PHYSICS_REACH_M) {
        this.removeAt(i);
        continue;
      }
      const q = car.vehicle.chassis.rotation();
      const rightX = Math.cos(sample.heading);
      const rightZ = -Math.sin(sample.heading);
      // Project each rotated chassis-box axis onto the road's lateral axis.
      car.roadHalfWidth =
        Math.abs(rightX * (1 - 2 * (q.y * q.y + q.z * q.z)) + rightZ * 2 * (q.x * q.z - q.w * q.y)) * half[0] +
        Math.abs(rightX * 2 * (q.x * q.y - q.w * q.z) + rightZ * 2 * (q.y * q.z + q.w * q.x)) * half[1] +
        Math.abs(rightX * 2 * (q.x * q.z + q.w * q.y) + rightZ * (1 - 2 * (q.x * q.x + q.y * q.y))) * half[2];
      car.forwardSpeed =
        velocity.x * Math.sin(sample.heading) + velocity.z * Math.cos(sample.heading);
    }
    this.trimTo(this.desiredCount);

    // THE PAIRWISE RULES DO NOT NEED THE SUSPENSION'S CLOCK.
    //
    // All three are O(cars²) — each asks "is anybody else doing X within N metres" for
    // every car — and they were being answered sixty times a second. On a widened
    // stretch the stream is `WIDE_TRAFFIC` rather than `NARROW_TRAFFIC`, so the pair
    // count more than quadruples exactly where the road opens out, which is where the
    // simulation was reported growing teeth. The same is true of the oncoming scan in
    // the loop below, which is a linear pass per car and exists to dip a headlight.
    //
    // What they produce are PERMISSIONS, latched until re-evaluated, and read by
    // drivers that decide at `TRAFFIC_CONTROL_INTERVAL_S` about manoeuvres measured in
    // hundreds of metres. A tenth of a second of staleness is 4 m of closure between
    // two cars meeting at 70 km/h, against exclusion windows of 120 and 260 m.
    this.coordinationTimer -= dt;
    const coordinate = this.coordinationTimer <= 0;
    if (coordinate) {
      this.coordinationTimer = COORDINATION_INTERVAL_S;
      this.assignDeadlockPermissions();
      this.assignReverseRoom();
      this.assignPassPermissions();
    }
    for (let i = this.carList.length - 1; i >= 0; i--) {
      const car = this.carList[i]!;
      if (this.pedestrianActive) {
        car.autopilot.setPedestrianObstacle(
          this.pedestrianX,
          this.pedestrianZ,
          this.pedestrianVx,
          this.pedestrianVz,
        );
      } else {
        car.autopilot.clearPedestrianObstacle();
      }
      if (coordinate) {
        car.autopilot.setLightingConditions(
          this.daylightFactor,
          this.nearestOncomingDistance(car.forwardS, car.direction, car.id),
        );
      }
      car.lifetimeTimer -= dt;
      // A CAR THAT HAS BEEN STANDING STILL FOR HALF A MINUTE IS NOT TRAFFIC.
      //
      // Ambient traffic is transient scenery: it is already recycled by distance and
      // trimmed by density, and this is the third reason to recycle one. Whatever a
      // driver has got itself into — bogged on the verge past a prop, nose to nose
      // with an opposing head, wedged against something nothing reports — the
      // guarantee the world needs is that the jam cannot become permanent. Only out
      // of sight: a car the player is watching keeps trying, because a car that
      // vanished in front of him would be worse than the wait.
      car.stoppedFor = car.vehicle.speedKmh < STUCK_SPEED_KMH ? car.stoppedFor + dt : 0;
      if (car.lifetimeTimer <= 0) {
        car.lifetimeTimer = LIFETIME_SAMPLE_S;
        const offset = car.forwardS - playerS;
        if (
          car.stoppedFor > STUCK_RECYCLE_S &&
          Math.abs(offset) > STUCK_RECYCLE_SIGHT_M &&
          car.settleFor <= 0
        ) {
          this.removeAt(i);
          continue;
        }
      }
      if (car.settleFor > 0) {
        car.settleFor -= dt;
        car.vehicle.settle(dt);
      } else {
        this.serviceTurn(car);
        car.controlAccumulator += dt;
        car.controlElapsed += dt;
        if (car.controlAccumulator >= TRAFFIC_CONTROL_INTERVAL_S) {
          const controlDt = car.controlElapsed;
          car.controlElapsed = 0;
          car.controlAccumulator %= TRAFFIC_CONTROL_INTERVAL_S;
          car.autopilot.drive(controlDt, car.vehicle, car.input, originX, originZ);
        }
        car.vehicle.fixedUpdate(dt, car.input);
        const passing = car.autopilot.activity === 'pass';
        if (passing && !car.wasPassing) this.passCount++;
        car.wasPassing = passing;
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
        this.desiredCount > DENSE_TRAFFIC_THRESHOLD ? DENSE_SPAWN_INTERVAL_S : SPAWN_INTERVAL_S;
    }
  }

  /**
   * Sends a car that has reached the end of the world round the turning circle, and
   * takes it back when it is out the other side.
   *
   * THE ROAD ENDS AT s = 0 and nothing used to happen there: an oncoming car drove to
   * the last metre of asphalt, sat against the clamp its reversed road view collapsed
   * to, and was eventually recycled out of sight. Now it drives the bulb.
   *
   * The handover is one call each way because `Autopilot.retarget` resets everything the
   * driver holds about where it is. Everything the STREAM holds is here: direction and
   * the arclength its "is it still moving" test is measured from.
   */
  private serviceTurn(car: TrafficCar): void {
    if (car.turnS < 0) {
      if (car.direction !== -1 || car.forwardS > TURNAROUND_ENTRY_S) return;
      car.turnS = 0;
      car.autopilot.setPassingEnabled(false);
      car.autopilot.retarget(this.turnaround, this.noHazards);
      car.autopilot.setEngaged(true);
      return;
    }
    car.vehicle.absoluteTranslation(this.position);
    car.turnS = this.turnaround.project(this.position.x, this.position.z, car.turnS).s;
    if (car.turnS < this.turnaround.exitS + TURN_REJOIN_M) return;
    car.turnS = -1;
    car.direction = 1;
    car.lane = this.pickSpawnLane(car.forwardS, car.style);
    car.spawnS = car.forwardS;
    car.autopilot.retarget(this.road, this.hazards);
    car.autopilot.setEngaged(true);
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
    // The driver is drawn BEFORE the site, because which road is worth searching
    // depends on the cap it was given. A car slower than the player that starts
    // behind him is a car he will never see: it only falls further back until the
    // rear despawn collects it. Oncoming traffic behind him is worse still — it
    // drives away from the moment it exists.
    const driver = this.drawDriver(direction);
    const fromBehind =
      direction === 1 && driver.speedCap > this.playerSpeed + REAR_SPAWN_CLOSING_MPS;
    const spawn = this.findSpawnS(direction, fromBehind, driver.style);
    if (spawn === null) return;
    const model = CAR_MODELS[Math.floor(this.random() * CAR_MODELS.length)]!;
    const request: PendingSpawn = {
      generation: this.generation,
      direction,
      forwardS: spawn.s,
      modelId: model.id,
      id: `${TRAFFIC_ID_PREFIX}${(this.serial++).toString(36)}`,
      style: driver.style,
      headwayS: driver.headwayS,
      mode: driver.mode,
      speedCap: driver.speedCap,
      pace: driver.pace,
      lane: spawn.lane,
      rear: spawn.s < this.playerS,
      platoonChain: PLATOON_MAX_CHAIN,
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
    // already outside the physical support window.
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
    const measure = carModelMeasure(request.modelId);
    const bodyRadius = Math.hypot(...measure.halfExtents);
    if (
      request.lane >= this.road.lanesPerSideAt(request.forwardS) ||
      !this.spawnSiteClear(request.forwardS, request.direction, request.lane, measure.halfExtents[0], bodyRadius)
    ) {
      return;
    }
    if (Math.abs(offset) + bodyRadius + this.playerStepTravel + PHYSICS_EDGE_SLACK_M >= PHYSICS_REACH_M) return;

    const roadPoint = this.road.sampleAt(request.forwardS);
    const forwardLateral = this.forwardLaneCentreAt(
      request.forwardS,
      request.direction,
      request.lane,
    );
    const x = roadPoint.x + Math.cos(roadPoint.heading) * forwardLateral;
    const z = roadPoint.z - Math.sin(roadPoint.heading) * forwardLateral;
    const worldGap =
      this.road.lanesPerSideAt(request.forwardS) === 2
        ? WIDE_SPAWN_WORLD_GAP_M
        : SPAWN_WORLD_GAP_M;
    if (!this.isSpawnClear(x, z, worldGap)) return;
    // Keep the immediate spawn footprint clear of every body, in either direction,
    // in addition to the same-direction stopping room checked by roadGapClear.
    // `forwardLateral` is already the road-frame offset used to build x/z above.
    for (const car of this.carList) {
      if (
        Math.abs(car.forwardS - request.forwardS) < SPAWN_BODY_ALONG_M &&
        Math.abs(car.roadLateral - forwardLateral) < SPAWN_BODY_ACROSS_M
      ) {
        return;
      }
    }
    const heading = roadPoint.heading + (request.direction === -1 ? Math.PI : 0);
    const y = carSpawnYAboveGround(
      measure,
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
    // LIT FROM THE FIRST FRAME IT IS VISIBLE. Ambient cars run on dipped beam always,
    // but that policy is applied by the driver, and a car does not drive during its
    // settle: for the first `DROP_SETTLE_S` of its life it stood there dark, which the
    // bench read - correctly - as "18 of 19 cars lit".
    vehicle.setHeadlights('low');
    autopilot.setPassingEnabled(true);
    autopilot.setFollowingHeadway(request.headwayS);
    autopilot.setMode(request.mode);
    autopilot.setSpeedCap(request.speedCap);
    autopilot.setPace(request.pace);
    autopilot.setTrafficRecoveryPolicy(true);
    autopilot.setLowBeamsAlwaysOn(true);
    autopilot.setEngaged(true);
    const record: TrafficCar = {
      id: request.id,
      direction: request.direction,
      vehicle,
      modelId: request.modelId,
      style: request.style,
      headwayS: request.headwayS,
      roadLateral: forwardLateral,
      roadHalfWidth: measure.halfExtents[0],
      halfExtents: measure.halfExtents,
      bodyRadius,
      forwardSpeed: 0,
      speedCap: request.speedCap,
      pace: request.pace,
      spawnS: request.forwardS,
      autopilot,
      input: emptyInput(),
      forwardS: request.forwardS,
      settleFor: DROP_SETTLE_S,
      lane: request.lane,
      lifetimeTimer: LIFETIME_SAMPLE_S,
      stoppedFor: 0,
      wasPassing: false,
      controlAccumulator:
        (this.carList.length & 1) * (TRAFFIC_CONTROL_INTERVAL_S * 0.5),
      controlElapsed: 0,
      turnS: -1,
    };
    // The field reads the record's live arclength and direction, so it keeps working
    // as the car drives and, after a turnaround, as its direction flips.
    autopilot.setTrafficField(this.fieldFor(record, record.id));
    this.carList.push(record);
    this.queuePlatoonMate(record, request.platoonChain ?? PLATOON_MAX_CHAIN);
  }

  /**
   * Occasionally drags a second car in right behind one that just finished spawning,
   * at the distance its own headway would ask for at its own target speed — see
   * `PLATOON_CHANCE` for why. Goes through the same async model-load path as an
   * ordinary spawn, so a slow-loading model degrades exactly like any other spawn
   * (silently dropped, never blocking) rather than needing its own error handling.
   */
  private queuePlatoonMate(leader: TrafficCar, chainRemaining: number): void {
    if (chainRemaining <= 0) return;
    if (this.pending !== null) return;
    if (this.carList.length >= this.desiredCount) return;
    if (this.random() >= PLATOON_CHANCE) return;
    const followGap = Math.max(PLATOON_MIN_GAP_M, leader.speedCap * leader.headwayS);
    const s = leader.forwardS - leader.direction * followGap;
    if (s < END_MARGIN_M || s > this.road.length - END_MARGIN_M) return;
    const lane = leader.lane;
    if (!this.spawnSiteClear(s, leader.direction, lane, TRAFFIC_HALF_WIDTH_M, NEIGHBOUR_HALF_LENGTH_M, leader.id)) {
      return;
    }
    // Reuses the leader's own model rather than drawing a fresh random one: the
    // leader's model just finished loading (it is instantiated and on screen), so
    // this spawn is guaranteed warm. A platoon mate fires the moment its leader
    // does, bypassing the ordinary `spawnCooldown` that spaces solo spawns out — a
    // fresh random pick here could land on a model nothing has used yet and start a
    // second GLTF fetch/parse/upload back-to-back with the first, which is a stutter,
    // not a frame-time average, so it would not show up in the aggregate report.
    const request: PendingSpawn = {
      generation: this.generation,
      direction: leader.direction,
      forwardS: s,
      modelId: leader.modelId,
      id: `${TRAFFIC_ID_PREFIX}${(this.serial++).toString(36)}`,
      // Rides in convoy: the same character as the car it is tucked behind, so the
      // pair does not immediately pull apart onto a different target speed.
      style: leader.style,
      headwayS: leader.headwayS,
      mode: leader.autopilot.mode,
      speedCap: leader.speedCap,
      pace: leader.pace,
      lane,
      rear: s < this.playerS,
      platoonChain: chainRemaining - 1,
    };
    this.pending = request;
    void this.prepareModel(request.modelId)
      .then(() => this.finishSpawn(request))
      .catch((error: unknown) => console.error(`failed to load traffic model "${request.modelId}"`, error))
      .finally(() => {
        if (this.pending === request) this.pending = null;
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
  private findSpawnS(
    direction: TrafficDirection,
    fromBehind: boolean,
    style: TrafficDriverStyle,
  ): { s: number; lane: number } | null {
    for (let attempt = 0; attempt < 12; attempt++) {
      const behind = fromBehind && attempt < 6;
      const distance = behind
        ? -(REAR_SPAWN_MIN_M + this.random() * (REAR_SPAWN_MAX_M - REAR_SPAWN_MIN_M))
        // Skewed toward SPAWN_MAX_M: `sqrt(u)` for `u` uniform on [0,1] has CDF `x^2`,
        // so it under-samples near 0 and over-samples near 1. A flat draw put half its
        // mass inside the first 130 m of this 260 m band, so the median spawn sat
        // close enough that "a car appears" was a distinct, watched event rather than
        // something resolving out of the fog. SPAWN_MAX_M cannot move — it is exactly
        // PHYSICS_REACH_M, the edge of the road's own collision support, past which
        // `hasSpawnGround` has nothing to raycast against — so this reshapes the same
        // band instead of widening it.
        : SPAWN_MIN_M + Math.sqrt(this.random()) * (SPAWN_MAX_M - SPAWN_MIN_M);
      const s = this.playerS + distance;
      if (s < END_MARGIN_M || s > this.road.length - END_MARGIN_M) continue;
      const lane = this.pickSpawnLane(s, style);
      if (this.spawnSiteClear(s, direction, lane)) return { s, lane };
    }
    return null;
  }
  /**
   * WHERE A CAR IS PUT WHEN IT IS CREATED, and it is put where it is going to drive.
   *
   * A driver's lane is a property of its own pace (`INNER_LANE_PACE_MPS` in the
   * autopilot), so a spawn draw that disagrees with the sort buys nothing: the car
   * simply changes lane once, in front of the player, for no reason he can see. The
   * styles map exactly onto the threshold — cautious runs 58-70 km/h and the ordinary
   * driver 72-84, both below it, while the hurried driver's 95-115 is above — so this
   * is the same decision, taken with the only thing a spawn site knows.
   *
   * It costs the wide stretch some density, since one lane cannot be packed as tightly
   * as two at the same 70 m of same-lane clearance. `findSpawnS` absorbs most of that
   * by trying twelve different arclengths rather than twelve lanes.
   */
  private pickSpawnLane(s: number, style: TrafficDriverStyle): number {
    const lanes = this.road.lanesPerSideAt(s);
    if (lanes === 1) return 0;
    return style === 'hurried' ? 0 : lanes - 1;
  }

  private spawnSiteClear(
    s: number, direction: TrafficDirection, lane: number,
    halfWidth = TRAFFIC_HALF_WIDTH_M, halfLength = NEIGHBOUR_HALF_LENGTH_M,
    /**
     * When set, this one car's gap requirement is a genuine following distance
     * (`PLATOON_MIN_GAP_M` floor) instead of the flat same-lane spacing floor. Every
     * other car, hazard and ground check is unaffected — this only lets a deliberate
     * platoon mate sit close behind the specific leader it was placed for.
     */
    platoonLeaderId: string | null = null,
  ): boolean {
    const laneHalfWidth = laneHalfWidthFor(this.road.halfWidthAt(s), lane);
    if (laneHalfWidth < TRAFFIC_HALF_WIDTH_M) return false;
    if (!this.roadGapClear(s, direction, lane, halfWidth, halfLength, platoonLeaderId)) return false;
    const lateral = this.forwardLaneCentreAt(s, direction, lane);
    let clear = true;
    this.hazards.forEachAhead(
      Math.max(0, s - SPAWN_HAZARD_GAP_M),
      SPAWN_HAZARD_GAP_M * 2,
      (hazard) => {
        if (Math.abs(hazard.lateral - lateral) <= hazard.radius + TRAFFIC_HALF_WIDTH_M) {
          clear = false;
        }
      },
    );
    if (!clear) return false;
    const point = this.road.offsetPoint(s, lateral, this.spawnPoint);
    return this.hasSpawnGround(point.x, point.y, point.z);
  }

  private roadGapClear(
    s: number, direction: TrafficDirection, lane: number,
    halfWidth = TRAFFIC_HALF_WIDTH_M, halfLength = NEIGHBOUR_HALF_LENGTH_M,
    platoonLeaderId: string | null = null,
  ): boolean {
    const sameDirectionGap =
      this.desiredCount > DENSE_TRAFFIC_THRESHOLD ? DENSE_SPAWN_ROAD_GAP_M : SPAWN_ROAD_GAP_M;
    const lateral = this.forwardLaneCentreAt(s, direction, lane);
    for (const car of this.carList) {
      const gap = Math.abs(car.forwardS - s);
      if (car.direction === direction && Math.abs(car.roadLateral - lateral) <= car.roadHalfWidth + halfWidth) {
        const spawnIsAhead = (s - car.forwardS) * direction > 0;
        let requiredGap = car.id === platoonLeaderId ? PLATOON_MIN_GAP_M : sameDirectionGap;
        if (spawnIsAhead) {
          // A stationary spawn must leave a moving follower room to stop. Its
          // recorded spawn lane is irrelevant after a merge, taper or overtake.
          this.road.conditionAt(car.forwardS, this.spawnCondition);
          const config = AUTOPILOT_MODES[car.autopilot.mode];
          const grade = this.road.sampleAt(car.forwardS).grade * direction;
          // Reserve half pedal, as ordinary obstacle following does, rather than
          // relying on emergency full braking to make a newly created car safe.
          const brake = Math.min(config.brakeAccel, car.vehicle.estimatedBrakeDecel(this.spawnCondition.surface) * 0.5) + grade * 9.81;
          const speed = Math.max(0, car.forwardSpeed * direction);
          const stop = speed > 0
            ? brake > 0 ? speed * speed / (2 * brake) : Infinity
            : 0;
          requiredGap = Math.max(
            SPAWN_ROAD_GAP_M,
            car.bodyRadius + halfLength + config.brakeLead + speed * TRAFFIC_CONTROL_INTERVAL_S + stop,
          );
        }
        if (gap < requiredGap) return false;
      }
      if (
        car.direction !== direction &&
        (car.autopilot.activity === 'pass' || this.isAcrossCrown(car)) &&
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
   * A CAP IN KM/H IS NOT A CHARACTER, because on this road it never binds.
   *
   * Measured on seed 1337 at s 40 000: the surface is 81% cracked asphalt and 19%
   * gravel with a mean decay of 0.6, and the autopilot's own surface and condition
   * factors hold the careful mode to 57 km/h and the hurried one to 75 whatever cap
   * it is given. The three characters were capped at 58-70, 72-84 and 95-115, so not
   * one of the three caps ever bound: the cautious and the ordinary driver share a
   * mode and therefore drove at exactly the same speed, and the whole stream's pace
   * spread came out at 10 km/h — a road of identical cars.
   *
   * `setPace` is a fraction of what the mode would do on the road it is actually on,
   * so it binds everywhere: on clean asphalt, on gravel, uphill. The cap stays as an
   * absolute ceiling for the few stretches good enough for one to matter.
   */
  private drawDriver(direction: TrafficDirection): {
    style: TrafficDriverStyle;
    headwayS: number;
    mode: AutopilotMode;
    speedCap: number;
    pace: number;
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
        pace: 0.68 + this.random() * 0.1,
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
        pace: 0.94 + this.random() * 0.06,
      };
    }
    return {
      style: 'normal',
      headwayS: 1.5 + this.random() * 0.9,
      mode: 'sleeper',
      speedCap: (72 + this.random() * 12) / 3.6,
      pace: 0.9 + this.random() * 0.1,
    };
  }
  /**
   * The player sees the live spawn band, not a point sample under the car. Averaging
   * five deterministic profile samples prevents a cell edge from pumping the stream
   * while still responding within the band traffic is about to occupy.
   *
   * The answer is the band's own carriageway size: a two-lane stretch holds
   * `NARROW_TRAFFIC` and a four-lane one `WIDE_TRAFFIC`, with the taper between them
   * interpolated so the cap follows the asphalt the stream is about to occupy.
   */
  private refreshRoadCap(): void {
    let wideness = 0;
    for (let i = 0; i < DENSITY_PROFILE_SAMPLES; i++) {
      const t = i / (DENSITY_PROFILE_SAMPLES - 1);
      const s = Math.max(
        0,
        Math.min(this.road.length, this.playerS + SPAWN_MIN_M + (SPAWN_MAX_M - SPAWN_MIN_M) * t),
      );
      wideness += widenessAt(this.sourceWorld.seed, s);
    }
    wideness /= DENSITY_PROFILE_SAMPLES;
    this.roadCap = NARROW_TRAFFIC + (WIDE_TRAFFIC - NARROW_TRAFFIC) * wideness;
  }

  /**
   * Re-roll at the established cadence, but against today's width-adjusted cap.
   * The retained fraction then expands or contracts continuously with the profile.
   */
  private redrawDesiredCount(): void {
    const cap = Math.round(this.roadCap);
    this.desiredCount = this.drawDesiredCount(cap);
    this.densityFraction = cap > 0 ? this.desiredCount / cap : 0;
  }

  private scaleDesiredCount(cap: number): number {
    if (cap <= 0) return 0;
    return Math.min(WIDE_TRAFFIC, Math.max(1, Math.round(cap * this.densityFraction)));
  }

  /**
   * One rotation of the density: a uniform draw in `[DENSITY_FLOOR * cap, cap]`.
   *
   * The floor moves WITH the cap rather than being a fixed number of cars, so a
   * widening that doubles the road doubles the quiet end of the range too, and the
   * stream never has to choose between being busier and being legible.
   */
  private drawDesiredCount(cap: number): number {
    if (cap <= 0) return 0;
    if (cap === 1) return 1;
    const floor = Math.max(1, Math.ceil(cap * DENSITY_FLOOR));
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
   * Both the rotating target and a natural road narrowing wait until a car falls
   * behind. Neither is permission to make visible traffic vanish.
   */
  private trimTo(count: number): void {
    while (this.carList.length > count) {
      const index = this.pickTrimIndex();
      if (index < 0) return;
      this.removeAt(index);
    }
  }

  /**
   * Farthest car behind the player. The player's road frame runs with increasing
   * `s`, so "behind" is exactly `playerS - forwardS`.
   */
  private pickTrimIndex(): number {
    let best = -1;
    let bestBehind = OFFSCREEN_TRIM_M;
    for (let i = 0; i < this.carList.length; i++) {
      const behind = this.playerS - this.carList[i]!.forwardS;
      if (behind > bestBehind) {
        bestBehind = behind;
        best = i;
      }
    }
    return best;
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
