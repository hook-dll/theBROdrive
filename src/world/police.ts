/**
 * THE POLICE: a UAZ-469 in black with white doors at a post every few kilometres, a
 * radar across the road, a chase with the light bar and the siren, a stop on the
 * shoulder and a fine out of the pack.
 *
 * POSTS. Where the police stand is a pure function of the seed and the road: one post
 * every `POST_GAP_MIN_M`–`POST_GAP_MAX_M` of road (each gap its own roll), the first that
 * far past `POST_START_CLEAR_M`. A post faces the way the player travels when it is first
 * met and stands on that direction's own side: on the lay-by in front of a roadside stop
 * when one on that side reaches within `POST_LAYBY_SNAP_M` (the car angled on the pad,
 * its nose to the road), otherwise on a pull-off on the shoulder. Every post is manned;
 * `heat` (`POLICE_HEAT_MAX` levels) makes every one of them stop him. The car is
 * ephemeral, like a race rival: the traffic stream (`RoadTraffic.spawnPolice`) puts it
 * down parked when its post comes into the stream's own unseen spawn band, and it leaves
 * at the support edge.
 *
 * THE RADAR. A posted car watches its own direction's traffic within `WATCH_M` of it.
 * Once the player's car is past it, it decides: faster than `SPEED_LIMIT_KMH` (90 km/h
 * everywhere, the owner's limit) anywhere in that reach, a collision with a traffic car
 * in the last `ACCIDENT_MEMORY_S`, any heat at all, or the post's own roll for a document
 * check (`CHECK_CHANCE`) — and it pulls out after him.
 *
 * THE CHASE. Light bar and siren, the frantic driver's engine under a ceiling above the
 * player's own speed (`CATCH_UP_MPS`) until it is close, then matched to his and held
 * `FOLLOW_M` behind, never passing him (`RoadTraffic.policeChase`). When he stops it
 * pulls over `STAND_GAP_M` behind him, bumper to bumper, on his line (`policeStopBehind`): on the shoulder
 * if he stopped on it, and once both stand: [F] hands over the papers (`handOver`).
 *
 * THE STOP. Speeding is fined by how far over the limit, a collision flatly, a car whose
 * papers are not the player's (`CarState.papers`) flatly, and every contract cargo item
 * not on the car's waybill — carried in the pack, or past the body's contract slots in
 * the boot (`contractSlotsFor`) — per item; all of it times `1 + heat`. A clean check
 * costs nothing. The fine comes out of the coins in the pack, as far as they go. The
 * pack's `inventory` delta and the `police_heat` delta are not save triggers behind the
 * wheel, so what the stop took is saved with the next exit (save.ts). A stop paid in full
 * clears the heat; an unpaid rest adds a level.
 *
 * THE FLIGHT. Driving off from a stop, ignoring the lights for `FLEE_TIME_S`, or opening
 * `FLEE_GAP_M` on the car is a flight. Each chase rolls once, at its start, what the
 * police do then: give up after `GIVE_UP_MIN_M`-`GIVE_UP_MIN_M + GIVE_UP_SPAN_M` of road,
 * or escalate — one more level of heat (stopped at every post, a larger fine next stop) for
 * `HEAT_COOL_S` of played time — and keep after him until he is lost.
 */

import { hash01 } from '../core/rng';
import { coinsHeld, contractSlotsFor, spendCoins } from '../economy/economy';
import type { GameWorld } from '../game/state';
import { POLICE_HEAT_MAX } from '../game/state';
import type { Inventory } from '../items/items';
import type { CarPaint } from '../vehicle/carpaint';
import type { Vehicle } from '../vehicle/vehicle';
import { laybysBetween, shoulderPullOff, type Layby } from './layby';
import { TRAFFIC_REACH_M, TRAFFIC_UNSEEN_M } from './ranges';
import type { DriveRoad } from './road';
import type { PolicePose, PoliceSpawn } from './traffic';

/** The police car: the UAZ-469 in its police livery (carkit police look). */
export const POLICE_MODEL_ID = 'kit_uaz469_police';
/** Its fixed body colour; the doors are white whatever this is (the livery). */
export const POLICE_PAINT: Readonly<CarPaint> = { base: 0x161618, coat: 0x161618, cover: 1 };

/** The speed limit, everywhere (owner, 2026-10-18). */
export const SPEED_LIMIT_KMH = 90;
/** Road either side of a posted car its radar reads the player's speed over, metres. */
const WATCH_M = 150;
/** The player's car this far past the posted car: it decides. */
const PASS_M = 8;
/** Share of passes a post stops a clean driver for a look at his papers and cargo. */
const CHECK_CHANCE = 0.12;
/** A collision with a traffic car is still on the police's mind this long, seconds. */
const ACCIDENT_MEMORY_S = 300;

/** Road between one post and the next, metres: a fresh roll in this range per gap. */
const POST_GAP_MIN_M = 5000;
const POST_GAP_MAX_M = 10000;
/** No post before this far from the start (the house), or this near the road's end. */
const POST_START_CLEAR_M = 2000;
const POST_END_CLEAR_M = 600;
/** A post this near a lay-by on its side moves onto it, metres (a pull-off there would overlap the pad). */
const POST_LAYBY_SNAP_M = 300;
/** Posts are read this far either side of the player and forgotten past twice it. */
const POST_READ_M = TRAFFIC_REACH_M + 200;
/** Read posts at least this far ahead (and behind): past the spawn band's far edge. */
const POST_READ_LEAD_M = TRAFFIC_REACH_M;
/** A post is put down when it is this far ahead: the stream's own unseen band. */
const SPAWN_MIN_AHEAD_M = TRAFFIC_UNSEEN_M;
const SPAWN_MAX_AHEAD_M = TRAFFIC_REACH_M - 40;
/** A dev post (`devPost`) may be put down this near. */
const DEV_SPAWN_MIN_AHEAD_M = 20;
const SPAWN_RETRY_S = 0.5;

/**
 * The chase's ceiling: this much over the player's speed until close, within these
 * bounds. The road's surface and bends take a share of any ceiling (`surfacePaceFactor`),
 * so the margin is wide: at 10 m/s a player at 100 km/h held a 140 m lead for minutes.
 */
const CATCH_UP_MPS = 16;
const CHASE_MIN_MPS = 80 / 3.6;
const CHASE_MAX_MPS = 170 / 3.6;
/**
 * Closer than this it matches his speed, easing toward `FOLLOW_M` behind him at
 * `FOLLOW_GAIN` m/s of closing per metre of gap. Far enough back that a player braking
 * hard to a stop from 100 km/h does not have it on his bumper: at 25 m it came to a
 * stand 0-4 m behind him (in-game smoke, seed 11), and a car cannot back up into place.
 */
const TAIL_M = 90;
const FOLLOW_M = 40;
const FOLLOW_GAIN = 0.35;
/**
 * Closer than this it does not pass him (`RoadTraffic.policeChase` `tailing`). Farther
 * back it still passes whatever is between them: at 160 m it sat behind an ambient car
 * the whole chase (tools/police-bench.ts).
 */
const TAILING_M = 60;
/** Below this, for this long, the player has stopped. */
const PLAYER_STOPPED_KMH = 4;
const PLAYER_STOPPED_S = 1.5;
/** A stopped player this near ahead is pulled over behind; the car stands this far behind. */
const STOP_REACH_M = 250;
/**
 * Between the bumpers: the stand is this plus both cars' half lengths behind him, plus
 * the 2-3 m the car rolls past its hold line coming down from a chase (measured in
 * tools/police-bench.ts, seeds 42, 7, 1337: 7.0-8.3 m without it).
 */
const STAND_GAP_M = 10;
const STAND_OVERSHOOT_M = 2.5;
/** It is in its place within this of its gap, metres; it stops trying after this long, seconds. */
const PLACE_SLACK_M = 2.5;
const PLACE_TIMEOUT_S = 25;
/**
 * The flight clock (`FLEE_TIME_S`) runs only while he keeps his pace. His pace is the
 * fastest he has gone lately: it follows him up at once and eases down by
 * `PACE_EASE_KMH_S`, so a slower stretch he holds becomes his new pace.
 *
 * Dropping `SLOWING_KMH` below that pace PAUSES the clock. Dropping under
 * `PULLING_OVER_SHARE` of it RESTARTS the clock, because that is a man pulling over.
 *
 * It used to restart on any 12 km/h drop below the fastest since the last restart. A
 * player braking for a bend or a crest then never ran 35 s. On the rolling road
 * (seed 42, police-bench) a 104 km/h runner was never a flight: the chase sat between
 * 150 and 400 m behind him for three minutes, the clock restarting at every corner.
 */
const SLOWING_KMH = 12;
const PACE_EASE_KMH_S = 1;
const PULLING_OVER_SHARE = 0.5;
/** The police car standing (m/s) this long behind a stopped player: the stop begins. */
const POLICE_STANDING_MPS = 0.5;
const STANDING_SETTLE_S = 1;
/** The officer does his check unasked after this long at a stop, seconds. */
const ASK_TIMEOUT_S = 45;
/** A stopped player who gets this far from where he stood, or this fast, has driven off. */
const EVADE_M = 25;
const EVADE_KMH = 20;
/**
 * Ignoring the lights this long — counted while the car is within `LIGHTS_SEEN_M` of
 * him, where he cannot miss the bar and the siren — or getting this far ahead of it, is
 * a flight. 300 m, from 150: on the rolling road a pursuer slows at every blind crest,
 * and a 110 km/h runner kept it 150-310 m back for three minutes without the clock
 * ever starting (seed 42, police-bench), so he was never a fugitive.
 */
const FLEE_TIME_S = 35;
const LIGHTS_SEEN_M = 300;
const FLEE_GAP_M = 400;
/** Behind the car by this much (he turned round): a flight too. */
const FLEE_BEHIND_M = 40;
/** What a chase that gives up runs after the flight before it does, metres. */
const GIVE_UP_MIN_M = 1500;
const GIVE_UP_SPAN_M = 2500;
/** An escalated chase keeps after him this much road, then goes back on patrol. */
const ESCALATED_CHASE_M = 6000;
/**
 * After a stop the police car waits for him to leave first — it stands close behind his
 * car, and pulling out round a car standing that near is not a line it can drive — and
 * goes once he is this far ahead, or this far away either way (walked off, turned back).
 */
const CLEAR_GAP_M = 60;
const CLEAR_AWAY_M = 300;
/** A level of heat lasts this much played time, seconds; each escalation restarts it. */
const HEAT_COOL_S = 20 * 60;

/** Fines in coins, before `1 + heat`. */
const FINE_SPEEDING_BASE = 2;
/** ...plus one per this many km/h over the limit, rounded up. */
const FINE_SPEEDING_STEP_KMH = 10;
const FINE_ACCIDENT = 6;
const FINE_NO_PAPERS = 6;
const FINE_UNDECLARED = 4;
/** A wanted driver stopped at last answers for the flight. */
const FINE_EVADING = 5;

const POST_SALT = 0x504f5354;
const CHECK_SALT = 0x43484b31;
const CHASE_SALT = 0x43485345;
/**
 * Post keys: a road post's `2 * index`, a dev lay-by post's `2 * Poi.index + 1`, a dev
 * shoulder post's negative. A shoulder pull-off's own id is `-(index + 1)`, a dev one's
 * past `DEV_PULL_OFF_ID`.
 */
const DEV_PULL_OFF_ID = -(2 ** 30);

/** Post places along the road per seed, grown on demand: `[0]` is `POST_START_CLEAR_M`, posts are `[1..]`. */
const postPlaceCache = new Map<number, number[]>();
function postPlaces(seed: number): number[] {
  let places = postPlaceCache.get(seed);
  if (!places) {
    places = [POST_START_CLEAR_M];
    postPlaceCache.set(seed, places);
  }
  return places;
}

/** What the police host has to offer: the traffic stream (`RoadTraffic`). */
export interface PoliceHost {
  spawnPolice(spec: PoliceSpawn): Promise<boolean>;
  policePose(id: string, out: PolicePose): boolean;
  policePullOut(id: string): void;
  policeChase(id: string, capMps: number, tailing: boolean): void;
  policeStopBehind(id: string, standS: number, lateral: number): void;
  setPoliceLights(id: string, on: boolean): void;
  releasePolice(id: string): void;
  policeVehicle(id: string): Vehicle | null;
  readonly playerImpacts: number;
}

/** What the police see of the player this step. */
export interface PoliceView {
  /** The followed arclength and forward lateral (main.ts `activeS`, `activeLateral`). */
  readonly s: number;
  readonly lateral: number;
  /** The car he drives, or null on foot. */
  readonly carId: string | null;
  readonly speedKmh: number;
  /** His car's half length along the road, metres (0 on foot). */
  readonly halfLength: number;
}

/** Why a chase began. */
interface Grounds {
  /** Fastest he was clocked in the radar's reach, km/h, when over the limit; else null. */
  readonly speedingKmh: number | null;
  readonly accident: boolean;
  /** Wanted already (heat). */
  readonly wanted: boolean;
}

interface Post {
  readonly key: number;
  readonly direction: 1 | -1;
  readonly pullOff: Layby;
  /** Made by `devPost`: put down as near as `DEV_SPAWN_MIN_AHEAD_M`. */
  readonly dev: boolean;
  state: 'waiting' | 'spawning' | 'live' | 'done';
  retryIn: number;
  carId: string;
  /** Fastest the player was clocked within `WATCH_M`, km/h. */
  clockedKmh: number;
  /** Times the player has been seen past it; seeds the check roll. */
  passes: number;
}

type ChasePhase = 'pulling-out' | 'chasing' | 'stopping' | 'stopped' | 'cleared';

interface Chase {
  readonly carId: string;
  readonly post: Post;
  readonly direction: 1 | -1;
  readonly grounds: Grounds;
  /** The roll for a flight, taken at its start: give up after `giveUpAfterM`, or escalate. */
  givesUp: boolean;
  readonly giveUpAfterM: number;
  phase: ChasePhase;
  /** Seconds the lights have been behind him while he has not stopped. */
  ignoredFor: number;
  /** His pace, km/h: the fastest he went lately; see `SLOWING_KMH`. */
  paceKmh: number;
  playerStillFor: number;
  standingFor: number;
  /** Seconds at the stop waiting for the papers; see `ASK_TIMEOUT_S`. */
  waitedFor: number;
  /** Where he stood when the stop began. */
  stoodS: number;
  /** Arclength of the flight, or NaN before one. */
  fledAtS: number;
}

/** A finished stop's account, for the toast and the console. */
export interface PoliceStopResult {
  readonly fine: number;
  readonly paid: number;
  readonly items: readonly string[];
}

export class PolicePatrol {
  private readonly posts = new Map<number, Post>();
  private postsFrom = Infinity;
  private postsTo = -Infinity;
  private chase: Chase | null = null;
  private readonly pose: PolicePose = { s: 0, lateral: 0, speed: 0, direction: 1, posted: true, halfLength: 0 };
  private serial = 0;
  private chases = 0;
  private clock = 0;
  private playerS = 0;
  private playerSpeed = 0;
  /** The way he is travelling, by his motion; kept while he stands. */
  private travel: 1 | -1 = 1;
  private impactsSeen = 0;
  private lastAccidentAt = -Infinity;
  /** The car he last drove: the one inspected if he meets the officer on foot. */
  private lastCarId: string | null = null;
  /** Dev: the next flight's outcome, forced (`devFlight`). */
  private forcedGiveUp: boolean | null = null;
  private devKey = 0;
  /** What the HUD's prompt line says while the police are after him; null otherwise. */
  prompt: string | null = null;
  /**
   * Whether posts stand on the road at all. A dream can ask for none (dreams/dream.ts
   * `police`); set before the first step, so no post is ever read.
   */
  postsEnabled = true;

  constructor(
    private readonly world: GameWorld,
    private readonly road: DriveRoad,
    private readonly host: PoliceHost,
    private readonly inventory: Inventory,
    private readonly notify: (text: string) => void,
  ) {
    this.impactsSeen = host.playerImpacts;
  }

  /** True while a stop waits for the papers: [F] goes to `handOver`, not to the world. */
  get awaitingPapers(): boolean {
    return this.chase?.phase === 'stopped';
  }

  /** The chasing car's position (physics frame) for the siren, into `out`; false when silent. */
  sirenAt(out: { x: number; y: number; z: number }): boolean {
    const chase = this.chase;
    if (!chase || chase.phase === 'cleared') return false;
    const vehicle = this.host.policeVehicle(chase.carId);
    if (!vehicle) return false;
    const t = vehicle.chassis.translation();
    out.x = t.x;
    out.y = t.y;
    out.z = t.z;
    return true;
  }

  fixedUpdate(dt: number, view: PoliceView): void {
    this.clock += dt;
    const advance = view.s - this.playerS;
    this.playerSpeed = dt > 0 && Math.abs(advance) < 50 ? this.playerSpeed * 0.9 + (advance / dt) * 0.1 : 0;
    this.playerS = view.s;
    if (this.playerSpeed > 2) this.travel = 1;
    else if (this.playerSpeed < -2) this.travel = -1;
    if (view.carId !== null) this.lastCarId = view.carId;
    const impacts = this.host.playerImpacts;
    if (impacts !== this.impactsSeen) {
      this.impactsSeen = impacts;
      this.lastAccidentAt = this.clock;
    }
    this.coolHeat();
    this.refreshPosts();
    for (const post of this.posts.values()) this.runPost(post, dt, view);
    if (this.chase) this.runChase(this.chase, dt, view);
    this.prompt = this.chase ? this.promptFor(this.chase) : null;
  }

  /**
   * The papers handed over at a stop: the check, the fine out of the pack, the account
   * toasted; the car waits for him to leave. Called on [F] while `awaitingPapers`, and by
   * the officer himself after `ASK_TIMEOUT_S`.
   */
  handOver(): PoliceStopResult | null {
    const chase = this.chase;
    if (!chase || chase.phase !== 'stopped') return null;
    const result = this.inspect(chase);
    chase.phase = 'cleared';
    this.host.setPoliceLights(chase.carId, false);
    if (result.fine === 0) {
      this.notify('police: papers in order — drive on');
    } else {
      const account = result.items.join(' · ');
      if (result.paid >= result.fine) {
        this.notify(`police: fined ${result.fine} coin${result.fine === 1 ? '' : 's'} — ${account}`);
      } else {
        this.notify(`police: fined ${result.fine}, paid ${result.paid} — ${account}; the rest goes on your record`);
      }
    }
    return result;
  }

  /** Console view: the chase, the posts in reach, the heat. */
  snapshot(): {
    heat: number;
    heatUntil: number;
    chase: { carId: string; phase: ChasePhase; givesUp: boolean; fled: boolean; grounds: Grounds } | null;
    posts: { key: number; s: number; direction: number; kind: string; state: string; carId: string }[];
  } {
    const record = this.world.state.player.police;
    const chase = this.chase;
    return {
      heat: record.heat,
      heatUntil: record.heatUntil,
      chase: chase
        ? { carId: chase.carId, phase: chase.phase, givesUp: chase.givesUp, fled: !Number.isNaN(chase.fledAtS), grounds: chase.grounds }
        : null,
      posts: [...this.posts.values()].map((post) => ({
        key: post.key,
        s: post.pullOff.s,
        direction: post.direction,
        kind: post.pullOff.poiIndex >= 0 ? 'layby' : 'shoulder',
        state: post.state,
        carId: post.carId,
      })),
    };
  }

  /**
   * Dev: a post `metres` up the road in his direction of travel — on the shoulder, or
   * at the nearest lay-by on his side from there — put down as near as 20 m.
   */
  devPost(kind: 'shoulder' | 'layby', metres = 120): number | null {
    const direction = this.travel;
    const at = this.playerS + direction * metres;
    let pullOff: Layby | null = null;
    let key: number;
    if (kind === 'layby') {
      const found = laybysBetween(this.world.seed, Math.min(at, at + direction * 8000), Math.max(at, at + direction * 8000))
        .filter((layby) => layby.side === -direction)
        .sort((a, b) => (a.s - b.s) * direction)[0];
      if (!found) return null;
      pullOff = found;
      key = found.poiIndex * 2 + 1;
    } else {
      key = -(++this.devKey);
      pullOff = shoulderPullOff(this.world.seed, at, direction === 1 ? -1 : 1, DEV_PULL_OFF_ID + key);
    }
    const existing = this.posts.get(key);
    if (existing?.state === 'live' || existing?.state === 'spawning') return key;
    this.posts.set(key, this.newPost(key, direction, pullOff, true));
    return key;
  }

  /** Dev: the nearest live post's car pulls out after him now, on `grounds`. */
  devChase(reason: 'speeding' | 'accident' | 'check' = 'check'): boolean {
    if (this.chase) return false;
    let best: Post | null = null;
    for (const post of this.posts.values()) {
      if (post.state !== 'live') continue;
      if (!best || Math.abs(post.pullOff.s - this.playerS) < Math.abs(best.pullOff.s - this.playerS)) best = post;
    }
    if (!best) return false;
    this.startChase(best, {
      speedingKmh: reason === 'speeding' ? Math.max(SPEED_LIMIT_KMH + 15, best.clockedKmh) : null,
      accident: reason === 'accident',
      wanted: false,
    });
    return true;
  }

  /** Dev: the next flight gives up (true) or escalates (false); null back to the roll. */
  devFlight(givesUp: boolean | null): void {
    this.forcedGiveUp = givesUp;
    const chase = this.chase;
    if (chase && givesUp !== null) chase.givesUp = givesUp;
  }

  /** Dev: the heat, set directly (and its clock restarted). */
  devHeat(level: number): void {
    this.setHeat(level);
  }

  private get heat(): number {
    return this.world.state.player.police.heat;
  }

  private setHeat(level: number): void {
    const heat = Math.min(POLICE_HEAT_MAX, Math.max(0, Math.round(level)));
    this.world.apply({
      t: 'police_heat',
      heat,
      heatUntil: heat > 0 ? this.world.state.playedSeconds + HEAT_COOL_S : 0,
    });
  }

  private coolHeat(): void {
    const record = this.world.state.player.police;
    if (record.heat > 0 && this.world.state.playedSeconds >= record.heatUntil && !this.chase) {
      this.setHeat(0);
      this.notify('the police have stopped looking for you');
    }
  }

  /**
   * Re-reads the posts within `POST_READ_M` once less than `POST_READ_LEAD_M` of the
   * stretch last read is left ahead of him either way, so every post is known before it
   * enters the spawn band (one first read inside the band could be passed before its car
   * is placed).
   */
  private refreshPosts(): void {
    if (!this.postsEnabled) return;
    const s = this.playerS;
    if (s - POST_READ_LEAD_M >= this.postsFrom && s + POST_READ_LEAD_M <= this.postsTo) return;
    for (const [key, post] of this.posts) {
      const far = Math.abs(post.pullOff.s - s) > POST_READ_M * 2;
      if (far && post.state !== 'live' && post.state !== 'spawning' && this.chase?.post !== post) this.posts.delete(key);
    }
    const from = Math.max(POST_START_CLEAR_M, s - POST_READ_M);
    const to = Math.min(this.road.length - POST_END_CLEAR_M, s + POST_READ_M);
    this.postsFrom = s - POST_READ_M;
    this.postsTo = s + POST_READ_M;
    if (to <= from) return;
    const seed = this.world.seed;
    const places = postPlaces(seed);
    while (places[places.length - 1]! <= to) {
      const index = places.length;
      places.push(places[index - 1]! + POST_GAP_MIN_M + hash01(seed, POST_SALT, index) * (POST_GAP_MAX_M - POST_GAP_MIN_M));
    }
    for (let index = 1; index < places.length; index++) {
      const at = places[index]!;
      if (at < from) continue;
      if (at > to) break;
      const key = index * 2;
      if (this.posts.has(key)) continue;
      // It faces the way he is going, on that direction's own side of the road.
      const direction = this.travel;
      const side = direction === 1 ? -1 : 1;
      const layby = laybysBetween(seed, at - POST_LAYBY_SNAP_M, at + POST_LAYBY_SNAP_M)
        .filter((l) => l.side === side)
        .sort((a, b) => Math.abs(a.s - at) - Math.abs(b.s - at))[0];
      this.posts.set(key, this.newPost(key, direction, layby ?? shoulderPullOff(seed, at, side, -(index + 1)), false));
    }
  }

  private newPost(key: number, direction: 1 | -1, pullOff: Layby, dev: boolean): Post {
    return { key, direction, pullOff, dev, state: 'waiting', retryIn: 0, carId: '', clockedKmh: 0, passes: 0 };
  }

  private runPost(post: Post, dt: number, view: PoliceView): void {
    if (post.state === 'waiting') {
      this.trySpawn(post, dt);
      return;
    }
    if (post.state !== 'live' || this.chase?.post === post) return;
    if (!this.host.policePose(post.carId, this.pose)) {
      // Dropped at the support edge behind him, or never seen again: the post is done.
      post.state = 'done';
      return;
    }
    // THE RADAR: only his own direction's traffic, only from the driver's seat.
    if (view.carId === null || post.direction !== this.travel) return;
    const ahead = (view.s - this.pose.s) * post.direction;
    if (ahead < -WATCH_M || ahead > WATCH_M) {
      if (ahead > WATCH_M && post.clockedKmh > 0) post.clockedKmh = 0;
      return;
    }
    post.clockedKmh = Math.max(post.clockedKmh, view.speedKmh);
    if (ahead < PASS_M || this.chase) return;
    // Past it: the decision, once per pass.
    post.passes++;
    const speeding = post.clockedKmh > SPEED_LIMIT_KMH ? post.clockedKmh : null;
    const accident = this.clock - this.lastAccidentAt < ACCIDENT_MEMORY_S;
    const wanted = this.heat > 0;
    const check = hash01(this.world.seed, CHECK_SALT, post.key, post.passes) < CHECK_CHANCE;
    post.clockedKmh = 0;
    if (speeding === null && !accident && !wanted && !check) {
      // Waved through: the car stays on its post until the stream drops it behind him.
      post.state = 'done';
      return;
    }
    this.startChase(post, { speedingKmh: speeding, accident, wanted });
  }

  private trySpawn(post: Post, dt: number): void {
    post.retryIn -= dt;
    if (post.retryIn > 0 || post.direction !== this.travel || this.chase?.post === post) return;
    const placeS = post.pullOff.s;
    const ahead = (placeS - this.playerS) * post.direction;
    const min = post.dev ? DEV_SPAWN_MIN_AHEAD_M : SPAWN_MIN_AHEAD_M;
    if (ahead < min || ahead > SPAWN_MAX_AHEAD_M) {
      // Behind him already: he has passed an empty post.
      if (ahead < min && !post.dev) post.state = 'done';
      return;
    }
    post.retryIn = SPAWN_RETRY_S;
    post.state = 'spawning';
    const id = `police:${post.key}:${(this.serial++).toString(36)}`;
    void this.host
      .spawnPolice({ id, modelId: POLICE_MODEL_ID, direction: post.direction, post: post.pullOff, paint: POLICE_PAINT })
      .then((placed) => {
        if (post.state !== 'spawning') return;
        post.state = placed ? 'live' : 'waiting';
        if (placed) post.carId = id;
      });
  }

  private startChase(post: Post, grounds: Grounds): void {
    const seed = this.world.seed;
    const chaseKey = this.chases++;
    const forced = this.forcedGiveUp;
    this.chase = {
      carId: post.carId,
      post,
      direction: post.direction,
      grounds,
      givesUp: forced ?? hash01(seed, CHASE_SALT, post.key, chaseKey) < 0.5,
      giveUpAfterM: GIVE_UP_MIN_M + hash01(seed, CHASE_SALT, post.key, chaseKey, 1) * GIVE_UP_SPAN_M,
      phase: 'pulling-out',
      ignoredFor: 0,
      paceKmh: 0,
      playerStillFor: 0,
      standingFor: 0,
      waitedFor: 0,
      stoodS: this.playerS,
      fledAtS: Number.NaN,
    };
    post.state = 'done';
    this.host.policePullOut(post.carId);
    this.host.setPoliceLights(post.carId, true);
    const why = grounds.wanted
      ? 'you are wanted'
      : grounds.speedingKmh !== null
        ? `${Math.round(grounds.speedingKmh)} km/h in a ${SPEED_LIMIT_KMH} zone`
        : grounds.accident
          ? 'a collision with traffic'
          : 'a document check';
    this.notify(`police lights behind — ${why}: pull over and stop`);
  }

  private runChase(chase: Chase, dt: number, view: PoliceView): void {
    const pose = this.pose;
    if (!this.host.policePose(chase.carId, pose)) {
      // Dropped at the support edge: he got away, whatever the roll said.
      if (chase.phase !== 'cleared') {
        if (Number.isNaN(chase.fledAtS)) this.flee(chase);
        this.notify('you lost the police');
      }
      this.chase = null;
      return;
    }
    const direction = chase.direction;
    const gap = (view.s - pose.s) * direction;
    const playerKmh = view.carId !== null ? view.speedKmh : 0;
    chase.playerStillFor = playerKmh < PLAYER_STOPPED_KMH ? chase.playerStillFor + dt : 0;
    const fled = !Number.isNaN(chase.fledAtS);
    switch (chase.phase) {
      case 'pulling-out':
        if (!pose.posted) chase.phase = 'chasing';
        else if (gap > FLEE_GAP_M && !fled) this.flee(chase);
        return;
      case 'chasing': {
        if (fled && this.chaseOver(chase)) return;
        if (chase.playerStillFor > PLAYER_STOPPED_S && gap > -STAND_GAP_M && gap < STOP_REACH_M) {
          chase.phase = 'stopping';
          chase.standingFor = 0;
          chase.waitedFor = 0;
          chase.stoodS = view.s;
          this.runChase(chase, 0, view);
          return;
        }
        // The lights are behind him and he keeps his pace: the flight clock runs. A
        // bend or a crest pauses it; pulling over restarts it.
        chase.paceKmh = Math.max(playerKmh, chase.paceKmh - PACE_EASE_KMH_S * dt);
        if (playerKmh < chase.paceKmh * PULLING_OVER_SHARE) {
          chase.ignoredFor = 0;
          chase.paceKmh = playerKmh;
        } else if (playerKmh >= chase.paceKmh - SLOWING_KMH && gap < LIGHTS_SEEN_M) {
          chase.ignoredFor += dt;
        }
        if (!fled && (chase.ignoredFor > FLEE_TIME_S || gap > FLEE_GAP_M || gap < -FLEE_BEHIND_M)) this.flee(chase);
        const playerMps = Math.max(0, playerKmh / 3.6);
        const cap = gap > TAIL_M
          ? Math.min(CHASE_MAX_MPS, Math.max(CHASE_MIN_MPS, playerMps + CATCH_UP_MPS))
          : Math.max(0, playerMps + (gap - FOLLOW_M) * FOLLOW_GAIN);
        this.host.policeChase(chase.carId, cap, gap < TAILING_M);
        return;
      }
      case 'stopping':
        if (playerKmh > EVADE_KMH) {
          chase.phase = 'chasing';
          return;
        }
        // Bumper to bumper: its stand is the gap plus both half lengths behind him.
        this.host.policeStopBehind(
          chase.carId,
          view.s - direction * (STAND_GAP_M + STAND_OVERSHOOT_M + view.halfLength + pose.halfLength),
          view.lateral,
        );
        // Standing where it means to: at its gap, or after `PLACE_TIMEOUT_S` of trying (a
        // car behind it it cannot back into). Backing up to it is slow, so "still" alone
        // was met while it reversed.
        chase.waitedFor += dt;
        {
          const bumper = gap - view.halfLength - pose.halfLength;
          const placed = bumper >= STAND_GAP_M - PLACE_SLACK_M || chase.waitedFor > PLACE_TIMEOUT_S;
          chase.standingFor = placed && Math.abs(pose.speed) < POLICE_STANDING_MPS && chase.playerStillFor > 0
            ? chase.standingFor + dt
            : 0;
        }
        if (chase.standingFor > STANDING_SETTLE_S) {
          chase.phase = 'stopped';
          chase.waitedFor = 0;
          chase.stoodS = view.s;
          this.notify('police stop — [F] hand over your papers');
        }
        return;
      case 'stopped':
        chase.waitedFor += dt;
        if (view.carId !== null && (playerKmh > EVADE_KMH || Math.abs(view.s - chase.stoodS) > EVADE_M)) {
          // Driven off from the stop: lights back on and after him.
          chase.phase = 'chasing';
          chase.ignoredFor = 0;
          this.flee(chase);
          return;
        }
        if (chase.waitedFor > ASK_TIMEOUT_S) this.handOver();
        return;
      case 'cleared':
        if (gap > CLEAR_GAP_M || Math.abs(gap) > CLEAR_AWAY_M) {
          this.host.releasePolice(chase.carId);
          this.chase = null;
        }
        return;
    }
  }

  /** A flight from the police: the chase's roll decides what they do about it. */
  private flee(chase: Chase): void {
    if (!Number.isNaN(chase.fledAtS)) return;
    chase.fledAtS = this.playerS;
    this.forcedGiveUp = null;
    if (chase.givesUp) {
      this.notify('you fled the police — they are giving chase');
      return;
    }
    const heat = Math.min(POLICE_HEAT_MAX, this.heat + 1);
    this.setHeat(heat);
    this.notify(`you fled the police — they radioed ahead: wanted level ${heat}, every post stops you and a bigger fine`);
  }

  /** A fled chase that has run its course goes back on patrol; true when it has. */
  private chaseOver(chase: Chase): boolean {
    const run = Math.abs(this.playerS - chase.fledAtS);
    if (run < (chase.givesUp ? chase.giveUpAfterM : ESCALATED_CHASE_M)) return false;
    this.host.releasePolice(chase.carId);
    this.chase = null;
    this.notify(chase.givesUp ? 'the police gave up the chase' : 'the police broke off the chase — they are still looking for you');
    return true;
  }

  private promptFor(chase: Chase): string | null {
    switch (chase.phase) {
      case 'pulling-out':
      case 'chasing':
        return Number.isNaN(chase.fledAtS) ? 'POLICE — pull over onto the shoulder and stop' : 'POLICE — in pursuit';
      case 'stopping':
        return 'POLICE — stay where you are';
      case 'stopped':
        return 'police stop — [F] hand over your papers';
      default:
        return null;
    }
  }

  /**
   * The officer's check of the car he stopped and of the pack: the offences, the fine at
   * `1 + heat`, and what the pack's coins paid of it. Heat: cleared by a stop paid in
   * full, one level up for a rest left unpaid.
   */
  private inspect(chase: Chase): PoliceStopResult {
    const state = this.world.state;
    const items: string[] = [];
    let fine = 0;
    const speeding = chase.grounds.speedingKmh;
    if (speeding !== null) {
      fine += FINE_SPEEDING_BASE + Math.ceil((speeding - SPEED_LIMIT_KMH) / FINE_SPEEDING_STEP_KMH);
      items.push(`speeding ${Math.round(speeding)} km/h`);
    }
    // A flight he is stopped for at last is fined only when it escalated (he is wanted):
    // one who stops, however late, answers for what he was stopped for.
    if (chase.grounds.wanted) {
      fine += FINE_EVADING;
      items.push('fleeing the police');
    }
    if (chase.grounds.accident) {
      fine += FINE_ACCIDENT;
      items.push('a collision');
    }
    const car = this.lastCarId !== null ? state.cars[this.lastCarId] : undefined;
    if (car && !car.papers) {
      fine += FINE_NO_PAPERS;
      items.push('no papers for this car');
    }
    // THE WAYBILL is the boot and the cabin up to the body's contract slots; anything
    // past it, and anything carried in the pack, is undeclared.
    let undeclared = 0;
    for (const item of state.player.carried) if (item.type === 'contract_cargo') undeclared++;
    if (car) {
      let aboard = 0;
      for (const item of car.storage) if (item?.type === 'contract_cargo') aboard++;
      for (const item of car.cabin) if (item?.type === 'contract_cargo') aboard++;
      undeclared += Math.max(0, aboard - contractSlotsFor(car.modelId));
    }
    if (undeclared > 0) {
      fine += FINE_UNDECLARED * undeclared;
      items.push(`${undeclared} undeclared cargo`);
    }
    const heat = state.player.police.heat;
    if (fine > 0 && heat > 0) {
      fine *= 1 + heat;
      items.push(`×${1 + heat} wanted`);
    }
    const paid = Math.min(fine, coinsHeld(state));
    if (paid > 0) spendCoins(this.inventory, paid);
    if (paid < fine) this.setHeat(heat + 1);
    else if (heat > 0) this.setHeat(0);
    return { fine, paid, items };
  }
}
