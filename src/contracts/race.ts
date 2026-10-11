/**
 * THE RACE: three hurried rivals carry the same cargo to the race offer's finish,
 * the next courier or the one after (`ContractCargoItem.raceLegs`).
 *
 * Taking a race offer out of a courier starts it. Two rivals already left (one
 * `AHEAD_FAR_M`, one `AHEAD_NEAR_M` up the road), and the third leaves the courier
 * once the player is `LATE_DEPARTURE_M` gone, so it is behind him from the start.
 * Whoever hands the cargo in at the finish first wins; a rival "hands in" by pulling
 * into the courier's lay-by, standing beside the courier car for `HAND_IN_S` — a parcel
 * passed through a window, not the player's walk to his boot — and pulling back out.
 * The delivery always pays its sticker; winning adds one coin per leg (`winCoins`).
 * Slice rules: no save (a reload forgets the race).
 *
 * A RIVAL IS A GHOST UNTIL IT IS NEAR. Physics exists only `ROAD_PHYSICS_REACH_M` (world/ranges.ts) either
 * side of the player, so a rival out there is an arclength and a speed advanced
 * here, at the pace the autopilot's own `roadPaceCeiling` allows `RIVAL_MODE` on
 * that road. Inside the spawn band it is handed to the traffic stream as a real car
 * (`RoadTraffic.spawnRival`) driven by that autopilot mode; when the stream drops
 * it at the support edge, the ghost resumes from its last pose. A ghost's hand-in is
 * the same `HAND_IN_S` standing at the finish mark.
 *
 * THE HAND-IN IS THE STREAM'S LAY-BY STOP (`RoadTraffic.rivalHandIn`), asked for while
 * the entry slip is `HAND_IN_ASK_*_M` ahead: in from its own side, or across the
 * oncoming lanes when the courier stands on the far side — held in its lane until they
 * are clear, and waiting for them again on the way out. Its place is beside the
 * courier on the parking line, a car's width inside it; the lay-by is reserved while a
 * race finishes there (`reserveHandIn`), so nobody else parks in its way. A car held up
 * on the pad short of its place — the player's car left on the line — hands in from
 * where it stands and waits behind that car to leave. A courier with no lay-by, or a
 * rival that came into the physical window too late to pull in, stops in its lane
 * alongside the mark instead: a braking curve fed to the autopilot as its speed cap.
 * There is never a reverse.
 *
 * THE RIVALS FINISH THEIR RUN. The race is decided by the player's hand-in, by all
 * three rivals', or by his driving on past the finish; the rivals still on the road
 * then carry on to the courier, hand in (their place is announced, nothing is paid)
 * and only then go back to the stream. Those runs are kept apart from the race, so a
 * new race can be taken meanwhile; a run ends when its last rival has handed in, a
 * ghost of it more than `FINISHING_DROP_M` behind the player is dropped unseen, and
 * after `FINISHING_MAX_S` whatever is left goes back to the stream as it is.
 */
import { hash, hash01 } from '../core/rng';
import { shouldShelter } from '../vehicle/weatherpace';
import type { ContractCargoItem } from '../items/items';
import { AUTOPILOT_MODES, roadPaceCeiling } from '../vehicle/autopilot';
import { CAR_MODELS } from '../vehicle/carmodels';
import { courierStop } from '../world/couriers';
import type { RoadConditionBuffer } from '../world/gradient';
import { laybyNear, type Layby } from '../world/layby';
import type { DriveRoad } from '../world/road';
import type { RivalHandIn, RivalPose, RivalSpawn } from '../world/traffic';
import { SurfaceType } from '../core/surfaces';
import type { ContractPlace } from './types';


const RIVAL_COUNT = 3;
const AHEAD_FAR_M = 1500;
const AHEAD_NEAR_M = 560;
/** The third rival leaves the source once the player is this far up the road. */
const LATE_DEPARTURE_M = 560;
/**
 * WHERE A GHOST BECOMES A CAR: the traffic stream's own bands, so nothing appears
 * where it can be seen. Ahead, out to just inside the `ROAD_PHYSICS_REACH_M` (world/ranges.ts) support edge;
 * a ghost entering from beyond it is tried from there inward, every `SPAWN_RETRY_S`,
 * down to `AHEAD_POPIN_MIN_M`: one the player is catching that could not appear in
 * the stream's own 500 m band would otherwise be overtaken invisibly, and a car
 * turning up at 250 m is the lesser evil. Behind, the frantic traffic driver's rear
 * band, and only while the rival is closing: one put down behind a faster player only
 * falls out of the window again, and every such visit cost the ghost its speed
 * (measured: the late rival spawned standing at 560 m, was dropped at the edge 10 s
 * later, twice in a minute). A ghost never comes closer behind than this band; see
 * `advanceGhost`.
 */
const AHEAD_POPIN_MIN_M = 250;
const AHEAD_BAND_MAX_M = 760;
const BEHIND_BAND_MIN_M = 450;
const BEHIND_BAND_MAX_M = 600;
const BEHIND_CLOSING_MPS = 2.5;
const SPAWN_RETRY_S = 0.5;
/** Rest point past the receiving courier's arclength: alongside it, not short of it. */
const STOP_PAST_COURIER_M = 12;
const STOP_DECEL_MPS2 = 2.5;
/** Below the curve's tail, so a car a metre short does not crawl at nothing for ever. */
const STOP_CREEP_MPS = 1.5;
const ARRIVE_WINDOW_M = 25;
const ARRIVE_SPEED_MPS = 1;
/** A rival's hand-in: the parcel through the courier's window, seconds. */
const HAND_IN_S = 2;
/**
 * Road before the lay-by's entry slip from which a live rival asks to pull in. It asks
 * until it is past the pad's start; the stream says when it is too late
 * (`RoadTraffic.rivalHandIn`), and it then stops in its lane instead.
 */
const HAND_IN_ASK_MAX_M = 450;
/** See THE RIVALS FINISH THEIR RUN. */
const FINISHING_DROP_M = 2000;
const FINISHING_MAX_S = 600;
/**
 * How far past the receiving courier the player may drive before the race is called
 * lost. Enough to brake from speed, or to overshoot and turn back; beyond it he has
 * driven on, and a bead line pinned at the finish with nobody around was a race that
 * never ended. The cargo itself is untouched: any later courier still takes it.
 */
const FORFEIT_PAST_M = 600;
/**
 * The ghost's own driving. Acceleration is a stock catalogue car's on the flat; the
 * curve lookahead uses the rails' comfortable deceleration. Not yet calibrated against
 * the live driver; if a ghost visibly gains or loses on a live rival, this is the number.
 */
const GHOST_ACCEL_MPS2 = 1.5;
const GHOST_LOOK_DECEL_MPS2 = 2.5;
const GHOST_LOOK_MIN_M = 60;
const GHOST_LOOK_S = 3;
const GHOST_LOOK_SAMPLES = 4;
/**
 * Who drives the rivals. Frantic with the M30 swap simply flew off up the road; the
 * hurried driver in a stock car is the trial, on ambient hurried traffic's 95-115 km/h.
 */
const RIVAL_MODE = 'hurried';
const CAP_MIN_KMH = 95;
const CAP_SPAN_KMH = 20;
/**
 * A GHOST IS NOT A METRONOME. Every live driver's pace wanders — the road, the traffic
 * in front, the driver — and a ghost holding exactly its target was the rival nobody
 * could believe in: it closed on the finish at the same speed, metre for metre. So
 * each rival has its own pattern along the road: a slow swell of ±`GHOST_SWELL` over
 * `GHOST_SWELL_M`, and spells, about one stretch in six of `GHOST_HELD_M`, stuck behind
 * slower traffic at `GHOST_HELD_SHARE` of its pace.
 */
const GHOST_SWELL = 0.08;
const GHOST_SWELL_M = 1500;
const GHOST_HELD_M = 2500;
const GHOST_HELD_ABOVE = 0.55;
const GHOST_HELD_SHARE = 0.75;

/** Everyone's place on the race line, 0 at the source courier and 1 at the finish. */
export interface RaceProgress {
  player: number;
  readonly rivals: number[];
}

export function newRaceProgress(): RaceProgress {
  return { player: 0, rivals: new Array<number>(RIVAL_COUNT).fill(0) };
}

/**
 * `pulling-in` is the stream's lay-by stop (live only); `loading` the stand in the lane
 * or as a ghost; `leaving` a live car that has handed in and is pulling back out.
 */
type RivalPhase = 'waiting' | 'driving' | 'pulling-in' | 'loading' | 'leaving' | 'done';

interface Rival {
  readonly id: string;
  readonly label: string;
  readonly modelId: string;
  readonly capMps: number;
  s: number;
  speed: number;
  phase: RivalPhase;
  loadLeft: number;
  live: boolean;
  spawning: boolean;
  retryIn: number;
  /** It asked for the lay-by, or came too late to: either way, it does not ask again. */
  handInAsked: boolean;
  /** Seed of this rival's own pace pattern; see `ghostPaceShare`. */
  readonly paceSeed: number;
}

interface Race {
  readonly itemId: string;
  readonly cargo: ContractCargoItem;
  readonly sourceS: number;
  /** The receiving courier, and its lay-by (null without one). */
  readonly courierS: number;
  readonly layby: Layby | null;
  readonly stopS: number;
  readonly rivals: Rival[];
  /** Rivals handed in while the race was open: the player's place is one more. */
  delivered: number;
  /** Everyone handed in so far, the player included: the place of the next one. */
  finishers: number;
  /** Decided (see `end`); its rivals are finishing their run. */
  decided: boolean;
  /** Seconds since it was decided; see FINISHING_MAX_S. */
  decidedFor: number;
  /** Couriers to the finish, 1 or 2: also the coins a win pays. */
  readonly legs: 1 | 2;
}

/** The traffic stream's side of a rival: see `RoadTraffic`. */
export interface RivalHost {
  spawnRival(spec: RivalSpawn): Promise<boolean>;
  rivalPose(id: string, out: RivalPose): boolean;
  setRivalSpeedCap(id: string, mps: number): void;
  releaseRival(id: string): void;
  rivalHandIn(id: string, courierS: number, standS: number, parkS: number): boolean;
  reserveHandIn(courierS: number, reserved: boolean): void;
}

export interface RaceSnapshot {
  readonly itemId: string;
  readonly stopS: number;
  readonly delivered: number;
  readonly rivals: readonly {
    readonly id: string;
    readonly label: string;
    readonly s: number;
    readonly speedKmh: number;
    readonly phase: RivalPhase;
    readonly live: boolean;
  }[];
}

export class RivalRace {
  private race: Race | null = null;
  /** Decided races whose rivals are still on their way to hand in; see `end`. */
  private readonly finishing: Race[] = [];
  private serial = 0;
  private readonly pose: RivalPose = { s: 0, speed: 0, handIn: 'none' };
  /** Smoothed player pace along the road, m/s; a rear rival spawns only when closing. */
  private playerSpeed = 0;
  private playerS = 0;
  /** Whether the ghosts are waiting out the dust; see weatherpace.ts. */
  private ghostSheltering = false;
  private readonly condition: RoadConditionBuffer = {
    surface: SurfaceType.Asphalt, decay: 0, sandCover: 0, markings: 0,
  };

  constructor(
    private readonly seed: number,
    private readonly road: DriveRoad,
    private readonly host: RivalHost,
    private readonly prepareModel: (modelId: string) => Promise<void>,
    private readonly notify: (text: string) => void,
  ) {}

  /**
   * Called for every live cargo item BEFORE the contract runtime marks it started,
   * so `!started` away from the courier is exactly the moment it was first taken.
   */
  observe(item: ContractCargoItem, place: ContractPlace, playerS: number): void {
    if (this.race !== null || place === 'courier' || item.progress?.started) return;
    if (item.raceLegs === undefined) return;
    this.start(item, playerS);
  }

  /**
   * Coins the player wins by handing `itemId` in now: the race's legs while no rival
   * has handed in, else 0. Asked by the delivery before `playerDelivered` ends it.
   */
  winCoins(itemId: string): number {
    const race = this.race;
    return race !== null && race.itemId === itemId && race.delivered === 0 ? race.legs : 0;
  }

  /** The player handed `itemId` in: the race is decided by how many rivals already did. */
  playerDelivered(itemId: string): void {
    const race = this.race;
    if (race === null || race.itemId !== itemId) return;
    const place = race.delivered + 1;
    race.finishers++;
    this.end(
      place === 1
        ? `race won — ${race.legs === 1 ? 'a coin' : 'two coins'} in the courier's boot`
        : `race lost — you delivered ${ordinal(place)}`,
    );
  }

  fixedUpdate(dt: number, playerS: number): void {
    // A jump this large is a teleport, not motion; see the same guard in traffic.
    const advance = playerS - this.playerS;
    this.playerSpeed = dt > 0 && Math.abs(advance) < 50
      ? this.playerSpeed * 0.9 + (advance / dt) * 0.1
      : 0;
    this.playerS = playerS;
    // The weather stops a ghost exactly as it stops the live driver it stands for.
    this.ghostSheltering = shouldShelter(this.ghostSheltering);
    for (let i = this.finishing.length - 1; i >= 0; i--) {
      const race = this.finishing[i]!;
      race.decidedFor += dt;
      this.runRivals(race, dt, playerS);
      for (const rival of race.rivals) {
        // Out of sight behind him for good: nobody is watching that hand-in.
        if (rival.phase !== 'done' && !rival.live && !rival.spawning && playerS - rival.s > FINISHING_DROP_M) {
          rival.phase = 'done';
        }
      }
      if (race.decidedFor > FINISHING_MAX_S || race.rivals.every((rival) => rival.phase === 'done')) {
        this.retire(race);
        this.finishing.splice(i, 1);
      }
    }
    const race = this.race;
    if (race === null) return;
    this.runRivals(race, dt, playerS);
    // The race is decided without a hand-in from the player once every rival has
    // handed in, or once he has driven on past the finish.
    if (race.delivered >= RIVAL_COUNT) {
      this.end('race lost — all three rivals handed in first');
    } else if (playerS > race.stopS + FORFEIT_PAST_M) {
      this.end('race lost — you drove past the courier');
    }
  }

  private runRivals(race: Race, dt: number, playerS: number): void {
    for (const rival of race.rivals) {
      if (rival.phase === 'done') continue;
      let handIn: RivalHandIn = 'none';
      if (rival.live) {
        if (this.host.rivalPose(rival.id, this.pose)) {
          rival.s = this.pose.s;
          rival.speed = Math.max(0, this.pose.speed);
          handIn = this.pose.handIn;
        } else {
          // Dropped at the support edge: the ghost carries on from its last pose. One
          // that had handed in is done; one on its way in stands at the mark instead.
          rival.live = false;
          if (rival.phase === 'leaving') rival.phase = 'done';
          else if (rival.phase === 'pulling-in') rival.phase = 'driving';
          if (rival.phase === 'done') continue;
        }
      }
      if (rival.phase === 'waiting') {
        if (playerS - race.sourceS < LATE_DEPARTURE_M) continue;
        rival.phase = 'driving';
      }
      if (!rival.live) this.advanceGhost(rival, race, dt, playerS);
      this.serviceStop(rival, race, dt, handIn);
      // `serviceStop` may have finished it.
      if ((rival.phase as RivalPhase) === 'done') continue;
      if (rival.live) {
        this.host.setRivalSpeedCap(
          rival.id,
          rival.phase === 'driving'
            ? this.stopCap(rival, race)
            : rival.phase === 'loading' ? 0 : rival.capMps,
        );
      } else {
        this.trySpawn(rival, race, playerS, dt);
      }
    }
  }

  /**
   * Announces the result. The rivals still on the road finish their run (see THE RIVALS
   * FINISH THEIR RUN), apart from any race the player takes next.
   */
  private end(text: string): void {
    const race = this.race;
    if (race === null) return;
    this.notify(text);
    this.race = null;
    race.decided = true;
    if (race.rivals.every((rival) => rival.phase === 'done')) this.retire(race);
    else this.finishing.push(race);
  }

  /** Hands whatever of a race is still live back to the stream, and frees its lay-by. */
  private retire(race: Race): void {
    for (const rival of race.rivals) {
      if (rival.phase !== 'done' && rival.live) this.host.releaseRival(rival.id);
      rival.phase = 'done';
    }
    this.host.reserveHandIn(race.courierS, false);
  }

  /**
   * The HUD bead line: everyone's progress from the source courier (0) to the
   * receiving one (1), written into `out`; false with no race. A rival that handed
   * in sits at 1; one still waiting at the source sits at 0. No distances: only
   * where each is relative to the others and to the finish.
   */
  progress(playerS: number, out: RaceProgress): boolean {
    const race = this.race;
    if (race === null) return false;
    const finishS = race.stopS - STOP_PAST_COURIER_M;
    const span = Math.max(1, finishS - race.sourceS);
    out.player = Math.min(1, Math.max(0, (playerS - race.sourceS) / span));
    for (let i = 0; i < RIVAL_COUNT; i++) {
      const rival = race.rivals[i]!;
      out.rivals[i] = rival.phase === 'done' || rival.phase === 'leaving'
        ? 1
        : Math.min(1, Math.max(0, (rival.s - race.sourceS) / span));
    }
    return true;
  }

  snapshot(): RaceSnapshot | null {
    const race = this.race;
    if (race === null) return null;
    return {
      itemId: race.itemId,
      stopS: race.stopS,
      delivered: race.delivered,
      rivals: race.rivals.map((rival) => ({
        id: rival.id,
        label: rival.label,
        s: rival.s,
        speedKmh: rival.speed * 3.6,
        phase: rival.phase,
        live: rival.live,
      })),
    };
  }

  private start(item: ContractCargoItem, playerS: number): void {
    const sourceS = courierStop(this.seed, item.sourceCourierIndex).s;
    const legs = item.raceLegs ?? 1;
    const courierS = courierStop(this.seed, item.sourceCourierIndex + legs).s;
    const stopS = courierS + STOP_PAST_COURIER_M;
    const nearby = laybyNear(this.seed, courierS);
    const layby = nearby && Math.abs(nearby.s - courierS) < 1 ? nearby : null;
    const raceKey = this.serial++;
    const rivals: Rival[] = [];
    const starts = [playerS + AHEAD_FAR_M, playerS + AHEAD_NEAR_M, sourceS];
    for (let i = 0; i < RIVAL_COUNT; i++) {
      const h = hash01(item.generatedSeed, 0x52495630, i);
      const model = CAR_MODELS[Math.floor(h * CAR_MODELS.length) % CAR_MODELS.length]!;
      const capMps = (CAP_MIN_KMH + hash01(item.generatedSeed, 0x52495631, i) * CAP_SPAN_KMH) / 3.6;
      const s = Math.min(starts[i]!, stopS);
      const waiting = i === RIVAL_COUNT - 1;
      const rival: Rival = {
        id: `rival:${raceKey}:${i}`,
        label: model.label,
        modelId: model.id,
        capMps,
        s,
        speed: 0,
        phase: waiting ? 'waiting' : 'driving',
        loadLeft: HAND_IN_S,
        live: false,
        spawning: false,
        retryIn: 0,
        handInAsked: false,
        paceSeed: hash(item.generatedSeed, 0x52495632, i),
      };
      if (!waiting) rival.speed = this.ghostTarget(rival, stopS);
      rivals.push(rival);
      // Loaded now, so the stream can put the car down the step it is in the band.
      void this.prepareModel(model.id).catch(() => {});
    }
    this.race = {
      itemId: item.id,
      cargo: item,
      sourceS,
      courierS,
      layby,
      stopS,
      rivals,
      delivered: 0,
      finishers: 0,
      decided: false,
      decidedFor: 0,
      legs,
    };
    this.host.reserveHandIn(courierS, true);
    this.notify(
      `race on — three rivals carry the same ${item.cargoName} to ${legs === 1 ? 'the next courier' : 'the courier after next'}`,
    );
  }

  /**
   * The pace `RIVAL_MODE` gets from this road, under the rival's cap and the stop, at
   * this rival's own share of it here.
   */
  private ghostTarget(rival: Rival, stopS: number): number {
    let target = Math.min(rival.capMps, AUTOPILOT_MODES[RIVAL_MODE].cruiseMps)
      * ghostPaceShare(rival.paceSeed, rival.s);
    const look = Math.max(GHOST_LOOK_MIN_M, rival.speed * GHOST_LOOK_S);
    for (let k = 0; k < GHOST_LOOK_SAMPLES; k++) {
      const distance = (look * k) / (GHOST_LOOK_SAMPLES - 1);
      const s = Math.min(rival.s + distance, this.road.length);
      this.road.conditionAt(s, this.condition);
      const ceiling = roadPaceCeiling(RIVAL_MODE, this.condition, this.road.curvatureAt(s));
      target = Math.min(target, Math.sqrt(ceiling * ceiling + 2 * GHOST_LOOK_DECEL_MPS2 * distance));
    }
    return Math.min(target, this.stopCurve(rival.s, stopS));
  }

  private advanceGhost(rival: Rival, race: Race, dt: number, playerS: number): void {
    if (rival.phase !== 'driving') {
      rival.speed = 0;
      return;
    }
    // Sheltering from the dust: brakes to a stop wherever it is and waits.
    const target = this.ghostSheltering ? 0 : this.ghostTarget(rival, race.stopS);
    const delta = target - rival.speed;
    rival.speed = Math.max(0, rival.speed + Math.max(-GHOST_LOOK_DECEL_MPS2 * dt, Math.min(GHOST_ACCEL_MPS2 * dt, delta)));
    let s = Math.min(race.stopS, rival.s + rival.speed * dt);
    // NOTHING ARRIVES UNSEEN. A ghost coming up behind the player stops at the edge of
    // view and waits for its car there; it used to slip inside when the traffic refused
    // its site, and "handed in" invisibly beside a player waiting at the courier.
    const edge = playerS - BEHIND_BAND_MIN_M;
    if (rival.s <= edge && s > edge) s = edge;
    rival.s = s;
    // The ghost meets the mark exactly; it has no tyres to overshoot on.
    if (rival.s >= race.stopS) rival.speed = 0;
  }

  /**
   * The way in, the stand, the hand-in and the way back out. `handIn` is the stream's
   * account of a live rival's lay-by stop (`RivalHandIn`).
   */
  private serviceStop(rival: Rival, race: Race, dt: number, handIn: RivalHandIn): void {
    switch (rival.phase) {
      case 'driving': {
        const layby = race.layby;
        if (rival.live && layby !== null && !rival.handInAsked) {
          const ahead = Math.min(layby.sEntry, layby.sExit) - rival.s;
          if (rival.s > Math.min(layby.sPadStart, layby.sPadEnd)) {
            rival.handInAsked = true;
          } else if (
            ahead <= HAND_IN_ASK_MAX_M &&
            this.host.rivalHandIn(rival.id, race.courierS, layby.s, HAND_IN_S)
          ) {
            rival.handInAsked = true;
            rival.phase = 'pulling-in';
            return;
          }
        }
        if (rival.s >= race.stopS - ARRIVE_WINDOW_M && rival.speed < ARRIVE_SPEED_MPS) {
          rival.phase = 'loading';
          rival.loadLeft = HAND_IN_S;
        }
        return;
      }
      case 'pulling-in':
        // Given up on the way in (`RoadTraffic.endLayby`): it stops in its lane instead.
        if (handIn === 'none') rival.phase = 'driving';
        else if (handIn !== 'stopping') {
          this.handIn(rival, race);
          rival.phase = 'leaving';
          this.serviceStop(rival, race, dt, handIn);
        }
        return;
      case 'leaving':
        if (handIn === 'clear' || handIn === 'none') this.finish(rival);
        return;
      case 'loading':
        rival.loadLeft -= dt;
        if (rival.loadLeft > 0) return;
        this.handIn(rival, race);
        this.finish(rival);
        return;
      default:
        return;
    }
  }

  /** A rival's hand-in, counted and announced; see `Race.finishers`. */
  private handIn(rival: Rival, race: Race): void {
    race.finishers++;
    if (race.decided) {
      this.notify(`${rival.label} handed in — ${ordinal(race.finishers)}`);
      return;
    }
    race.delivered++;
    this.notify(`${rival.label} handed in the ${race.cargo.cargoName} — rival ${race.delivered} of ${RIVAL_COUNT} done`);
  }

  /** Its run is over; it drives on as ordinary traffic, or vanishes as a ghost. */
  private finish(rival: Rival): void {
    rival.phase = 'done';
    if (rival.live) this.host.releaseRival(rival.id);
  }

  private stopCurve(s: number, stopS: number): number {
    const remaining = stopS - s;
    if (remaining <= 0) return 0;
    return Math.max(STOP_CREEP_MPS, Math.sqrt(2 * STOP_DECEL_MPS2 * remaining));
  }

  private stopCap(rival: Rival, race: Race): number {
    return Math.min(rival.capMps, this.stopCurve(rival.s, race.stopS));
  }

  private trySpawn(rival: Rival, race: Race, playerS: number, dt: number): void {
    if (rival.spawning) return;
    rival.retryIn -= dt;
    if (rival.retryIn > 0) return;
    const offset = rival.s - playerS;
    const inBand = offset >= 0
      ? offset >= AHEAD_POPIN_MIN_M && offset <= AHEAD_BAND_MAX_M
      : -offset >= BEHIND_BAND_MIN_M && -offset <= BEHIND_BAND_MAX_M &&
        rival.speed > this.playerSpeed + BEHIND_CLOSING_MPS;
    if (!inBand) return;
    rival.retryIn = SPAWN_RETRY_S;
    rival.spawning = true;
    const cargo: ContractCargoItem = {
      ...race.cargo,
      id: `${race.cargo.id}:${rival.id}`,
      progress: { ...race.cargo.progress },
    };
    void this.host
      .spawnRival({
        id: rival.id,
        modelId: rival.modelId,
        s: rival.s,
        speed: rival.speed,
        // Its own ceiling; the stop curve is applied by `fixedUpdate` from the next step.
        speedCap: rival.capMps,
        mode: RIVAL_MODE,
        cargo,
      })
      .then((placed) => {
        rival.spawning = false;
        // A run that ended while the model loaded hands the car straight back.
        const tracked = this.race === race || this.finishing.includes(race);
        if (placed && (!tracked || rival.phase === 'done')) this.host.releaseRival(rival.id);
        else if (placed) rival.live = true;
      });
  }
}

/** Smooth 1-D value noise in [-1, 1] at `x`, lattice spacing 1. */
function smoothNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const t = x - i;
  const u = t * t * (3 - 2 * t);
  const a = hash01(seed, i) * 2 - 1;
  const b = hash01(seed, i + 1) * 2 - 1;
  return a + (b - a) * u;
}

/** This rival's share of its pace at arclength `s`; see GHOST_SWELL. */
function ghostPaceShare(seed: number, s: number): number {
  const share = 1 + GHOST_SWELL * smoothNoise(seed, s / GHOST_SWELL_M);
  return smoothNoise(seed ^ 0x48454c44, s / GHOST_HELD_M) > GHOST_HELD_ABOVE
    ? Math.min(share, GHOST_HELD_SHARE)
    : share;
}

function ordinal(place: number): string {
  return place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`;
}
