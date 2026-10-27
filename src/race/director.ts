import type * as THREE from 'three';
import { emptyInput, type InputFrame } from '../core/input';
import type { PhysicsWorld } from '../core/physics';
import { formatPay } from '../economy/economy';
import { createServiceableCarState, poseOnGround } from '../game/spawn';
import type { CarState, GameWorld, TrailerState } from '../game/state';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { Autopilot } from '../vehicle/autopilot';
import { carModel, DEFAULT_CAR_MODEL_ID } from '../vehicle/carmodels';
import { TRAILER_CAPACITY_KG, TRAILER_SPAWN_HEIGHT } from '../vehicle/trailer';
import type { Vehicle } from '../vehicle/vehicle';
import type { WorldOrigin } from '../world/origin';
import { postStopsBetween } from '../world/poststops';
import { TRACK_LIFT_M } from '../world/racetrack/mesh';
import { CHUNK_SPREAD_M, postHasTrack } from '../world/racetrack/site';
import type { RaceTrack, TrackPose, TrackProjection } from '../world/racetrack/track';
import type { Terrain } from '../world/terrain';
import { hash01 } from '../core/rng';
import { raceRivalId, raceTrailerId } from './ids';
import { carClassOf, RIVAL_MODES, rivalPlan, type CarClass, type RivalPlan } from './rival';
import { RACE_LAPS, RaceSession, type RaceEnd, type Racer } from './session';
import { advanceRound, canStake, raceRound, RACE_PRIZE, RACE_STAKE, refundStake, settleStake, takeStake } from './stake';
import { RaceVisuals } from './visuals';

/**
 * THE RACES AT THE TRACKS (game-design2.md §19.7): the rival who waits at a track's grid,
 * the offer, the start, the laps and the result, run in the live world.
 *
 * WHERE. Every `SCAN_S` (never while a race is on) the director looks for the race track
 * (world/racetrack/) nearest the player whose grid is within `NEAR_M`. Its rival exists
 * only while that track's colliders do — the grid has fixed ground under it, which is the
 * owner chunk in the physics band — and is taken out of the world the moment they go.
 *
 * THE RIVAL is a car in world state (`raceRivalId`), standing in grid slot 1
 * (`startGrid[0]`, right of the crown) with the "RACE ME!" board beside it
 * (race/visuals.ts): streamed, drawn, collided and saved like every other car, LOCKED like
 * a handed-in haul (contracts/world.ts `haulLoadLock`). It is drawn for the track's round
 * and the car the player is in (race/rival.ts `rivalPlan`), put down only where it is not
 * seen up close, and swapped, unseen, for the right one when the round moves on or the
 * player comes in another car.
 *
 * THE OFFER. Stopped in grid slot 2 (`startGrid[1]`) in the driver's seat beside a waiting
 * rival, the player is offered the race on F (`prompt`): refused with "need 3 shells"
 * while the jar holds fewer than `RACE_STAKE`, and with "unhitch first" while his car tows
 * anything or is towed. F there is the race's, whatever the answer, until it is let go:
 * it never also gets him out of the car. Accepting takes the stake (race/stake.ts).
 *
 * THE START. A trailer race (a third of the rounds) first puts identical loaded trailers
 * on both cars, coupled in state, which the trailer field hitches as it materialises them.
 * The lights go red, red, red, green (`RaceSession`), and until the green the player's car
 * is held (`holdPlayer`: no throttle, full brake, whatever the pedals or his autopilot
 * ask) and the rival stands parked.
 *
 * THE RACE. The rival is driven here, by its own `Autopilot` on the track's `road`, in
 * the mode and pace of its level, and held live by the active-world reconcile whatever
 * its distance (`keepsLive`). Both cars' laps are `RaceSession`'s. The player forfeits
 * on the session's own terms (off the track area 10 s, 150 m away) and here: out of the
 * car, the car on its roof `FLIPPED_S`, or the car gone or its engine dead `WRECKED_S`.
 * The rival lost to the world (its body slept or removed) calls the race off and pays the
 * stake back: that was not the player's doing.
 *
 * THE RESULT. Won: `RACE_PRIZE` shells into the jar and "YOU WIN!"; lost: the stake is
 * gone, nothing more. Either way the track's round moves on (`raceRounds`), the player's
 * trailer is taken off, and the rival drives a slow cool-down lap to its slot and stops;
 * whenever it is out of view (and in any case once the player has gone) it is swapped for
 * the next round's rival.
 *
 * NO PER-STEP ALLOCATION while racing: every receiver is a field; the scans that do
 * allocate run twice a second, and never during a race.
 */

/** The track the player is at is looked for this often, seconds. */
const SCAN_S = 0.5;
/** A track's grid this close to the player is the track he is at, metres. */
const NEAR_M = 900;
/** Closer than this a rival is not put down where the camera sees its slot, metres. */
const SEEN_SPAWN_M = 250;
/** A stale rival is swapped only with the player at least this far from it, metres. */
const SWAP_CLEAR_M = 40;
/** Grid slot 2 is "in": this far along and across from its middle, metres; and stopped. */
const SLOT_ALONG_M = 4;
const SLOT_ACROSS_M = 2.2;
const SLOT_STILL_KMH = 2;
/** Something stands in slot 1 when it is this near its middle, metres. */
const SLOT_TAKEN_M = 3.5;
/** The player's car on its roof this long (up vector's y under `FLIPPED_UP`) forfeits, seconds. */
const FLIPPED_S = 3;
const FLIPPED_UP = 0.3;
/** The player's engine dead this long forfeits, seconds. */
const WRECKED_S = 10;
/** The cool-down: the sleeper driver at this share of its pace, given up after this long. */
const COOLDOWN_PACE = 0.6;
const COOLDOWN_MAX_S = 300;
/** The cool-down ends stopped this near the slot along the lap, metres. */
const COOLDOWN_PARKED_M = 6;
/** Seconds the result banner stays up, and the "GO!" after the green. */
const BANNER_S = 4;
const GO_S = 1.2;
/** A trailer race's load on each trailer: from this to this, kg, drawn per round. */
const TRAILER_LOAD_MIN_KG = 150;
const TRAILER_LOAD_MAX_KG = 350;
/** 'RTL1': the trailers' load draw. */
const TRAILER_LOAD_DOMAIN = 0x52544c31;
/** The trailer is set down just over its ride height, as a haul's (contracts/world.ts). */
const TRAILER_SETTLE_CLEARANCE_M = 0.085;

const PROMPT_RACE = '[F] RACE! 3 shells → win 6';
const PROMPT_POOR = 'RACE ME! — need 3 shells';
const PROMPT_HITCHED = 'RACE ME! — unhitch first';

/** What the director needs of the running game (main.ts). */
export interface RaceHost {
  /** The live `Vehicle` of car `id`, or null while it is only in state. */
  vehicle(id: string): Vehicle | null;
  /** A sphere at ABSOLUTE metres is in the camera's view. */
  inView(x: number, y: number, z: number, radius: number): boolean;
  /** Fixed ground somewhere under an ABSOLUTE point. */
  groundUnder(x: number, y: number, z: number): boolean;
  toast(text: string): void;
}

/** What the HUD shows of a race (ui/hudrace.ts); one object, rewritten in place. */
export interface RaceReadout {
  /** A race on (lights, laps) or a result up: the race panel is shown. */
  active: boolean;
  /** 0 none, 1-3 red, 4 green. */
  lights: number;
  /** "GO!" is up. */
  go: boolean;
  /** Racing: the lap the player is on, of `laps`, and his place. */
  racing: boolean;
  lap: number;
  laps: number;
  position: 1 | 2;
  /** The result banner, or null. */
  banner: string | null;
  /** The banner is the player's win. */
  won: boolean;
}

interface LiveRace {
  readonly track: RaceTrack;
  readonly plan: RivalPlan;
  readonly round: number;
  readonly playerCarId: string;
  readonly session: RaceSession;
  readonly autopilot: Autopilot;
  readonly trailer: boolean;
  flippedS: number;
  deadS: number;
}

/** What the rival is doing: waiting at its slot, racing, or driving its cool-down lap. */
type RivalState = 'waiting' | 'racing' | 'cooldown';

export class RaceDirector {
  /** The track the player is at, or null. */
  private track: RaceTrack | null = null;
  /** The rival in the world: its track, the round and plan it was drawn for. */
  private rival: { track: RaceTrack; plan: RivalPlan; round: number; playerClass: CarClass } | null = null;
  private rivalState: RivalState = 'waiting';
  private race: LiveRace | null = null;
  /** The cool-down lap: its driver, how long it has run, and the lap left to the slot (metres, with its arclength as the next hint). */
  private cooldown: { autopilot: Autopilot; seconds: number; s: number; toSlot: number } | null = null;
  private readonly rivalInput: InputFrame = emptyInput();
  private readonly visuals: RaceVisuals;
  private scanIn = 0;
  private booted = false;
  /** F belongs to the race until it is let go. */
  private swallowF = false;
  private prevInteract = false;
  private promptValue: string | null = null;
  /** The next rival may be put down where it is seen (dev `jumpToTrack`). */
  private seenSpawnOnce = false;
  private bannerS = 0;
  readonly readout: RaceReadout = { active: false, lights: 0, go: false, racing: false, lap: 1, laps: RACE_LAPS, position: 1, banner: null, won: false };
  private readonly position = { x: 0, y: 0, z: 0 };
  private readonly rivalPosition = { x: 0, y: 0, z: 0 };
  private readonly at: TrackProjection = { s: 0, lateral: 0, height: 0 };

  constructor(
    private readonly world: GameWorld,
    private readonly physics: PhysicsWorld,
    scene: THREE.Scene,
    private readonly origin: WorldOrigin,
    private readonly terrain: Terrain,
    private readonly host: RaceHost,
  ) {
    this.visuals = new RaceVisuals(scene);
  }

  /** The prompt the race puts up (the offer, or why not), or null. */
  get prompt(): string | null {
    return this.promptValue;
  }

  /** The rival car's id while one is in the world, else null. */
  get rivalId(): string | null {
    return this.rival ? raceRivalId(this.rival.track.postIndex) : null;
  }

  /** The director drives car `id` this step (the main loop must not settle it). */
  drives(id: string): boolean {
    if (id !== this.rivalId) return false;
    return (this.rivalState === 'racing' && this.race !== null && !this.race.session.held) || (this.rivalState === 'cooldown' && this.cooldown !== null);
  }

  /** Car `id` stays live whatever its distance: the rival of a race, or on its cool-down. */
  keepsLive(id: string): boolean {
    return id === this.rivalId && this.rivalState !== 'waiting';
  }

  /** Visits the rival while it is driven, for its engine to be heard. */
  forEachDriven(visit: (id: string, vehicle: Vehicle) => void): void {
    const id = this.rivalId;
    if (id === null || !this.drives(id)) return;
    const vehicle = this.host.vehicle(id);
    if (vehicle) visit(id, vehicle);
  }

  /**
   * Before the controllers of one fixed step: the scan, the offer and its F, and the
   * rival's own driving. `anchorX`/`anchorZ` is where the player is, ABSOLUTE, and `roadS`
   * its arclength. `f` is the step's input; F is taken out of it while it is the race's.
   */
  beforeStep(dt: number, f: InputFrame, anchorX: number, anchorZ: number, roadS: number): void {
    if (!this.booted) {
      this.booted = true;
      // A stake in a loaded save is a race the save cut off: paid back, once.
      const back = refundStake(this.world);
      if (back > 0) this.host.toast(`the race was called off — ${formatPay(back)} back`);
    }
    if (this.race === null) {
      this.scanIn -= dt;
      if (this.scanIn <= 0) {
        this.scanIn = SCAN_S;
        this.scan(anchorX, anchorZ, roadS);
      }
    }
    this.offer(f);
    this.driveRival(dt);
  }

  /**
   * Holds the player's car on the grid until the green: whatever the pedals or his own
   * autopilot asked, no throttle and the brake on. Called right before his car's step.
   */
  holdPlayer(f: InputFrame): void {
    const race = this.race;
    if (!race || !race.session.held) return;
    f.throttle = 0;
    f.brake = 1;
    f.reverse = false;
  }

  /** After the physics step: the laps, the forfeits, the result, and the cool-down's end. */
  afterStep(dt: number): void {
    if (this.bannerS > 0) {
      this.bannerS -= dt;
      if (this.bannerS <= 0) this.readout.banner = null;
    }
    const race = this.race;
    if (race) this.stepRace(dt, race);
    if (this.cooldown) this.stepCooldown(dt);
    this.updateReadout();
  }

  /** Per rendered frame: the lights and the board placed for the frame's origin. */
  syncVisuals(): void {
    this.visuals.setLights(this.race ? this.race.session.lights : 0);
    this.visuals.sync(this.origin.x, this.origin.z);
  }

  // -------------------------------------------------------------------------
  // The rival in the world.
  // -------------------------------------------------------------------------

  private scan(anchorX: number, anchorZ: number, roadS: number): void {
    const seed = this.world.seed;
    let best: RaceTrack | null = null;
    let bestD = NEAR_M;
    for (const post of postStopsBetween(seed, roadS - CHUNK_SPREAD_M - NEAR_M, roadS + CHUNK_SPREAD_M + NEAR_M)) {
      if (!postHasTrack(seed, post.index)) continue;
      const track = this.terrain.raceTracks.track(post.index);
      if (!track) continue;
      const slot = track.startGrid[0];
      const d = Math.hypot(slot.x - anchorX, slot.z - anchorZ);
      if (d < bestD) {
        bestD = d;
        best = track;
      }
    }
    this.track = best;
    const rival = this.rival;
    const solid = best !== null && this.host.groundUnder(best.startGrid[0].x, best.startGrid[0].y, best.startGrid[0].z);
    if (rival) {
      // Its track out of reach or its ground gone: out of the world at once, seen or not
      // (the world round it is going too).
      if (rival.track !== best || !solid) {
        this.removeRival();
        return;
      }
      if (this.rivalState !== 'waiting' && this.rivalState !== 'cooldown') return;
      // The round moved on, or the player came in another class of car: swapped unseen.
      const round = raceRound(this.world, rival.track.postIndex);
      const plan = rivalPlan(seed, rival.track.postIndex, round, this.playerClass());
      const stale = round !== rival.round || plan.modelId !== rival.plan.modelId;
      if (stale && !this.seenNear(rival.track.startGrid[0], anchorX, anchorZ, SWAP_CLEAR_M)) this.removeRival();
      return;
    }
    if (!best || !solid) return;
    const slot = best.startGrid[0];
    if (!this.seenSpawnOnce && this.seenNear(slot, anchorX, anchorZ, SEEN_SPAWN_M)) return;
    if (this.slotTaken(slot, anchorX, anchorZ)) return;
    this.seenSpawnOnce = false;
    this.spawnRival(best);
  }

  /** The slot is within `near` of the player, or in view within `SEEN_SPAWN_M`. */
  private seenNear(slot: TrackPose, anchorX: number, anchorZ: number, near: number): boolean {
    const d = Math.hypot(slot.x - anchorX, slot.z - anchorZ);
    return d < near || (d < SEEN_SPAWN_M && this.host.inView(slot.x, slot.y + 1, slot.z, 3));
  }

  /** Anything stands in slot 1: a car, or the player on foot. */
  private slotTaken(slot: TrackPose, anchorX: number, anchorZ: number): boolean {
    if (Math.hypot(slot.x - anchorX, slot.z - anchorZ) < SLOT_TAKEN_M) return true;
    for (const id in this.world.state.cars) {
      const live = this.host.vehicle(id);
      const at = live ? live.absoluteTranslation(this.position) : this.world.state.cars[id]!;
      if (Math.hypot(slot.x - at.x, slot.z - at.z) < SLOT_TAKEN_M) return true;
    }
    return false;
  }

  /** The class of the car the player is in, or last drove, or the starting car's. */
  private playerClass(): CarClass {
    const state = this.world.state;
    const id = state.player.drivingCarId ?? state.player.lastDrivenCarId;
    const car = id !== null ? state.cars[id] : undefined;
    return car ? carClassOf(car) : carClassOf({ modelId: DEFAULT_CAR_MODEL_ID, bonnet: [] });
  }

  private spawnRival(track: RaceTrack): void {
    const postIndex = track.postIndex;
    const round = raceRound(this.world, postIndex);
    const playerClass = this.playerClass();
    const plan = rivalPlan(this.world.seed, postIndex, round, playerClass);
    const id = raceRivalId(postIndex);
    if (!this.world.state.cars[id]) this.world.apply({ t: 'car_add', car: this.standingCar(id, plan.modelId, track, track.startGrid[0]) });
    this.rival = { track, plan, round, playerClass };
    this.rivalState = 'waiting';
    this.visuals.show(track, plan);
  }

  /** A car of `modelId` standing on its wheels at grid pose `slot`, as a haul's car is stood (contracts/world.ts). */
  private standingCar(id: string, modelId: string, track: RaceTrack, slot: TrackPose): CarState {
    const measure = carModelMeasure(carModel(modelId).id);
    const at = this.at;
    const plane = poseOnGround(measure.wheels, slot.x, slot.z, slot.heading, (gx, gz) => {
      track.project(gx, gz, slot.s, at);
      return track.surfaceY(at.s, at.lateral) + TRACK_LIFT_M;
    });
    const groundY = plane ? plane.groundY : slot.y + TRACK_LIFT_M;
    const car = createServiceableCarState(id, modelId, slot.x, carSpawnYAboveGround(measure, groundY), slot.z, slot.heading);
    if (plane) {
      car.qx = plane.qx;
      car.qy = plane.qy;
      car.qz = plane.qz;
      car.qw = plane.qw;
    }
    return car;
  }

  private removeRival(): void {
    const rival = this.rival;
    if (!rival) return;
    const postIndex = rival.track.postIndex;
    for (const who of ['rival', 'player'] as const) {
      const trailerId = raceTrailerId(postIndex, who);
      if (this.world.state.trailers[trailerId]) this.world.apply({ t: 'trailer_remove', trailerId });
    }
    const id = raceRivalId(postIndex);
    if (this.world.state.cars[id]) this.world.apply({ t: 'car_remove', carId: id });
    this.rival = null;
    this.rivalState = 'waiting';
    this.cooldown?.autopilot.setEngaged(false);
    this.cooldown = null;
    this.visuals.show(null, null);
  }

  // -------------------------------------------------------------------------
  // The offer.
  // -------------------------------------------------------------------------

  private offer(f: InputFrame): void {
    const pressed = f.interact && !this.prevInteract;
    this.prevInteract = f.interact;
    if (this.swallowF) {
      if (f.interact || f.interactDown) {
        f.interact = false;
        f.interactDown = false;
      } else {
        this.swallowF = false;
      }
    }
    this.promptValue = null;
    const rival = this.rival;
    const state = this.world.state;
    const carId = state.player.drivingCarId;
    if (!rival || this.rivalState !== 'waiting' || this.race !== null || carId === null || state.player.seat !== 'driver') return;
    const vehicle = this.host.vehicle(carId);
    const rivalVehicle = this.host.vehicle(raceRivalId(rival.track.postIndex));
    if (!vehicle || !rivalVehicle || vehicle.speedKmh > SLOT_STILL_KMH) return;
    const track = rival.track;
    const slot = track.startGrid[1];
    vehicle.absoluteTranslation(this.position);
    const at = track.project(this.position.x, this.position.z, slot.s, this.at);
    let along = at.s - slot.s;
    if (along > track.lengthM / 2) along -= track.lengthM;
    if (along < -track.lengthM / 2) along += track.lengthM;
    if (Math.abs(along) > SLOT_ALONG_M || Math.abs(at.lateral - slot.lateral) > SLOT_ACROSS_M) return;
    const coupled = this.coupled(carId);
    this.promptValue = !canStake(this.world) ? PROMPT_POOR : coupled ? PROMPT_HITCHED : PROMPT_RACE;
    if (!pressed) return;
    // F at the grid is the race's, whatever the answer: never also out of the car.
    f.interact = false;
    f.interactDown = false;
    this.swallowF = true;
    if (this.promptValue !== PROMPT_RACE) {
      this.host.toast(this.promptValue === PROMPT_POOR ? `the race costs ${formatPay(RACE_STAKE)} — the jar is short` : 'unhitch first: the race is car against car');
      return;
    }
    if (!takeStake(this.world, track.postIndex, rival.round)) return;
    // The cars were live a moment ago; should either not be, the stake goes straight back.
    if (!this.startRace(carId)) refundStake(this.world);
  }

  /** Car `carId` tows a trailer or a car, or is on somebody's bar. */
  private coupled(carId: string): boolean {
    const state = this.world.state;
    if ((state.cars[carId]?.towedBy ?? null) !== null) return true;
    for (const id in state.trailers) if (state.trailers[id]!.hitchedTo === carId) return true;
    for (const id in state.cars) if (state.cars[id]!.towedBy === carId) return true;
    return false;
  }

  // -------------------------------------------------------------------------
  // The race.
  // -------------------------------------------------------------------------

  /** Starts the race against the waiting rival with the player in `playerCarId`; the stake is the caller's. */
  private startRace(playerCarId: string): boolean {
    const rival = this.rival;
    if (!rival || this.race) return false;
    const track = rival.track;
    const rivalId = raceRivalId(track.postIndex);
    const rivalVehicle = this.host.vehicle(rivalId);
    const playerVehicle = this.host.vehicle(playerCarId);
    if (!rivalVehicle || !playerVehicle) return false;
    const autopilot = new Autopilot(track.road, this.physics);
    autopilot.setMode(RIVAL_MODES[rival.plan.level]);
    const session = new RaceSession(track);
    playerVehicle.absoluteTranslation(this.position);
    rivalVehicle.absoluteTranslation(this.rivalPosition);
    session.start(this.position.x, this.position.z, this.rivalPosition.x, this.rivalPosition.z);
    if (rival.plan.trailer) {
      const kg = TRAILER_LOAD_MIN_KG + (TRAILER_LOAD_MAX_KG - TRAILER_LOAD_MIN_KG) * hash01(this.world.seed, TRAILER_LOAD_DOMAIN, track.postIndex, rival.round);
      this.hitchTrailer(raceTrailerId(track.postIndex, 'rival'), rivalId, this.rivalPosition, Math.min(kg, TRAILER_CAPACITY_KG));
      this.hitchTrailer(raceTrailerId(track.postIndex, 'player'), playerCarId, this.position, Math.min(kg, TRAILER_CAPACITY_KG));
    }
    this.race = { track, plan: rival.plan, round: rival.round, playerCarId, session, autopilot, trailer: rival.plan.trailer, flippedS: 0, deadS: 0 };
    this.rivalState = 'racing';
    this.cooldown?.autopilot.setEngaged(false);
    this.cooldown = null;
    this.readout.banner = null;
    this.bannerS = 0;
    return true;
  }

  /**
   * A loaded trailer coupled to car `carId` in state: the trailer field materialises it
   * with the car and puts it on the ball (vehicle/trailer.ts `restoreHitch`), which
   * stands it behind the car first. The crate is the load: `cargoKg` on the bed, against
   * the headboard as a haul's.
   */
  private hitchTrailer(id: string, carId: string, at: { x: number; y: number; z: number }, cargoKg: number): void {
    if (this.world.state.trailers[id]) this.world.apply({ t: 'trailer_remove', trailerId: id });
    const trailer: TrailerState = {
      id,
      hitchedTo: carId,
      cargoKg,
      cargoZ: 1,
      x: at.x,
      y: at.y + TRAILER_SPAWN_HEIGHT + TRAILER_SETTLE_CLEARANCE_M,
      z: at.z,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
    };
    this.world.apply({ t: 'trailer_add', trailer });
  }

  private driveRival(dt: number): void {
    const id = this.rivalId;
    if (id === null || !this.drives(id)) return;
    const vehicle = this.host.vehicle(id);
    if (!vehicle) return;
    const autopilot = this.rivalState === 'racing' ? this.race!.autopilot : this.cooldown!.autopilot;
    if (!autopilot.engaged) autopilot.setEngaged(true);
    if (this.cooldown && autopilot === this.cooldown.autopilot) autopilot.setHoldDistance(this.cooldown.toSlot);
    autopilot.drive(dt, vehicle, this.rivalInput, this.origin.x, this.origin.z);
    vehicle.fixedUpdate(dt, this.rivalInput);
  }

  private stepRace(dt: number, race: LiveRace): void {
    const state = this.world.state;
    const rivalVehicle = this.host.vehicle(raceRivalId(race.track.postIndex));
    if (!rivalVehicle) {
      this.callOff();
      return;
    }
    const playerVehicle = this.host.vehicle(race.playerCarId);
    const session = race.session;
    if (playerVehicle) playerVehicle.absoluteTranslation(this.position);
    rivalVehicle.absoluteTranslation(this.rivalPosition);
    if (session.step(dt, this.position.x, this.position.z, this.rivalPosition.x, this.rivalPosition.z)) {
      this.finish(race);
      return;
    }
    if (session.held) return;
    // The player's own forfeits.
    let end: RaceEnd | null = null;
    if (state.player.drivingCarId !== race.playerCarId) end = 'left-car';
    else if (!playerVehicle || !state.cars[race.playerCarId]) end = 'wrecked';
    else {
      // The drawn pose's quaternion: the body's own `rotation()` is a fresh object a call.
      const q = playerVehicle.root.quaternion;
      const up = 1 - 2 * (q.x * q.x + q.z * q.z);
      race.flippedS = up < FLIPPED_UP ? race.flippedS + dt : 0;
      race.deadS = playerVehicle.engineRunning ? 0 : race.deadS + dt;
      if (race.flippedS > FLIPPED_S) end = 'flipped';
      else if (race.deadS > WRECKED_S) end = 'wrecked';
    }
    if (end !== null && session.decide('rival', end)) this.finish(race);
  }

  /** The race decided (`session.winner`): the stake settled, the round on, the cars freed. */
  private finish(race: LiveRace): void {
    const won = race.session.winner === 'player';
    settleStake(this.world, won);
    advanceRound(this.world, race.track.postIndex, race.round);
    this.endRace(race);
    this.showBanner(won ? 'YOU WIN!' : 'RIVAL WINS', won);
    const why: Record<RaceEnd, string> = {
      laps: won ? `you win — ${formatPay(RACE_PRIZE)}` : 'the rival was first — the stake is his',
      'off-track': 'too long off the track — race lost',
      away: 'you left the track — race lost',
      'left-car': 'you got out — race lost',
      flipped: 'on the roof — race lost',
      wrecked: 'the car is done — race lost',
      dev: won ? 'race won (dev)' : 'race lost (dev)',
    };
    this.host.toast(why[race.session.end ?? 'laps']);
  }

  /** The race called off undecided (the rival lost to the world): the stake back, the round as it was. */
  private callOff(): void {
    const race = this.race;
    if (!race) return;
    race.session.decide('rival', 'dev');
    const back = refundStake(this.world);
    this.endRace(race);
    this.showBanner('RACE OFF', false);
    this.host.toast(back > 0 ? `race off — ${formatPay(back)} back` : 'race off');
  }

  /** The race's leftovers: the player's trailer off, the rival on its cool-down. */
  private endRace(race: LiveRace): void {
    const trailerId = raceTrailerId(race.track.postIndex, 'player');
    if (this.world.state.trailers[trailerId]) this.world.apply({ t: 'trailer_remove', trailerId });
    race.autopilot.setEngaged(false);
    this.race = null;
    if (!this.rival) return;
    const autopilot = new Autopilot(race.track.road, this.physics);
    autopilot.setMode('sleeper');
    autopilot.setPace(COOLDOWN_PACE);
    const s = race.session.rival.s;
    this.cooldown = { autopilot, seconds: 0, s, toSlot: race.track.wrap(race.track.startGrid[0].s - s) };
    this.rivalState = 'cooldown';
  }

  private stepCooldown(dt: number): void {
    const cooldown = this.cooldown!;
    cooldown.seconds += dt;
    const rival = this.rival;
    const vehicle = rival ? this.host.vehicle(raceRivalId(rival.track.postIndex)) : null;
    if (!rival || !vehicle) {
      cooldown.autopilot.setEngaged(false);
      this.cooldown = null;
      if (rival) this.rivalState = 'waiting';
      return;
    }
    vehicle.absoluteTranslation(this.rivalPosition);
    const track = rival.track;
    const s = track.project(this.rivalPosition.x, this.rivalPosition.z, cooldown.s, this.at).s;
    cooldown.s = s;
    cooldown.toSlot = track.wrap(track.startGrid[0].s - s);
    const toSlot = cooldown.toSlot;
    const parked = (toSlot < COOLDOWN_PARKED_M || toSlot > track.lengthM - COOLDOWN_PARKED_M) && vehicle.speedKmh < 1;
    if (parked || cooldown.seconds > COOLDOWN_MAX_S) {
      cooldown.autopilot.setEngaged(false);
      this.cooldown = null;
      // Parked (or given up): waiting again, stale until the scan swaps it unseen.
      this.rivalState = 'waiting';
    }
  }

  private showBanner(text: string, won: boolean): void {
    this.readout.banner = text;
    this.readout.won = won;
    this.bannerS = BANNER_S;
  }

  private updateReadout(): void {
    const r = this.readout;
    const race = this.race;
    if (!race) {
      r.lights = 0;
      r.go = false;
      r.racing = false;
      r.active = r.banner !== null;
      return;
    }
    const session = race.session;
    r.active = true;
    r.lights = session.lights;
    r.go = session.phase === 'racing' && session.raceTime < GO_S;
    r.racing = session.phase === 'racing';
    r.lap = session.playerLap;
    r.laps = RACE_LAPS;
    r.position = session.playerPosition;
  }

  // -------------------------------------------------------------------------
  // Dev (app/devtools.ts `__bro.race`).
  // -------------------------------------------------------------------------

  /** The next rival may be put down in view (the dev jump lands beside its slot). */
  devAllowSeenSpawn(): void {
    this.seenSpawnOnce = true;
    this.scanIn = 0;
  }

  /** Starts a race against the waiting rival from wherever the player's car is, with no stake. */
  devStart(): string {
    const carId = this.world.state.player.drivingCarId;
    if (this.race) return 'a race is on already';
    if (!this.rival || this.rivalState !== 'waiting') return 'no rival waiting near by';
    if (carId === null) return 'get in a car first';
    return this.startRace(carId) ? `racing ${this.rival.plan.modelId} (${this.rival.plan.level}${this.rival.plan.trailer ? ', trailers' : ''})` : 'the cars are not live yet';
  }

  /** Decides the race on now for `winner`. */
  devFinish(winner: Racer): string {
    const race = this.race;
    if (!race) return 'no race on';
    if (race.session.decide(winner, 'dev')) this.finish(race);
    return `${winner} wins`;
  }

  devState(): Record<string, unknown> {
    const race = this.race;
    const rival = this.rival;
    return {
      track: this.track?.id ?? null,
      rival: rival ? { id: raceRivalId(rival.track.postIndex), ...rival.plan, round: rival.round, state: this.rivalState } : null,
      stake: this.world.state.raceStake,
      race: race
        ? {
            phase: race.session.phase,
            lights: race.session.lights,
            time: race.session.raceTime,
            player: { lap: race.session.player.lap, checkpoint: race.session.player.next, s: race.session.player.s, offTrackS: race.session.player.offTrackS },
            rival: { lap: race.session.rival.lap, checkpoint: race.session.rival.next, s: race.session.rival.s },
            position: race.session.playerPosition,
            playerLaps: [...race.session.playerLaps],
            rivalLaps: [...race.session.rivalLaps],
          }
        : null,
    };
  }

  dispose(): void {
    this.race?.autopilot.setEngaged(false);
    this.cooldown?.autopilot.setEngaged(false);
    this.visuals.dispose();
  }
}
