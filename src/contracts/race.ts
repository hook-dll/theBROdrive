/**
 * THE RACE: three hurried rivals carry the same cargo to the next courier.
 *
 * Taking a raceable cargo out of a courier starts it. Two rivals already left (one
 * `AHEAD_FAR_M`, one `AHEAD_NEAR_M` up the road), and the third leaves the courier
 * once the player is `LATE_DEPARTURE_M` gone, so it is behind him from the start.
 * Whoever hands the cargo in at the next courier first wins; a rival "hands in" by
 * stopping in its lane alongside that courier and standing there `LOAD_S`, the time
 * the player spends walking his own parcel to the boot. Slice rules: no save (a
 * reload forgets the race), win or lose only.
 *
 * A RIVAL IS A GHOST UNTIL IT IS NEAR. Physics exists only `PHYSICS_REACH_M` either
 * side of the player, so a rival out there is an arclength and a speed advanced
 * here, at the pace the autopilot's own `roadPaceCeiling` allows `RIVAL_MODE` on
 * that road. Inside the spawn band it is handed to the traffic stream as a real car
 * (`RoadTraffic.spawnRival`) driven by that autopilot mode; when the stream drops
 * it at the support edge, the ghost resumes from its last pose.
 *
 * NO MANOEUVRE AT THE COURIER. A rival never leaves the asphalt: the courier stands
 * 9.5 m off the axis and the poles at 6 m, so a car that stops in its own lane and
 * drives straight on cannot wedge against either. The stop is a braking curve fed to
 * the autopilot as its speed cap, and the hand-in counts wherever it comes to rest
 * past `ARRIVE_WINDOW_M` short of the mark; there is never a reverse.
 */
import { hash01 } from '../core/rng';
import type { ContractCargoItem } from '../items/items';
import { AUTOPILOT_MODES, roadPaceCeiling } from '../vehicle/autopilot';
import { CAR_MODELS } from '../vehicle/carmodels';
import { courierStop } from '../world/couriers';
import type { RoadConditionBuffer } from '../world/gradient';
import type { DriveRoad } from '../world/road';
import type { RivalPose, RivalSpawn } from '../world/traffic';
import { SurfaceType } from '../core/surfaces';
import type { ContractKind, ContractPlace } from './types';

/**
 * Kinds a rival can carry exactly as the player does: an item in the boot, accepted
 * by the very next courier. Not the ones that bring a trailer or a second car (a
 * rival cannot tow), need a part or a photograph found on the way, or refuse the
 * next courier (`long_haul`).
 */
const RACEABLE_KINDS: ReadonlySet<ContractKind> = new Set<ContractKind>([
  'parcel',
  'heavy_crate',
  'fragile_radio',
  'urgent_film',
  'medical_thermo',
  'one_tank',
  'dont_overheat',
  'clean_delivery',
  'bald_tyres',
  'sand_route',
  'desert_slalom',
  'night_courier',
]);

const RIVAL_COUNT = 3;
const AHEAD_FAR_M = 1500;
const AHEAD_NEAR_M = 560;
/** The third rival leaves the source once the player is this far up the road. */
const LATE_DEPARTURE_M = 560;
/**
 * WHERE A GHOST BECOMES A CAR: the traffic stream's own bands, so nothing appears
 * where it can be seen. Ahead, `SPAWN_MIN_M` out to just inside the `PHYSICS_REACH_M`
 * support edge. Behind, the frantic traffic driver's rear band, and only while the rival is
 * closing: one put down behind a faster player only falls out of the window again,
 * and every such visit cost the ghost its speed (measured: the late rival spawned
 * standing at 560 m, was dropped at the edge 10 s later, twice in a minute).
 */
const AHEAD_BAND_MIN_M = 500;
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
/** A rival's hand-in: about the player's walk round to his own boot and back. */
const LOAD_S = 20;
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

type RivalPhase = 'waiting' | 'driving' | 'loading' | 'done';

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
}

interface Race {
  readonly itemId: string;
  readonly cargo: ContractCargoItem;
  readonly sourceS: number;
  readonly stopS: number;
  readonly rivals: Rival[];
  delivered: number;
}

/** The traffic stream's side of a rival: see `RoadTraffic`. */
export interface RivalHost {
  spawnRival(spec: RivalSpawn): Promise<boolean>;
  rivalPose(id: string, out: RivalPose): boolean;
  setRivalSpeedCap(id: string, mps: number): void;
  releaseRival(id: string): void;
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
  private serial = 0;
  private readonly pose: RivalPose = { s: 0, speed: 0 };
  /** Smoothed player pace along the road, m/s; a rear rival spawns only when closing. */
  private playerSpeed = 0;
  private playerS = 0;
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
    if (!RACEABLE_KINDS.has(item.contractKind)) return;
    this.start(item, playerS);
  }

  /** The player handed `itemId` in: the race is decided by how many rivals already did. */
  playerDelivered(itemId: string): void {
    const race = this.race;
    if (race === null || race.itemId !== itemId) return;
    const place = race.delivered + 1;
    this.notify(place === 1 ? 'race won — you delivered first' : `race lost — you delivered ${ordinal(place)}`);
    for (const rival of race.rivals) if (rival.live) this.host.releaseRival(rival.id);
    this.race = null;
  }

  fixedUpdate(dt: number, playerS: number): void {
    // A jump this large is a teleport, not motion; see the same guard in traffic.
    const advance = playerS - this.playerS;
    this.playerSpeed = dt > 0 && Math.abs(advance) < 50
      ? this.playerSpeed * 0.9 + (advance / dt) * 0.1
      : 0;
    this.playerS = playerS;
    const race = this.race;
    if (race === null) return;
    for (const rival of race.rivals) {
      if (rival.phase === 'done') continue;
      if (rival.live) {
        if (this.host.rivalPose(rival.id, this.pose)) {
          rival.s = this.pose.s;
          rival.speed = Math.max(0, this.pose.speed);
        } else {
          // Dropped at the support edge: the ghost carries on from its last pose.
          rival.live = false;
        }
      }
      if (rival.phase === 'waiting') {
        if (playerS - race.sourceS < LATE_DEPARTURE_M) continue;
        rival.phase = 'driving';
      }
      if (!rival.live) this.advanceGhost(rival, race, dt);
      this.serviceStop(rival, race, dt);
      if (rival.live) {
        this.host.setRivalSpeedCap(rival.id, rival.phase === 'driving' ? this.stopCap(rival, race) : 0);
      } else {
        this.trySpawn(rival, playerS, dt);
      }
    }
  }

  /**
   * The HUD strip: the player's place and the road left to the receiving courier,
   * e.g. `RACE 2/4 · 3.4 km`; null with no race. Place counts every rival that has
   * handed in or is further up the road. Rounded so the text changes rarely.
   */
  statusText(playerS: number): string | null {
    const race = this.race;
    if (race === null) return null;
    let place = 1;
    for (const rival of race.rivals) {
      if (rival.phase === 'done' || (rival.phase !== 'waiting' && rival.s > playerS)) place++;
    }
    const left = Math.max(0, race.stopS - STOP_PAST_COURIER_M - playerS);
    const distance = left >= 1000 ? `${(left / 1000).toFixed(1)} km` : `${Math.round(left / 10) * 10} m`;
    return `RACE ${place}/${RIVAL_COUNT + 1} · ${distance}`;
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
    const stopS = courierStop(this.seed, item.sourceCourierIndex + 1).s + STOP_PAST_COURIER_M;
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
        loadLeft: LOAD_S,
        live: false,
        spawning: false,
        retryIn: 0,
      };
      if (!waiting) rival.speed = this.ghostTarget(rival, stopS);
      rivals.push(rival);
      // Loaded now, so the stream can put the car down the step it is in the band.
      void this.prepareModel(model.id).catch(() => {});
    }
    this.race = { itemId: item.id, cargo: item, sourceS, stopS, rivals, delivered: 0 };
    this.notify(`race on — three rivals carry the same ${item.cargoName} to the next courier`);
  }

  /** The pace `RIVAL_MODE` gets from this road, under the rival's cap and the stop. */
  private ghostTarget(rival: Rival, stopS: number): number {
    let target = Math.min(rival.capMps, AUTOPILOT_MODES[RIVAL_MODE].cruiseMps);
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

  private advanceGhost(rival: Rival, race: Race, dt: number): void {
    if (rival.phase !== 'driving') {
      rival.speed = 0;
      return;
    }
    const target = this.ghostTarget(rival, race.stopS);
    const delta = target - rival.speed;
    rival.speed = Math.max(0, rival.speed + Math.max(-GHOST_LOOK_DECEL_MPS2 * dt, Math.min(GHOST_ACCEL_MPS2 * dt, delta)));
    rival.s = Math.min(race.stopS, rival.s + rival.speed * dt);
    // The ghost meets the mark exactly; it has no tyres to overshoot on.
    if (rival.s >= race.stopS) rival.speed = 0;
  }

  /** Arrival, the stand while it loads, and the hand-in. */
  private serviceStop(rival: Rival, race: Race, dt: number): void {
    if (rival.phase === 'driving') {
      if (rival.s >= race.stopS - ARRIVE_WINDOW_M && rival.speed < ARRIVE_SPEED_MPS) {
        rival.phase = 'loading';
        rival.loadLeft = LOAD_S;
      }
      return;
    }
    if (rival.phase !== 'loading') return;
    rival.loadLeft -= dt;
    if (rival.loadLeft > 0) return;
    rival.phase = 'done';
    race.delivered++;
    this.notify(`${rival.label} handed in the ${race.cargo.cargoName} — rival ${race.delivered} of ${RIVAL_COUNT} done`);
    // Its race is over; it drives on as ordinary traffic, or vanishes as a ghost.
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

  private trySpawn(rival: Rival, playerS: number, dt: number): void {
    if (rival.spawning) return;
    rival.retryIn -= dt;
    if (rival.retryIn > 0) return;
    const offset = rival.s - playerS;
    const inBand = offset >= 0
      ? offset >= AHEAD_BAND_MIN_M && offset <= AHEAD_BAND_MAX_M
      : -offset >= BEHIND_BAND_MIN_M && -offset <= BEHIND_BAND_MAX_M &&
        rival.speed > this.playerSpeed + BEHIND_CLOSING_MPS;
    if (!inBand) return;
    rival.retryIn = SPAWN_RETRY_S;
    rival.spawning = true;
    const race = this.race!;
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
        // A race decided while the model loaded hands the car straight back.
        if (placed && (this.race !== race || rival.phase === 'done')) this.host.releaseRival(rival.id);
        else if (placed) rival.live = true;
      });
  }
}

function ordinal(place: number): string {
  return place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`;
}
