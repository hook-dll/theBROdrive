import type * as THREE from 'three';
import { emptyInput, type InputFrame } from '../core/input';
import { FIXED_DT, type PhysicsWorld } from '../core/physics';
import { hash01 } from '../core/rng';
import { formatPay } from '../economy/economy';
import { createServiceableCarState, poseOnGround, type GroundPose } from '../game/spawn';
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
import { raceRivalId, raceTrailerId, type RaceTrailerOwner } from './ids';
import { FLIPPED_UP, recoverAt, RecoveryWatch } from './recovery';
import { carClassOf, fieldPlan, FIELD_SIZE, type CarClass, type FieldPlan, type RivalDriver } from './rival';
import { RACE_LAPS, RaceSession, type RaceEnd } from './session';
import { advanceRound, canStake, raceRound, racePrize, RACE_PRIZES, RACE_STAKE, refundStake, settleStake, takeStake } from './stake';
import { RaceVisuals } from './visuals';

/**
 * THE RACES AT THE TRACKS: the field that waits at a track's grid, the offer, the start,
 * the laps, the results and the prize, run in the live world.
 *
 * WHERE. Every `SCAN_S` (never while a race is on) the director looks for the race track
 * (world/racetrack/) nearest the player whose grid is within `NEAR_M`. Its field exists
 * only while that track's colliders do — the grid has fixed ground under it, which is the
 * owner chunk in the physics band — and is taken out of the world the moment they go.
 *
 * THE FIELD is `FIELD_SIZE` rival cars in world state (`raceRivalId`), standing in grid
 * boxes 0.. (pole first, the quickest driver on it; race/rival.ts `fieldPlan`) with the
 * "RACE ME!" board beside the player's box, `PLAYER_SLOT`, the last of the grid. They are
 * streamed, drawn, collided and saved like every other car, LOCKED like a handed-in haul
 * (contracts/world.ts `haulLoadLock`). A field is drawn for the track's round and the car
 * the player is in, its cars put down ONE PER SCAN (a car materialising is a body and a
 * mesh; four at once is a hitch), each only where its box is not seen up close, and the
 * whole field swapped, unseen, when the round moves on or the player comes in another car.
 *
 * THE OFFER. Stopped in the player's box in the driver's seat with the whole field live,
 * the player is offered the race on F (`prompt`): refused with "need 3 shells" while the
 * jar holds fewer than `RACE_STAKE`, and with "unhitch first" while his car tows anything
 * or is towed. F there is the race's, whatever the answer, until it is let go: it never
 * also gets him out of the car. Accepting takes the stake (race/stake.ts).
 *
 * THE START. A trailer race (a third of the rounds) first puts identical loaded trailers
 * on every car, coupled in state, which the trailer field hitches as it materialises them.
 * Every car of the race is put in the RACERS collision group (`RACER_GROUPS`). The lights
 * go red, red, red, green (`RaceSession`), and until the green the player's car is held
 * (`holdPlayer`: no throttle, full brake, whatever the pedals or his autopilot ask) and
 * the field stands parked.
 *
 * THE RACE. Each rival is driven here, by its own `Autopilot` on the track's `road`: the
 * frantic racer, at its own skill's grip share and pace (race/rival.ts), held live by
 * the active-world reconcile whatever its distance (`keepsLive`). Every car's laps are
 * `RaceSession`'s. A rival KNOCKED OFF OR STUCK (race/recovery.ts: off the track area,
 * on its roof, or no progress for a few seconds) is put back on the lap's centre
 * (`recoverAt`: where it was, never past a checkpoint it has not taken) the moment
 * neither it nor that spot is in the player's view, or after `RECOVER_WAIT_S`
 * whatever the view, and is a GHOST for `GHOST_S` (it collides with the ground and the
 * world, not with the other racers: `GHOST_GROUPS`) and for as long after as another
 * racer is within `GHOST_CLEAR_M`, so it never lands in somebody. That is what makes a
 * rival hard to get rid of by shoving: it is back on the lap a few seconds later.
 *
 * THE PLAYER'S KEYS (CONTROLS.md). `raceReturn` (T, the pad's right stick press) puts his
 * car back on the lap's centre at his last checkpoint (the line, or his grid box before
 * the first crossing), as a ghost, standing still. `raceRestart` (Backspace) puts the
 * whole field and him back on the grid and starts the lights again: the stake already
 * out stays out, nothing is paid twice. He is OUT on the session's own terms (off the
 * track area 20 s, 150 m away) and here: out of the car, on its roof `FLIPPED_S`, or the
 * car gone or its engine dead `WRECKED_S`.
 *
 * THE RESULTS. The moment the player has taken the flag (or is out), the race is over:
 * no waiting for the field. The stake is settled for his place (race/stake.ts
 * `RACE_PRIZES`: 1st 9, 2nd 5, 3rd 3, out of the prizes nothing), the track's round moves
 * on, the trailers come off, and the results panel (ui/hudrace.ts) shows the order, the
 * times and the prize: a rival still running is placed where it is (laps, then distance)
 * and its time is its projection (`RaceSession.projectedTime`), shown "~1:52.3". While
 * the panel is up, Backspace or F races the SAME field again for a new stake (a rematch:
 * everybody back on the grid); driving `RESULTS_AWAY_M` from the grid closes it. Every
 * rival, finished or not, drives a slow cool-down lap to its box and stops; one out of
 * the player's view is simply stood back in its box.
 *
 * WHAT A RACE COSTS A FRAME (measured in the game with a per-section profile; numbers in
 * the CHANGELOG): every rival is a whole car simulated each fixed step, its driver and
 * its vehicle step, and drawn, and a trailer race adds a trailer per car. On a slower CPU
 * that extra work per step pushes the frame past its budget, and the fixed-step loop then
 * runs several steps a frame (core/loop.ts), which multiplies every per-step cost, the
 * road's traffic the largest of them. So, while a race is on, the road's traffic is
 * thinned to `RACE_TRAFFIC_CAP` cars (the race is off the road), and the rivals are drawn
 * as traffic is (`drawsAsTraffic`): mid and far meshes by distance, their shadows cast by
 * the shared far mesh rather than by ~11 meshes each.
 *
 * A rival lost to the world mid-race (its body slept or removed) calls the race off and
 * pays the stake back: that was not the player's doing.
 *
 * NO PER-STEP ALLOCATION while racing: every receiver is a field; the scans that do
 * allocate run twice a second and never during a race, and the results are built once.
 */

/** The track the player is at is looked for this often, seconds. */
const SCAN_S = 0.5;
/** A track's grid this close to the player is the track he is at, metres. */
const NEAR_M = 900;
/** Closer than this a rival is not put down where the camera sees its box, metres. */
const SEEN_SPAWN_M = 250;
/** A stale field is swapped only with the player at least this far from its grid, metres. */
const SWAP_CLEAR_M = 40;
/** The player's grid box: the last, behind the field. */
export const PLAYER_SLOT = FIELD_SIZE;
/** The player's box is "in": this far along and across from its middle, metres; and stopped. */
const SLOT_ALONG_M = 4;
const SLOT_ACROSS_M = 2.2;
const SLOT_STILL_KMH = 2;
/** Something stands in a box when it is this near its middle, metres. */
const SLOT_TAKEN_M = 3.5;
/** The player's car on its roof this long (up vector's y under `FLIPPED_UP`) puts him out, seconds. */
const FLIPPED_S = 10;
/** The player's engine dead this long puts him out, seconds. */
const WRECKED_S = 10;
/** A due recovery waits this long for the car and its spot to be out of view, seconds. */
const RECOVER_WAIT_S = 3;
/** A put-back car is a ghost this long, and longer while another racer is within `GHOST_CLEAR_M`; never past `GHOST_MAX_S`. */
const GHOST_S = 3;
const GHOST_CLEAR_M = 5;
const GHOST_MAX_S = 10;
/**
 * Collision groups (Rapier: membership << 16 | filter). A race's cars are members of
 * bit 2 only and collide with everything; a ghost is a member of bit 2 that does not
 * filter bit 2, so it meets the ground and the world but no racer. Everything else in
 * the game keeps the default, every bit.
 */
const RACER_BIT = 0x0004;
const RACER_GROUPS = (RACER_BIT << 16) | 0xffff;
const GHOST_GROUPS = (RACER_BIT << 16) | (0xffff & ~RACER_BIT);
const DEFAULT_GROUPS = 0xffffffff;
/** The cool-down: the sleeper driver at this share of its pace, given up after this long. */
const COOLDOWN_PACE = 0.6;
const COOLDOWN_MAX_S = 240;
/** The cool-down ends stopped this near its box along the lap, metres. */
const COOLDOWN_PARKED_M = 6;
/** Seconds the "GO!" stays up after the green. */
const GO_S = 1.2;
/** The results close with the player this far from the grid, metres. */
const RESULTS_AWAY_M = 300;
/** A trailer race's load on each trailer: from this to this, kg, drawn per round. */
const TRAILER_LOAD_MIN_KG = 150;
const TRAILER_LOAD_MAX_KG = 350;
/** 'RTL1': the trailers' load draw. */
const TRAILER_LOAD_DOMAIN = 0x52544c31;
/** The trailer is set down just over its ride height, as a haul's (contracts/world.ts). */
const TRAILER_SETTLE_CLEARANCE_M = 0.085;
/**
 * The road's traffic ceiling while a race is on (world/traffic.ts `raceCeiling`): the
 * lowest traffic setting's. See WHAT A RACE COSTS A FRAME.
 */
const RACE_TRAFFIC_CAP = 6;

const PROMPT_RACE = `[F] RACE! ${RACE_STAKE} shells → win ${RACE_PRIZES[0]}`;
const PROMPT_POOR = `RACE ME! — need ${RACE_STAKE} shells`;
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
  /** The key bound to input action `id`, as the menu writes it (core/input.ts `formatKey`). */
  keyLabel(id: string): string;
}

/** One line of the results. */
export interface RaceResultRow {
  readonly place: number;
  readonly name: string;
  /** Race time, or "+1 LAP", "—" (still running when it closed), "OUT". */
  readonly time: string;
  readonly best: string;
  readonly player: boolean;
}

/** The results panel (ui/hudrace.ts): built once when a race is over. */
export interface RaceResults {
  readonly headline: string;
  readonly won: boolean;
  readonly rows: readonly RaceResultRow[];
  /** "+9 shells", "no prize", "stake back"… */
  readonly prize: string;
  /** What the keys do now. */
  readonly hint: string;
}

/** What the HUD shows of a race (ui/hudrace.ts); one object, rewritten in place. */
export interface RaceReadout {
  /** A race on (lights, laps) or its results up: the race panel is shown. */
  active: boolean;
  /** 0 none, 1-3 red, 4 green. */
  lights: number;
  /** "GO!" is up. */
  go: boolean;
  /** Racing: the lap the player is on, of `laps`, and his place of `racers`. */
  racing: boolean;
  lap: number;
  laps: number;
  position: number;
  racers: number;
  /** The keys line under the chip ("[⌫] restart  [T] back to track"). */
  keys: string;
  /** Called out while it applies: the player off the track or on his roof. */
  hint: string | null;
  /** The results, or null. */
  results: RaceResults | null;
}

/** What a rival of the field is doing. */
type RivalState = 'waiting' | 'racing' | 'cooldown';

/** One rival of the live field. */
interface FieldCar {
  readonly id: string;
  readonly index: number;
  readonly driver: RivalDriver;
  /** Its racing driver, and its cool-down one. */
  readonly autopilot: Autopilot;
  readonly cooldown: Autopilot;
  readonly input: InputFrame;
  state: RivalState;
  /** Put down in the world yet. */
  spawned: boolean;
  readonly watch: RecoveryWatch;
  /** Seconds a due recovery has waited for the view. */
  dueS: number;
  /** Seconds of ghost left (> 0) and spent; 0 when solid. */
  ghostS: number;
  ghostFor: number;
  cooldownS: number;
  cooldownAt: number;
  toSlot: number;
}

/** The field waiting at (or racing round) a track. */
interface Field {
  readonly track: RaceTrack;
  readonly plan: FieldPlan;
  readonly round: number;
  readonly playerClass: CarClass;
  readonly cars: readonly FieldCar[];
}

interface LiveRace {
  readonly playerCarId: string;
  readonly session: RaceSession;
  readonly trailer: boolean;
  /** The trailers' load, kg, for a re-hitch. */
  readonly trailerKg: number;
  flippedS: number;
  deadS: number;
  playerGhostS: number;
  playerGhostFor: number;
}

export class RaceDirector {
  /** The track the player is at, or null. */
  private track: RaceTrack | null = null;
  private field: Field | null = null;
  private race: LiveRace | null = null;
  private readonly visuals: RaceVisuals;
  private scanIn = 0;
  private booted = false;
  /** F belongs to the race until it is let go. */
  private swallowF = false;
  private prevInteract = false;
  private promptValue: string | null = null;
  /** The next field may be put down where it is seen (dev `jumpToTrack`). */
  private seenSpawnOnce = false;
  /** The dev tools drive the player's car round the lap (`devAutoDrive`). */
  private devPilot: Autopilot | null = null;
  readonly readout: RaceReadout = {
    active: false,
    lights: 0,
    go: false,
    racing: false,
    lap: 1,
    laps: RACE_LAPS,
    position: 1,
    racers: FIELD_SIZE + 1,
    keys: '',
    hint: null,
    results: null,
  };
  private readonly position = { x: 0, y: 0, z: 0 };
  private readonly other = { x: 0, y: 0, z: 0 };
  private readonly point = { x: 0, y: 0, z: 0 };
  private readonly at: TrackProjection = { s: 0, lateral: 0, height: 0 };
  private readonly recovery = { s: 0, lateral: 0 };
  private readonly xs = new Float64Array(FIELD_SIZE + 1);
  private readonly zs = new Float64Array(FIELD_SIZE + 1);

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

  /** The field car `id` is, or null. */
  private fieldCar(id: string): FieldCar | null {
    const field = this.field;
    if (!field) return null;
    for (const car of field.cars) if (car.id === id) return car;
    return null;
  }

  /** The director drives car `id` this step (the main loop must not settle it). */
  drives(id: string): boolean {
    const car = this.fieldCar(id);
    if (!car) return false;
    return (car.state === 'racing' && this.race !== null && !this.race.session.held) || car.state === 'cooldown';
  }

  /**
   * Car `id` stays live whatever its distance: a rival racing, on its cool-down, or
   * anywhere in the field while the results are up (the rematch needs every car).
   */
  keepsLive(id: string): boolean {
    const car = this.fieldCar(id);
    return car !== null && (car.state !== 'waiting' || this.readout.results !== null);
  }

  /**
   * The road traffic's ceiling (world/traffic.ts `raceCeiling`): `RACE_TRAFFIC_CAP` while
   * a race is on, null (the menu's) otherwise. main.ts hands it to the stream every step.
   */
  get trafficCeiling(): number | null {
    return this.race ? RACE_TRAFFIC_CAP : null;
  }

  /**
   * Car `id` is a rival of the field standing on its wheels: drawn as traffic is (main.ts
   * passes it the far, mid and shadow fields, render/farcars.ts), its own ~40 casting
   * meshes replaced by the shared far mesh outside the self-shadow line. One on its side
   * or roof is drawn in full, as a traffic wreck is.
   */
  drawsAsTraffic(id: string, vehicle: Vehicle): boolean {
    if (this.fieldCar(id) === null) return false;
    const q = vehicle.root.quaternion;
    return 1 - 2 * (q.x * q.x + q.z * q.z) >= FLIPPED_UP;
  }

  /** Visits every rival while it is driven, for its engine to be heard. */
  forEachDriven(visit: (id: string, vehicle: Vehicle) => void): void {
    const field = this.field;
    if (!field) return;
    for (const car of field.cars) {
      if (!this.drives(car.id)) continue;
      const vehicle = this.host.vehicle(car.id);
      if (vehicle) visit(car.id, vehicle);
    }
  }

  /**
   * Before the controllers of one fixed step: the scan, the offer and its F, the race
   * keys, and the rivals' own driving. `anchorX`/`anchorZ` is where the player is,
   * ABSOLUTE, and `roadS` its arclength. `f` is the step's input; F is taken out of it
   * while it is the race's.
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
    this.keys(f);
    this.driveRivals(dt);
  }

  /**
   * Holds the player's car on the grid until the green: whatever the pedals or his own
   * autopilot asked, no throttle and the brake on. Called right before his car's step.
   * With the dev drive on (`devAutoDrive`) the race's own racer drives it after the green.
   */
  holdPlayer(f: InputFrame): void {
    const race = this.race;
    if (!race) return;
    if (race.session.held) {
      f.throttle = 0;
      f.brake = 1;
      f.reverse = false;
      return;
    }
    const pilot = this.devPilot;
    const vehicle = pilot ? this.host.vehicle(race.playerCarId) : null;
    if (!pilot || !vehicle || race.session.playerDone) return;
    if (!pilot.engaged) pilot.setEngaged(true);
    pilot.drive(FIXED_DT, vehicle, f, this.origin.x, this.origin.z);
  }

  /** After the physics step: the laps, the recoveries, the results, and the cool-downs. */
  afterStep(dt: number): void {
    const race = this.race;
    if (race) this.stepRace(dt, race);
    this.stepCooldowns(dt);
    this.stepResults();
    this.updateReadout();
  }

  /** Per rendered frame: the lights and the board placed for the frame's origin. */
  syncVisuals(): void {
    this.visuals.setLights(this.race ? this.race.session.lights : 0);
    this.visuals.sync(this.origin.x, this.origin.z);
  }

  // -------------------------------------------------------------------------
  // The field in the world.
  // -------------------------------------------------------------------------

  private scan(anchorX: number, anchorZ: number, roadS: number): void {
    const seed = this.world.seed;
    let best: RaceTrack | null = null;
    let bestD = NEAR_M;
    for (const post of postStopsBetween(seed, roadS - CHUNK_SPREAD_M - NEAR_M, roadS + CHUNK_SPREAD_M + NEAR_M)) {
      if (!postHasTrack(seed, post.index)) continue;
      const track = this.terrain.raceTracks.track(post.index);
      if (!track) continue;
      const slot = track.startGrid[0]!;
      const d = Math.hypot(slot.x - anchorX, slot.z - anchorZ);
      if (d < bestD) {
        bestD = d;
        best = track;
      }
    }
    this.track = best;
    const pole = best?.startGrid[0];
    const solid = best !== null && pole !== undefined && this.host.groundUnder(pole.x, pole.y, pole.z);
    const field = this.field;
    if (field) {
      // Its track out of reach or its ground gone: out of the world at once, seen or not
      // (the world round it is going too).
      if (field.track !== best || !solid) {
        this.removeField();
        return;
      }
      if (field.cars.some((car) => car.state !== 'waiting') || this.readout.results !== null) return;
      // The round moved on, or the player came in another class of car: swapped unseen.
      const round = raceRound(this.world, field.track.postIndex);
      const playerClass = this.playerClass();
      const stale = round !== field.round || playerClass.powerKw !== field.playerClass.powerKw || playerClass.massKg !== field.playerClass.massKg;
      if (stale && !this.seenNear(field.track.startGrid[PLAYER_SLOT]!, anchorX, anchorZ, SWAP_CLEAR_M)) {
        this.removeField();
        return;
      }
      this.spawnNext(field, anchorX, anchorZ);
      return;
    }
    if (!best || !solid) return;
    this.field = this.makeField(best);
    this.visuals.show(best, this.field.plan, best.startGrid[PLAYER_SLOT]!);
    this.spawnNext(this.field, anchorX, anchorZ);
  }

  private makeField(track: RaceTrack): Field {
    const postIndex = track.postIndex;
    const round = raceRound(this.world, postIndex);
    const playerClass = this.playerClass();
    const plan = fieldPlan(this.world.seed, postIndex, round, playerClass);
    const cars = plan.rivals.map((driver, index): FieldCar => {
      const autopilot = new Autopilot(track.road, this.physics);
      autopilot.setMode('frantic');
      autopilot.setGripShare(driver.gripShare);
      autopilot.setPace(driver.pace);
      const cooldown = new Autopilot(track.road, this.physics);
      cooldown.setMode('sleeper');
      cooldown.setPace(COOLDOWN_PACE);
      return {
        id: raceRivalId(postIndex, index),
        index,
        driver,
        autopilot,
        cooldown,
        input: emptyInput(),
        state: 'waiting',
        spawned: this.world.state.cars[raceRivalId(postIndex, index)] !== undefined,
        watch: new RecoveryWatch(),
        dueS: 0,
        ghostS: 0,
        ghostFor: 0,
        cooldownS: 0,
        cooldownAt: 0,
        toSlot: 0,
      };
    });
    return { track, plan, round, playerClass, cars };
  }

  /** The next car of the field not yet in the world, put down in its box when unseen. One per scan. */
  private spawnNext(field: Field, anchorX: number, anchorZ: number): void {
    const car = field.cars.find((c) => !c.spawned);
    if (!car) {
      this.seenSpawnOnce = false;
      return;
    }
    const slot = field.track.startGrid[car.index]!;
    if (!this.seenSpawnOnce && this.seenNear(slot, anchorX, anchorZ, SEEN_SPAWN_M)) return;
    if (this.slotTaken(slot, anchorX, anchorZ)) return;
    if (!this.world.state.cars[car.id]) this.world.apply({ t: 'car_add', car: this.standingCar(car.id, car.driver.modelId, field.track, slot) });
    car.spawned = true;
  }

  /** The box is within `near` of the player, or in view within `SEEN_SPAWN_M`. */
  private seenNear(slot: TrackPose, anchorX: number, anchorZ: number, near: number): boolean {
    const d = Math.hypot(slot.x - anchorX, slot.z - anchorZ);
    return d < near || (d < SEEN_SPAWN_M && this.host.inView(slot.x, slot.y + 1, slot.z, 3));
  }

  /** Anything stands in a box: a car, or the player on foot. */
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

  /** The ground plane under a car of `modelId` standing at (`x`, `z`) on the track, near arclength `s`. */
  private groundPose(modelId: string, track: RaceTrack, x: number, z: number, heading: number, s: number): { y: number; plane: GroundPose | null } {
    const measure = carModelMeasure(carModel(modelId).id);
    const at = this.at;
    const plane = poseOnGround(measure.wheels, x, z, heading, (gx, gz) => {
      track.project(gx, gz, s, at);
      return track.surfaceY(at.s, at.lateral) + TRACK_LIFT_M;
    });
    track.project(x, z, s, at);
    const groundY = plane ? plane.groundY : track.surfaceY(at.s, at.lateral) + TRACK_LIFT_M;
    return { y: carSpawnYAboveGround(measure, groundY), plane };
  }

  /** A car of `modelId` standing on its wheels at grid pose `slot`, as a haul's car is stood (contracts/world.ts). */
  private standingCar(id: string, modelId: string, track: RaceTrack, slot: TrackPose): CarState {
    const { y, plane } = this.groundPose(modelId, track, slot.x, slot.z, slot.heading, slot.s);
    const car = createServiceableCarState(id, modelId, slot.x, y, slot.z, slot.heading);
    if (plane) {
      car.qx = plane.qx;
      car.qy = plane.qy;
      car.qz = plane.qz;
      car.qw = plane.qw;
    }
    return car;
  }

  /**
   * Puts live car `vehicle` (of `modelId`) on the track at arclength `s`, `lateral` off
   * the centre, standing still on its wheels, facing the lap.
   */
  private standOnTrack(vehicle: Vehicle, modelId: string, track: RaceTrack, s: number, lateral: number): void {
    const point = track.offsetPoint(s, lateral, this.point);
    const sample = track.road.sampleAt(s);
    const { y, plane } = this.groundPose(modelId, track, point.x, point.z, sample.heading, s);
    vehicle.rescueTo(point.x, y, point.z, sample.heading, sample.grade);
    if (plane) vehicle.chassis.setRotation({ x: plane.qx, y: plane.qy, z: plane.qz, w: plane.qw }, true);
  }

  private removeField(): void {
    const field = this.field;
    if (!field) return;
    this.removeTrailers(field);
    for (const car of field.cars) {
      car.autopilot.setEngaged(false);
      car.cooldown.setEngaged(false);
      if (this.world.state.cars[car.id]) this.world.apply({ t: 'car_remove', carId: car.id });
    }
    this.field = null;
    this.readout.results = null;
    this.visuals.show(null, null, null);
  }

  private removeTrailers(field: Field): void {
    const postIndex = field.track.postIndex;
    const owners: RaceTrailerOwner[] = ['player', ...field.cars.map((car) => car.index)];
    for (const who of owners) {
      const trailerId = raceTrailerId(postIndex, who);
      if (this.world.state.trailers[trailerId]) this.world.apply({ t: 'trailer_remove', trailerId });
    }
  }

  // -------------------------------------------------------------------------
  // The offer, and the race keys.
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
    const field = this.field;
    const state = this.world.state;
    const carId = state.player.drivingCarId;
    if (!field || this.race !== null || carId === null || state.player.seat !== 'driver') return;
    // The results up: F (as Backspace) is the rematch, wherever the player stands by the track.
    if (this.readout.results !== null) {
      if (!pressed) return;
      f.interact = false;
      f.interactDown = false;
      this.swallowF = true;
      this.rematch(carId);
      return;
    }
    if (field.cars.some((car) => car.state !== 'waiting' || !this.host.vehicle(car.id))) return;
    const vehicle = this.host.vehicle(carId);
    if (!vehicle || vehicle.speedKmh > SLOT_STILL_KMH) return;
    const track = field.track;
    const slot = track.startGrid[PLAYER_SLOT]!;
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
    if (!takeStake(this.world, track.postIndex, field.round)) return;
    // The cars were live a moment ago; should any not be, the stake goes straight back.
    if (!this.startRace(carId)) refundStake(this.world);
  }

  /** The race keys: restart (a rematch while the results are up) and back to the track. */
  private keys(f: InputFrame): void {
    const restart = f.raceRestart;
    const back = f.raceReturn;
    f.raceRestart = false;
    f.raceReturn = false;
    const carId = this.world.state.player.drivingCarId;
    if (carId === null || this.world.state.player.seat !== 'driver') return;
    if (restart) {
      if (this.race) this.restartRace(this.race);
      else if (this.readout.results !== null) this.rematch(carId);
    }
    if (back && this.race && !this.race.session.held && !this.race.session.playerDone) this.returnPlayer(this.race);
  }

  /** The results up: the same field again from the grid, for a new stake. */
  private rematch(carId: string): void {
    const field = this.field;
    if (!field || this.race) return;
    if (this.coupled(carId)) {
      this.host.toast('unhitch first: the race is car against car');
      return;
    }
    if (!takeStake(this.world, field.track.postIndex, field.round)) {
      this.host.toast(`the race costs ${formatPay(RACE_STAKE)} — the jar is short`);
      return;
    }
    if (!this.startRace(carId)) {
      refundStake(this.world);
      this.host.toast('the field is not all here yet');
    }
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

  /**
   * Starts a race of the waiting field with the player in `playerCarId`: everybody stood
   * in their grid boxes (the player too, wherever he was), the lights on. The stake is
   * the caller's.
   */
  private startRace(playerCarId: string): boolean {
    const field = this.field;
    if (!field || this.race) return false;
    const track = field.track;
    const playerVehicle = this.host.vehicle(playerCarId);
    if (!playerVehicle) return false;
    for (const car of field.cars) if (!this.host.vehicle(car.id)) return false;
    const kg = Math.min(
      TRAILER_CAPACITY_KG,
      TRAILER_LOAD_MIN_KG + (TRAILER_LOAD_MAX_KG - TRAILER_LOAD_MIN_KG) * hash01(this.world.seed, TRAILER_LOAD_DOMAIN, track.postIndex, field.round),
    );
    const race: LiveRace = {
      playerCarId,
      session: new RaceSession(track, FIELD_SIZE + 1),
      trailer: field.plan.trailer,
      trailerKg: kg,
      flippedS: 0,
      deadS: 0,
      playerGhostS: 0,
      playerGhostFor: 0,
    };
    this.race = race;
    this.readout.results = null;
    this.readout.keys = `[${this.host.keyLabel('raceRestart')}] restart   [${this.host.keyLabel('raceReturn')}] back to track`;
    this.grid(race);
    return true;
  }

  /** Everybody to the grid, the trailers re-hitched, every car a solid racer, the lights from red. */
  private grid(race: LiveRace): void {
    const field = this.field!;
    const track = field.track;
    const playerVehicle = this.host.vehicle(race.playerCarId);
    const playerCar = this.world.state.cars[race.playerCarId];
    if (playerVehicle && playerCar) {
      const slot = track.startGrid[PLAYER_SLOT]!;
      this.standOnTrack(playerVehicle, playerCar.modelId, track, slot.s, slot.lateral);
      this.setGroups(playerVehicle, RACER_GROUPS);
      this.xs[0] = slot.x;
      this.zs[0] = slot.z;
    }
    // A driver that was somewhere else on the lap must find it again from scratch.
    this.devPilot?.setEngaged(false);
    race.flippedS = 0;
    race.deadS = 0;
    race.playerGhostS = 0;
    for (const car of field.cars) {
      const vehicle = this.host.vehicle(car.id);
      const slot = track.startGrid[car.index]!;
      if (vehicle) {
        this.standOnTrack(vehicle, car.driver.modelId, track, slot.s, slot.lateral);
        this.setGroups(vehicle, RACER_GROUPS);
      }
      this.xs[car.index + 1] = slot.x;
      this.zs[car.index + 1] = slot.z;
      car.state = 'racing';
      car.autopilot.setEngaged(false);
      car.cooldown.setEngaged(false);
      car.watch.reset();
      car.dueS = 0;
      car.ghostS = 0;
    }
    if (race.trailer) {
      this.hitchTrailer(raceTrailerId(track.postIndex, 'player'), race.playerCarId, race.trailerKg);
      for (const car of field.cars) this.hitchTrailer(raceTrailerId(track.postIndex, car.index), car.id, race.trailerKg);
    }
    race.session.start(this.xs, this.zs);
  }

  /** Backspace mid-race: the same race again from the grid, the stake as it is. */
  private restartRace(race: LiveRace): void {
    if (race.session.phase === 'finished') return;
    this.grid(race);
    this.host.toast('back to the grid');
  }

  /** T: the player's car back on the lap's centre at his last checkpoint, standing, a ghost for a moment. */
  private returnPlayer(race: LiveRace): void {
    const field = this.field!;
    const track = field.track;
    const vehicle = this.host.vehicle(race.playerCarId);
    const car = this.world.state.cars[race.playerCarId];
    if (!vehicle || !car) return;
    const counter = race.session.counters[0]!;
    let s: number;
    let lateral = 0;
    if (counter.lap === 0) {
      const slot = track.startGrid[PLAYER_SLOT]!;
      s = slot.s;
      lateral = slot.lateral;
    } else {
      s = (counter.next > 0 ? track.checkpoints[counter.next - 1]! : 0) + 2;
    }
    this.standOnTrack(vehicle, car.modelId, track, s, lateral);
    track.offsetPoint(s, lateral, this.point);
    race.session.relocate(0, this.point.x, this.point.z, s);
    if (race.trailer) this.hitchTrailer(raceTrailerId(track.postIndex, 'player'), race.playerCarId, race.trailerKg);
    this.setGroups(vehicle, GHOST_GROUPS);
    race.playerGhostS = GHOST_S;
    race.playerGhostFor = 0;
    race.flippedS = 0;
    this.devPilot?.setEngaged(false);
  }

  /**
   * A loaded trailer coupled to car `carId` in state, where the car now stands: the
   * trailer field materialises it with the car and puts it on the ball (vehicle/
   * trailer.ts `restoreHitch`), which stands it behind the car first. The crate is the
   * load: `cargoKg` on the bed, against the headboard as a haul's.
   */
  private hitchTrailer(id: string, carId: string, cargoKg: number): void {
    if (this.world.state.trailers[id]) this.world.apply({ t: 'trailer_remove', trailerId: id });
    const vehicle = this.host.vehicle(carId);
    const at = vehicle ? vehicle.absoluteTranslation(this.other) : this.world.state.cars[carId];
    if (!at) return;
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

  private setGroups(vehicle: Vehicle, groups: number): void {
    for (const collider of vehicle.collisionColliders) collider.setCollisionGroups(groups);
  }

  private driveRivals(dt: number): void {
    const field = this.field;
    if (!field) return;
    for (const car of field.cars) {
      if (!this.drives(car.id)) continue;
      const vehicle = this.host.vehicle(car.id);
      if (!vehicle) continue;
      const autopilot = car.state === 'racing' ? car.autopilot : car.cooldown;
      if (!autopilot.engaged) autopilot.setEngaged(true);
      if (car.state === 'cooldown') autopilot.setHoldDistance(car.toSlot);
      autopilot.drive(dt, vehicle, car.input, this.origin.x, this.origin.z);
      vehicle.fixedUpdate(dt, car.input);
    }
  }

  private stepRace(dt: number, race: LiveRace): void {
    const field = this.field;
    if (!field) {
      this.race = null;
      return;
    }
    const state = this.world.state;
    for (const car of field.cars) {
      const vehicle = this.host.vehicle(car.id);
      if (!vehicle) {
        this.callOff(race);
        return;
      }
      vehicle.absoluteTranslation(this.position);
      this.xs[car.index + 1] = this.position.x;
      this.zs[car.index + 1] = this.position.z;
    }
    const playerVehicle = this.host.vehicle(race.playerCarId);
    if (playerVehicle) {
      playerVehicle.absoluteTranslation(this.position);
      this.xs[0] = this.position.x;
      this.zs[0] = this.position.z;
    }
    const session = race.session;
    const over = session.step(dt, this.xs, this.zs);
    if (!session.held) {
      for (const car of field.cars) {
        if (car.state !== 'racing') continue;
        if (session.finished(car.index + 1)) this.toCooldown(field, car);
        else this.watchRival(dt, field, race, car);
      }
      this.stepPlayerGhost(dt, race, playerVehicle);
    }
    if (over) {
      this.finish(field, race);
      return;
    }
    if (session.held || session.playerDone) return;
    // The player's own ways out.
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
    if (end !== null) session.playerOut(end);
  }

  /** The player's ghost after a return: solid again once its time is up and nobody is on top of it. */
  private stepPlayerGhost(dt: number, race: LiveRace, vehicle: Vehicle | null): void {
    if (race.playerGhostS <= 0 || !vehicle) return;
    race.playerGhostFor += dt;
    race.playerGhostS -= dt;
    if (race.playerGhostS > 0) return;
    if (race.playerGhostFor < GHOST_MAX_S && this.nearRacer(0)) {
      race.playerGhostS = dt;
      return;
    }
    race.playerGhostS = 0;
    this.setGroups(vehicle, RACER_GROUPS);
  }

  /** Another racer within `GHOST_CLEAR_M` of racer `i` (positions as of this step). */
  private nearRacer(i: number): boolean {
    for (let j = 0; j <= FIELD_SIZE; j++) {
      if (j !== i && Math.hypot(this.xs[j]! - this.xs[i]!, this.zs[j]! - this.zs[i]!) < GHOST_CLEAR_M) return true;
    }
    return false;
  }

  /** A racing rival: off, flipped or stuck long enough is put back on the lap; a ghost turns solid again. */
  private watchRival(dt: number, field: Field, race: LiveRace, car: FieldCar): void {
    const vehicle = this.host.vehicle(car.id)!;
    const i = car.index + 1;
    if (car.ghostS > 0) {
      car.ghostFor += dt;
      car.ghostS -= dt;
      if (car.ghostS <= 0) {
        if (car.ghostFor < GHOST_MAX_S && this.nearRacer(i)) car.ghostS = dt;
        else this.setGroups(vehicle, RACER_GROUPS);
      }
    }
    const counter = race.session.counters[i]!;
    const q = vehicle.root.quaternion;
    const up = 1 - 2 * (q.x * q.x + q.z * q.z);
    if (!car.watch.step(dt, counter, up)) {
      car.dueS = 0;
      return;
    }
    car.dueS += dt;
    const track = field.track;
    const { s, lateral } = recoverAt(track, counter, track.startGrid[car.index]!, this.recovery);
    track.offsetPoint(s, lateral, this.point);
    const seen = this.host.inView(this.xs[i]!, track.centreY(counter.s) + 1, this.zs[i]!, 3) || this.host.inView(this.point.x, track.centreY(s) + 1, this.point.z, 3);
    if (seen && car.dueS < RECOVER_WAIT_S) return;
    this.standOnTrack(vehicle, car.driver.modelId, track, s, lateral);
    race.session.relocate(i, this.point.x, this.point.z, s);
    if (race.trailer) this.hitchTrailer(raceTrailerId(track.postIndex, car.index), car.id, race.trailerKg);
    this.setGroups(vehicle, GHOST_GROUPS);
    car.ghostS = GHOST_S;
    car.ghostFor = 0;
    car.watch.reset();
    car.dueS = 0;
    // A fresh engagement: the driver finds itself on the lap again from scratch.
    car.autopilot.setEngaged(true);
  }

  /** Rival `car` took the flag (or the race is over): the slow lap to its box. */
  private toCooldown(field: Field, car: FieldCar): void {
    const vehicle = this.host.vehicle(car.id);
    car.autopilot.setEngaged(false);
    car.state = 'cooldown';
    car.cooldownS = 0;
    const track = field.track;
    if (vehicle) {
      vehicle.absoluteTranslation(this.position);
      car.cooldownAt = track.project(this.position.x, this.position.z, undefined, this.at).s;
      // Out of the race: a ghost to the cars still racing it, solid again once it is over.
      this.setGroups(vehicle, this.race ? GHOST_GROUPS : DEFAULT_GROUPS);
    }
    car.toSlot = track.wrap(track.startGrid[car.index]!.s - car.cooldownAt);
  }

  private stepCooldowns(dt: number): void {
    const field = this.field;
    if (!field) return;
    const track = field.track;
    for (const car of field.cars) {
      if (car.state !== 'cooldown') continue;
      car.cooldownS += dt;
      const vehicle = this.host.vehicle(car.id);
      if (!vehicle) {
        car.cooldown.setEngaged(false);
        car.state = 'waiting';
        continue;
      }
      vehicle.absoluteTranslation(this.position);
      const s = track.project(this.position.x, this.position.z, car.cooldownAt, this.at).s;
      car.cooldownAt = s;
      const slot = track.startGrid[car.index]!;
      car.toSlot = track.wrap(slot.s - s);
      const parked = (car.toSlot < COOLDOWN_PARKED_M || car.toSlot > track.lengthM - COOLDOWN_PARKED_M) && vehicle.speedKmh < 1;
      // Out of the player's view, and its box too: simply stood back in it.
      const unseen =
        !this.host.inView(this.position.x, this.position.y + 1, this.position.z, 3) && !this.host.inView(slot.x, slot.y + 1, slot.z, 3) && !this.slotTakenByOther(slot, car.id);
      if (parked || unseen || car.cooldownS > COOLDOWN_MAX_S) {
        if (!parked) this.standOnTrack(vehicle, car.driver.modelId, track, slot.s, slot.lateral);
        car.cooldown.setEngaged(false);
        car.state = 'waiting';
      }
    }
  }

  /** Another live car than `id`, or the player, stands in a box. */
  private slotTakenByOther(slot: TrackPose, id: string): boolean {
    const state = this.world.state;
    for (const other in state.cars) {
      if (other === id) continue;
      const live = this.host.vehicle(other);
      const at = live ? live.absoluteTranslation(this.other) : state.cars[other]!;
      if (Math.hypot(slot.x - at.x, slot.z - at.z) < SLOT_TAKEN_M) return true;
    }
    return false;
  }

  /** The race over: the stake settled for the player's place, the round on, the results up, everybody on the cool-down. */
  private finish(field: Field, race: LiveRace): void {
    const session = race.session;
    const out = session.end !== 'laps' && session.end !== 'dev';
    const place = out ? 0 : session.position(0);
    const paid = settleStake(this.world, place);
    advanceRound(this.world, field.track.postIndex, field.round);
    this.endRace(field, race);
    const prize = racePrize(place);
    const placeWord = ['', '1st', '2nd', '3rd', '4th', '5th'][place] ?? `${place}th`;
    const why: Record<RaceEnd, string> = {
      laps: place === 1 ? 'YOU WIN!' : `YOU ARE ${placeWord}`,
      dev: place === 1 ? 'YOU WIN!' : `YOU ARE ${placeWord}`,
      'off-track': 'OUT — too long off the track',
      away: 'OUT — you left the track',
      'left-car': 'OUT — you got out',
      flipped: 'OUT — on the roof',
      wrecked: 'OUT — the car is done',
    };
    this.readout.results = {
      headline: why[session.end ?? 'laps'],
      won: place === 1,
      rows: this.resultRows(field, race),
      prize: paid < 0 ? 'no stake (dev race)' : prize > 0 ? `+${formatPay(prize)}${prize === RACE_STAKE ? ' — the stake back' : ''}` : 'no prize — the stake is gone',
      hint: `[F] or [${this.host.keyLabel('raceRestart')}] race again — ${formatPay(RACE_STAKE)}`,
    };
    this.host.toast(place === 1 ? `you win — ${formatPay(prize)}` : place > 0 ? `${placeWord} place${prize > 0 ? ` — ${formatPay(prize)}` : ''}` : 'out of the race');
  }

  private resultRows(field: Field, race: LiveRace): RaceResultRow[] {
    const session = race.session;
    const order = session.standings();
    return order.map((i, k): RaceResultRow => {
      const player = i === 0;
      const name = player ? 'YOU' : carModel(field.cars[i - 1]!.driver.modelId).label;
      let time: string;
      if (player && session.end !== null && session.end !== 'laps' && session.end !== 'dev') time = 'OUT';
      else if (session.finished(i)) time = clock(session.finishTimes[i]!);
      else {
        // Still running when the player was done: where its pace so far would have finished.
        const projected = session.projectedTime(i);
        time = Number.isFinite(projected) ? `~${clock(projected)}` : 'running';
      }
      const best = session.bestLap(i);
      return { place: k + 1, name, time, best: Number.isFinite(best) ? clock(best) : '—', player };
    });
  }

  /** The race called off undecided (a rival lost to the world): the stake back, the round as it was. */
  private callOff(race: LiveRace): void {
    const field = this.field;
    race.session.close('dev');
    const back = refundStake(this.world);
    if (field) this.endRace(field, race);
    else this.race = null;
    this.host.toast(back > 0 ? `race off — ${formatPay(back)} back` : 'race off');
  }

  /** The race's leftovers: the trailers off, every car solid as before, the field on its cool-down. */
  private endRace(field: Field, race: LiveRace): void {
    this.removeTrailers(field);
    const playerVehicle = this.host.vehicle(race.playerCarId);
    if (playerVehicle) this.setGroups(playerVehicle, DEFAULT_GROUPS);
    this.devPilot?.setEngaged(false);
    this.race = null;
    for (const car of field.cars) {
      if (car.state === 'racing') this.toCooldown(field, car);
      const vehicle = this.host.vehicle(car.id);
      if (vehicle) this.setGroups(vehicle, DEFAULT_GROUPS);
    }
  }

  /** The results close once the player has driven away from the grid. */
  private stepResults(): void {
    const field = this.field;
    if (this.readout.results === null || !field || this.race) return;
    const carId = this.world.state.player.drivingCarId;
    const vehicle = carId !== null ? this.host.vehicle(carId) : null;
    if (!vehicle) return;
    vehicle.absoluteTranslation(this.position);
    const slot = field.track.startGrid[PLAYER_SLOT]!;
    if (Math.hypot(this.position.x - slot.x, this.position.z - slot.z) > RESULTS_AWAY_M) this.readout.results = null;
  }

  private updateReadout(): void {
    const r = this.readout;
    const race = this.race;
    if (!race) {
      r.lights = 0;
      r.go = false;
      r.racing = false;
      r.hint = null;
      r.active = r.results !== null;
      return;
    }
    const session = race.session;
    r.active = true;
    r.lights = session.lights;
    r.go = session.phase === 'racing' && session.raceTime < GO_S;
    r.racing = session.phase === 'racing' && !session.playerDone;
    r.lap = session.playerLap;
    r.laps = RACE_LAPS;
    r.position = session.position(0);
    r.racers = session.racers;
    const counter = session.counters[0]!;
    r.hint =
      !r.racing ? null
      : race.flippedS > 0.5 || counter.offTrackS > 2 ? `[${this.host.keyLabel('raceReturn')}] back to the track`
      : null;
  }

  // -------------------------------------------------------------------------
  // Dev (app/devtools.ts `__bro.race`).
  // -------------------------------------------------------------------------

  /** The next field may be put down in view (the dev jump lands beside its grid). */
  devAllowSeenSpawn(): void {
    this.seenSpawnOnce = true;
    this.scanIn = 0;
  }

  /**
   * Starts a race of the waiting field from the grid with no stake; `trailer` true or false
   * makes it a trailer race or not, whatever the round drew (the perf A/B).
   */
  devStart(trailer?: boolean): string {
    const carId = this.world.state.player.drivingCarId;
    if (this.race) return 'a race is on already';
    let field = this.field;
    if (!field || field.cars.some((car) => car.state !== 'waiting')) return 'no field waiting near by';
    if (carId === null) return 'get in a car first';
    if (trailer !== undefined && trailer !== field.plan.trailer) {
      field = { ...field, plan: { ...field.plan, trailer } };
      this.field = field;
    }
    return this.startRace(carId)
      ? `racing ${field.plan.rivals.map((d) => d.modelId).join(', ')}${field.plan.trailer ? ' (trailers)' : ''}`
      : 'the cars are not live yet';
  }

  /** Decides the race on now, the player first or last. */
  devFinish(winner: 'player' | 'rival'): string {
    const race = this.race;
    const field = this.field;
    if (!race || !field) return 'no race on';
    race.session.devDecide(winner === 'player');
    this.finish(field, race);
    return `${winner} wins`;
  }

  /** The race keys from the console: `restart` (or rematch) and `back` to the track. */
  devKey(key: 'restart' | 'back'): string {
    const f = emptyInput();
    if (key === 'restart') f.raceRestart = true;
    else f.raceReturn = true;
    this.keys(f);
    return key;
  }

  /** The player's car driven round the lap by the race's own racer (for a whole race from the console). */
  devAutoDrive(on: boolean): string {
    const track = this.field?.track ?? this.track;
    if (!on || !track) {
      this.devPilot?.setEngaged(false);
      this.devPilot = null;
      return 'off';
    }
    this.devPilot = new Autopilot(track.road, this.physics);
    this.devPilot.setMode('frantic');
    return 'on';
  }

  devState(): Record<string, unknown> {
    const race = this.race;
    const field = this.field;
    const session = race?.session;
    return {
      track: this.track ? { id: this.track.id, lengthM: this.track.lengthM, stats: this.track.stats } : null,
      field: field
        ? {
            trailer: field.plan.trailer,
            round: field.round,
            cars: field.cars.map((car) => ({ id: car.id, model: car.driver.modelId, state: car.state, spawned: car.spawned, live: this.host.vehicle(car.id) !== null, ghost: car.ghostS > 0 })),
          }
        : null,
      stake: this.world.state.raceStake,
      race: session
        ? {
            phase: session.phase,
            lights: session.lights,
            time: session.raceTime,
            end: session.end,
            standings: [...session.standings()],
            racers: session.counters.map((c, i) => ({ lap: c.lap, checkpoint: c.next, s: c.s, offTrackS: c.offTrackS, finished: session.finished(i) ? session.finishTimes[i] : null })),
          }
        : null,
      results: this.readout.results,
    };
  }

  dispose(): void {
    const field = this.field;
    if (field) for (const car of field.cars) {
      car.autopilot.setEngaged(false);
      car.cooldown.setEngaged(false);
    }
    this.devPilot?.setEngaged(false);
    this.visuals.dispose();
  }
}

/** Seconds as m:ss.s. */
function clock(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths - minutes * 600) / 10;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}
