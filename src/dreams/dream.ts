/**
 * Dreams: the mission layer over the endless road.
 *
 * A dream is a stretch of the existing world with a start, a goal and a corridor. It
 * does not change how the world is built: the road, desert, traffic and car are the
 * free drive's own. What it adds is read-only — where the player is along the road —
 * and the two outcomes that read decides: arriving (stopped in the goal's parking
 * pocket) or waking (left the corridor for long enough).
 *
 * Start and goal are PARKING POCKETS on the lay-bys of roadside stops: the spot deep
 * on the pad where the stop's courier would park (`laybyCourierLateral`). On a dream's
 * two stops no courier stands (`PoiProvider`'s courier-free stops): the pocket takes its
 * place. The parking line passing traffic uses runs nearer the road and stays clear.
 *
 * Pure: no three.js, no Rapier, no DOM. The composition root feeds it the road
 * projection and the car's speed each fixed step.
 *
 * Coordinates are the road's: `s` is arclength in metres, `lateral` signed metres from
 * the centreline (`Road.project`). Driving back towards the start is allowed; only
 * leaving the corridor counts.
 */

import { hash } from '../core/rng';
import { defaultProgress, NO_COURIER } from '../contracts/types';
import type { ContractCargoItem } from '../items/items';
import { stickerKindForSeed } from '../items/stickercatalog';
import { laybyCourierLateral, laybysBetween, type Layby } from '../world/layby';
import { placeNameAt } from '../world/placenames';
import type { WeatherKind } from '../world/weather';
import type { MirageStretch } from '../render/mirage-schedule';

export interface DreamDef {
  /** Stable: the progress record (dreams/progress.ts) is keyed on it. Never rename. */
  readonly id: string;
  readonly title: string;
  /** What the menu card says, in the player's words. */
  readonly brief: string;
  /** World seed: a dream is the same road every time it is dreamt. */
  readonly seed: number;
  /** The start is the first suitable lay-by at or past this arclength, metres. */
  readonly startNearS: number;
  /** The goal is the first suitable lay-by at least this many road metres on. */
  readonly lengthM: number;
  /** In-game clock at the start, fraction of the day (0.5 = noon). */
  readonly dayFraction: number;
  /** Car model id from the catalogue. */
  readonly modelId: string;
  /**
   * What the dream asks to be carried, or null for a run with nothing to deliver. It
   * waits in the start terminal's window; the dream ends when it goes into the goal's.
   */
  readonly cargoName: string | null;
  /**
   * The cargo's look when it is not a parcel (items.ts `ContractCargoItem.shape`): a
   * `carpet` goes only across the rear bench. Absent: a parcel.
   */
  readonly cargoShape?: 'carpet';
  /**
   * How easily the cargo is hurt: 1 an ordinary parcel, 3 glass. Knocks to the car wear
   * it this many times harder, and a harsh moment with it aboard wears it too.
   */
  readonly fragility: number;
  /** The sky for the whole dream, held still: no front arrives mid-run. */
  readonly weather: WeatherKind;
  /** Whether police posts stand along the road. */
  readonly police: boolean;
  /**
   * Share of this machine's traffic ceiling the road carries, 0..1 (`TRAFFIC_CAPS`):
   * the dream sets the mood, the processor still sets the limit.
   */
  readonly traffic: number;
  /**
   * Apparitions met between the two bays, from the free drive's one deck; 0 for none
   * (GAME_DESIGN.md §15.9). Clamped to what the route has room for, one at a time.
   */
  readonly mirages: number;
  /** The clock on the run, or null for a dream with no hurry. */
  readonly deadline: DreamDeadline | null;
}

/**
 * How long the run may take, from leaving the start bay to the goal (the cargo in the
 * terminal, or the car parked when there is none). Given as the average speed it asks
 * for, so it follows the route the lay-bys make; `DEADLINE_SLACK_S` more for parking
 * and the terminal.
 *
 * SOFT: a late arrival still counts, the card says by how much. HARD: at the time the
 * dream ends, delivered or not (GAME_DESIGN.md §6.1).
 */
export interface DreamDeadline {
  readonly kind: 'soft' | 'hard';
  readonly averageKmh: number;
}

/** Seconds a deadline allows over the drive itself: parking, the boot, the dial. */
export const DEADLINE_SLACK_S = 60;

/** The run's time limit, seconds from leaving the start bay. */
export function deadlineSeconds(deadline: DreamDeadline, lengthM: number): number {
  return lengthM / (deadline.averageKmh / 3.6) + DEADLINE_SLACK_S;
}

/**
 * The campaign's dreams, in order: each opens once the one before it is done (see the
 * catalogue, GAME_DESIGN.md §16.7).
 */
export const DREAMS: readonly DreamDef[] = [
  {
    id: 'first-delivery',
    title: 'First delivery',
    brief: 'Take a parcel to the next stop down the road. No hurry.',
    seed: 0x0d4ea301,
    // The first kilometres: the desert's ordinary colour, near the house the drive knows.
    startNearS: 3_000,
    lengthM: 7_000,
    dayFraction: 10 / 24,
    modelId: 'kit_vaz2106',
    cargoName: 'medical parcel',
    fragility: 1,
    weather: 'clear',
    police: false,
    traffic: 0.5,
    mirages: 0,
    deadline: null,
  },
  {
    id: 'fragile-lamp',
    title: 'Handle with care',
    brief: 'A glass lamp, two stops down the road. It does not like bumps or hard braking.',
    seed: 0x0d4ea301,
    startNearS: 30_000,
    lengthM: 14_000,
    dayFraction: 17 / 24,
    modelId: 'kit_vaz2121',
    cargoName: 'glass lamp',
    fragility: 3,
    weather: 'heat',
    police: false,
    traffic: 0.5,
    mirages: 1,
    deadline: null,
  },
  {
    id: 'sunset-transfer',
    title: 'A car to Grandad',
    brief: 'Drive Grandad\'s Volga home before dark. Nothing to carry, nowhere to be.',
    seed: 0x0d4ea301,
    startNearS: 50_000,
    lengthM: 7_000,
    dayFraction: 19 / 24,
    modelId: 'kit_gaz24',
    cargoName: null,
    fragility: 1,
    weather: 'clear',
    police: false,
    traffic: 0.25,
    mirages: 1,
    deadline: null,
  },
  {
    id: 'urgent-noon',
    title: 'Before the lunch break',
    brief: 'Spare parts the garage wants before its lunch break. Late is better than never, but be quick.',
    seed: 0x0d4ea301,
    startNearS: 62_000,
    lengthM: 14_000,
    dayFraction: 12 / 24,
    modelId: 'kit_vaz2108',
    cargoName: 'box of spare parts',
    fragility: 1,
    weather: 'clear',
    police: true,
    traffic: 0.8,
    mirages: 1,
    deadline: { kind: 'soft', averageKmh: 75 },
  },
  {
    id: 'night-carpet',
    title: 'Grandma\'s carpet',
    brief: 'A rolled carpet to Grandma, after dark. It goes across the back seat, nowhere else, and it does not like hard braking.',
    seed: 0x0d4ea301,
    startNearS: 90_000,
    lengthM: 7_000,
    dayFraction: 21.5 / 24,
    modelId: 'kit_vaz2107',
    cargoName: 'rolled carpet',
    cargoShape: 'carpet',
    fragility: 1,
    weather: 'clear',
    police: false,
    traffic: 0.3,
    mirages: 2,
    deadline: null,
  },
];

export function dreamById(id: string): DreamDef | null {
  return DREAMS.find((dream) => dream.id === id) ?? null;
}

/** Id of the dream's parcel. One dream runs per page, so one id serves every dream. */
export const DREAM_CARGO_ID = 'dream:cargo';

/** Id of the car a dream lends. One dream runs per page. */
export const DREAM_CAR_ID = 'car:dream';

/**
 * The dream's parcel as an ordinary contract cargo item, so the boot, the hands, the
 * ground and the item meshes all treat it like any courier's parcel. `NO_COURIER` keeps
 * every courier from signing it and the HUD from pointing at one.
 */
export function dreamCargo(def: DreamDef, cargoName: string): ContractCargoItem {
  return {
    type: 'contract_cargo',
    id: DREAM_CARGO_ID,
    sourceCourierIndex: NO_COURIER,
    contractKind: 'parcel',
    cargoName,
    rewardStickerKind: stickerKindForSeed(def.seed),
    generatedSeed: def.seed,
    progress: defaultProgress(),
    ...(def.cargoShape ? { shape: def.cargoShape } : {}),
  };
}

/** A parking pocket: road-frame centre on its lay-by, the car parked along the road. */
export interface DreamPocket {
  readonly layby: Layby;
  readonly s: number;
  /** Signed, `Road.offsetPoint` frame. */
  readonly lateral: number;
}

export interface DreamRoute {
  readonly start: DreamPocket;
  readonly finish: DreamPocket;
  /** Road metres from the start pocket to the goal pocket. */
  readonly lengthM: number;
  /** The two stops' names (world/placenames.ts), as their signposts read. */
  readonly startName: string;
  readonly goalName: string;
}

/** Half the pocket's marked length along the road, metres: a 6.4 m bay. */
export const POCKET_HALF_LENGTH_M = 3.2;
/** Half its marked width, metres: a 2.7 m bay, a car with room to open a door. */
export const POCKET_HALF_WIDTH_M = 1.35;
/**
 * A passenger car's half extents, metres, for "the car has wholly left the bay": a
 * Volga is 4.74 m long and 1.80 m wide; the bound covers every car a dream lends.
 */
const CAR_HALF_LENGTH_M = 2.4;
const CAR_HALF_WIDTH_M = 0.95;
/**
 * Narrowest pad a pocket may go on, metres from the road edge out. The parking line
 * stands 3 m in (`laybyParkLateral`); a car on it reaches 3.95 m, and the bay's inner
 * edge lies 4.15 m in from the outer edge (courier inset 1.4 + half width 1.35 + the
 * bay itself), so 7.5 m of pad keeps the two apart.
 */
const MIN_PAD_WIDTH_M = 7.5;
/** Road searched for a suitable lay-by before giving up, metres. */
const POCKET_SEARCH_M = 60_000;
const POCKET_SEARCH_STEP_M = 2_000;

/**
 * The first lay-by at or past `fromS` wide enough for a pocket beside its parking line.
 * Either side of the road: from the left one the car pulls out across the oncoming lane.
 */
function pocketFrom(seed: number, fromS: number): DreamPocket {
  for (let from = fromS; from < fromS + POCKET_SEARCH_M; from += POCKET_SEARCH_STEP_M) {
    let best: Layby | null = null;
    for (const layby of laybysBetween(seed, from, from + POCKET_SEARCH_STEP_M)) {
      if (layby.s < fromS) continue;
      if (layby.padOuter - layby.padInner < MIN_PAD_WIDTH_M) continue;
      if (best === null || layby.s < best.s) best = layby;
    }
    if (best !== null) return { layby: best, s: best.s, lateral: laybyCourierLateral(best) };
  }
  throw new Error(`no lay-by for a dream pocket within ${POCKET_SEARCH_M} m of ${fromS}`);
}

/** Where a dream starts and ends. Pure in the def. */
export function dreamRoute(def: DreamDef): DreamRoute {
  const start = pocketFrom(def.seed, def.startNearS);
  const finish = pocketFrom(def.seed, start.s + def.lengthM);
  return {
    start,
    finish,
    lengthM: finish.s - start.s,
    startName: placeNameAt(def.seed, start.s),
    goalName: placeNameAt(def.seed, finish.s),
  };
}

/** The roadside stops a dream's pockets stand on: no courier parks there. */
export function dreamStops(route: DreamRoute): ReadonlySet<number> {
  return new Set([route.start.layby.poiIndex, route.finish.layby.poiIndex]);
}

/**
 * Road kept clear of apparitions after the start bay and before the goal, metres: the
 * first minute is for settling in, the last for finding the bay.
 */
const MIRAGE_MARGIN_M = 1_500;

/** Where a dream's mirages may stand and how many (render/mirage-schedule.ts). */
export function dreamMirageStretch(def: DreamDef, route: DreamRoute): MirageStretch {
  return { fromS: route.start.s + MIRAGE_MARGIN_M, toS: route.finish.s - MIRAGE_MARGIN_M, count: def.mirages };
}

/**
 * Whether a road-frame point is inside the pocket's marked frame grown by `along` and
 * `across` metres. Grown by a car's half extents it answers "is any of the car inside".
 */
export function inPocket(p: DreamPocket, s: number, lateral: number, along = 0, across = 0): boolean {
  return Math.abs(s - p.s) <= POCKET_HALF_LENGTH_M + along && Math.abs(lateral - p.lateral) <= POCKET_HALF_WIDTH_M + across;
}

/**
 * How far from the centreline the dream holds, metres. Wide on purpose: the verge, a
 * lay-by, a roadside stop and a short run onto the sand are all part of the drive.
 */
export const CORRIDOR_HALF_WIDTH_M = 70;
/** Road behind the start that still belongs to the dream, metres. */
export const BEHIND_START_M = 400;
/** Road past the goal that still belongs to the dream: room to overshoot and turn. */
export const PAST_GOAL_M = 600;
/** Below this speed the car counts as stopped, m/s. */
export const STOPPED_MPS = 1.5;
/** A dream with nothing to deliver ends after the car has stood in the goal pocket this long, seconds. */
export const ARRIVE_HOLD_S = 1.5;
/** Seconds outside the corridor before the dream ends. */
export const WAKE_SECONDS = 8;
/** Back inside, the fade recovers this many times faster than it built. */
const WAKE_RECOVERY = 3;

/**
 * `late`: a hard deadline ran out before the goal. `woken`: he left the dream.
 */
export type DreamPhase = 'prepare' | 'driving' | 'arrived' | 'woken' | 'late';

/**
 * Where the dream's cargo is: still in the start terminal's window, aboard (in the
 * dream car's boot or in his hands), or anywhere else (dropped, left in another car).
 */
export type CargoPlace = 'window' | 'aboard' | 'away';

/** The dream car's pose on the road, fed each step. */
export interface DreamCarPose {
  readonly s: number;
  readonly lateral: number;
  readonly speedMps: number;
}

export class DreamRun {
  private phaseValue: DreamPhase = 'prepare';
  /** 0 = fully in the dream, 1 = awake. */
  private wakeValue = 0;
  private outsideValue = false;
  private cargoValue: CargoPlace = 'window';
  private parkedValue = false;
  private stoppedFor = 0;
  private elapsed = 0;
  private toGoValue: number;
  /** The run's time limit, seconds; Infinity without a deadline. */
  readonly limitSeconds: number;

  constructor(
    readonly def: DreamDef,
    readonly route: DreamRoute,
  ) {
    this.toGoValue = route.lengthM;
    this.limitSeconds = def.deadline ? deadlineSeconds(def.deadline, route.lengthM) : Infinity;
  }

  /** Seconds left before the deadline; negative once past it, Infinity without one. */
  get secondsLeft(): number {
    return this.limitSeconds - this.elapsed;
  }

  /** Whether the run is (or arrived) past its deadline. */
  get overdue(): boolean {
    return this.elapsed > this.limitSeconds;
  }

  get phase(): DreamPhase {
    return this.phaseValue;
  }

  get wake(): number {
    return this.wakeValue;
  }

  /** Outside the corridor right now. */
  get outside(): boolean {
    return this.outsideValue;
  }

  get cargo(): CargoPlace {
    return this.cargoValue;
  }

  /** The dream car stands still in the goal pocket after the run began. */
  get parked(): boolean {
    return this.parkedValue;
  }

  /** Signed road metres from the player to the goal; negative once past it. */
  get toGo(): number {
    return this.toGoValue;
  }

  /** Seconds since the car left the start pocket. */
  get driveSeconds(): number {
    return this.elapsed;
  }

  /** Whether the run has begun: the car has wholly left the start pocket. */
  get departed(): boolean {
    return this.phaseValue !== 'prepare';
  }

  /** Close enough to the goal pocket to say «park here»: within about 13 m along the road. */
  get atGoal(): boolean {
    return Math.abs(this.toGoValue) <= POCKET_HALF_LENGTH_M + CAR_HALF_LENGTH_M * 4;
  }

  /**
   * One fixed step. `s`/`lateral`: the road projection of the car he sits in, else of
   * himself; the corridor reads it. `car`: the dream car's pose, null while it is not
   * materialised. `inCar`: he sits in the dream car.
   */
  update(dt: number, s: number, lateral: number, car: DreamCarPose | null, inCar: boolean, cargo: CargoPlace): void {
    if (this.phaseValue !== 'prepare' && this.phaseValue !== 'driving') return;
    this.cargoValue = cargo;
    const { start, finish } = this.route;
    this.toGoValue = finish.s - s;

    // The checkpoint: driving it, the car's last corner has crossed the bay's frame.
    if (this.phaseValue === 'prepare' && inCar && car && !inPocket(start, car.s, car.lateral, CAR_HALF_LENGTH_M, CAR_HALF_WIDTH_M)) {
      this.phaseValue = 'driving';
    }
    if (this.phaseValue === 'driving') {
      this.elapsed += dt;
      if (this.def.deadline?.kind === 'hard' && this.overdue) {
        this.phaseValue = 'late';
        return;
      }
    }

    this.outsideValue =
      Math.abs(lateral) > CORRIDOR_HALF_WIDTH_M ||
      s < start.s - BEHIND_START_M ||
      s > finish.s + PAST_GOAL_M;
    if (this.outsideValue) {
      this.wakeValue = Math.min(1, this.wakeValue + dt / WAKE_SECONDS);
      if (this.wakeValue >= 1) {
        this.phaseValue = 'woken';
        return;
      }
    } else {
      this.wakeValue = Math.max(0, this.wakeValue - (dt * WAKE_RECOVERY) / WAKE_SECONDS);
    }

    // Parked: the car's centre inside the goal's frame, standing still.
    this.parkedValue =
      this.phaseValue === 'driving' &&
      car !== null &&
      inPocket(finish, car.s, car.lateral) &&
      Math.abs(car.speedMps) < STOPPED_MPS;
    // With nothing to deliver, standing there is the end; cargo ends at the terminal.
    if (this.def.cargoName === null && this.parkedValue) {
      this.stoppedFor += dt;
      if (this.stoppedFor >= ARRIVE_HOLD_S) this.phaseValue = 'arrived';
    } else {
      this.stoppedFor = 0;
    }
  }

  /**
   * The cargo went into the goal terminal's window. Refused (false) unless the car
   * stands parked in the goal pocket: the run is a drive, not a walk with a parcel.
   */
  deliver(): boolean {
    if (!this.parkedValue || this.phaseValue !== 'driving') return false;
    this.phaseValue = 'arrived';
    return true;
  }
}

/** Domain tag for the PIN roll. */
const PIN_TAG = 0x50494e31; // 'PIN1'

/** The dream's parcel PIN: six digits from the dream's seed, the same every night. */
export function dreamPin(def: DreamDef): string {
  return String(hash(def.seed, PIN_TAG, 0) % 1_000_000).padStart(6, '0');
}

/**
 * Horizontal acceleration a passenger notices, m/s². Ordinary driving — pulling away, a
 * firm stop at a junction, a brisk bend — stays under it.
 */
const COMFORT_EASY_MPS2 = 2.5;
/**
 * A HARSH moment begins above this, m/s² (0.36 g: a hard stop or a corner taken too
 * fast), and ends when the car is back under `COMFORT_EASY_MPS2`.
 */
const COMFORT_HARSH_MPS2 = 3.5;
/** Comfort lost per (m/s² above easy) · second: a five-second 0.5 g stop costs about a fifth. */
const COMFORT_PER_EXCESS = 1 / 60;
/** Smoothing of the measured acceleration, seconds: a road seam is not a swerve. */
const ACCEL_SMOOTH_S = 0.25;
/**
 * Parcel condition lost per unit of shell damage the car takes while it is aboard: the
 * same knocks that scratch the paint (`SCRATCH_*` in vehicle/vehicletuning.ts), so a
 * 5 m/s shunt costs it about a fifth, as it costs the courier's fragile radio.
 */
const PARCEL_WEAR_PER_SCRATCH = 1;
/**
 * What one harsh moment with the cargo aboard costs it per unit of fragility above an
 * ordinary parcel's 1: nothing for a box of papers, 6% at fragility 3 (a lamp, glass).
 */
const HARSH_WEAR_PER_FRAGILITY = 0.03;
/**
 * What the cargo coming off a seat in the cabin costs it per unit of fragility
 * (vehicle/cabin.ts `CabinRide`): a box of papers 5%, a glass lamp 15%.
 */
const FALL_WEAR_PER_FRAGILITY = 0.05;

/** What a run left behind, read by the closing card. */
export interface TripSummary {
  readonly seconds: number;
  readonly metres: number;
  /** 0..1: the parcel as it arrived. */
  readonly parcel: number;
  /** 0..1: how the ride felt. */
  readonly comfort: number;
  readonly harshMoments: number;
  /** Shell damage the car took on the run, 0..1 (`CarState.scratches` gained). */
  readonly carDamage: number;
  readonly fuelLitres: number;
  /** Times the cargo came off its seat in the cabin. */
  readonly falls: number;
}

/**
 * The run, measured: fed each fixed step from the moment the car leaves the start
 * pocket. Pure; the composition root reads the car's velocity, shell and tank.
 */
export class TripRecord {
  private lastVx = 0;
  private lastVz = 0;
  private primed = false;
  private accel = 0;
  private harsh = false;
  private harshCount = 0;
  private comfortLoss = 0;
  private parcelWear = 0;
  private damage = 0;
  private lastScratches = -1;
  private firstFuel = -1;
  private lastFuel = 0;
  private fallCount = 0;

  /** `fragility`: the cargo's, 1 for an ordinary parcel (`DreamDef.fragility`). */
  constructor(private readonly fragility: number) {}

  /**
   * One step of driving. `vx`/`vz`: the car's horizontal velocity, m/s; `scratches` and
   * `fuelLitres` its state; `cargoAboard`: the parcel rides in it or in his hands.
   */
  step(dt: number, vx: number, vz: number, scratches: number, fuelLitres: number, cargoAboard: boolean): void {
    if (this.primed && dt > 0) {
      const ax = (vx - this.lastVx) / dt;
      const az = (vz - this.lastVz) / dt;
      this.accel += (Math.hypot(ax, az) - this.accel) * Math.min(1, dt / ACCEL_SMOOTH_S);
      this.comfortLoss += Math.max(0, this.accel - COMFORT_EASY_MPS2) * dt * COMFORT_PER_EXCESS;
      if (!this.harsh && this.accel > COMFORT_HARSH_MPS2) {
        this.harsh = true;
        this.harshCount++;
        if (cargoAboard) this.parcelWear += HARSH_WEAR_PER_FRAGILITY * (this.fragility - 1);
      } else if (this.harsh && this.accel < COMFORT_EASY_MPS2) {
        this.harsh = false;
      }
    }
    this.primed = true;
    this.lastVx = vx;
    this.lastVz = vz;
    // Only gains: the sponge polishing scratches off is no knock.
    const gained = this.lastScratches < 0 ? 0 : Math.max(0, scratches - this.lastScratches);
    this.lastScratches = scratches;
    this.damage += gained;
    if (cargoAboard) this.parcelWear += gained * PARCEL_WEAR_PER_SCRATCH * this.fragility;
    if (this.firstFuel < 0) this.firstFuel = fuelLitres;
    this.lastFuel = fuelLitres;
  }

  /** The cargo came off its seat in the cabin, or was knocked about on it. */
  fell(): void {
    this.fallCount++;
    this.parcelWear += FALL_WEAR_PER_FRAGILITY * this.fragility;
  }

  summary(seconds: number, metres: number): TripSummary {
    return {
      seconds,
      metres,
      parcel: Math.max(0, 1 - this.parcelWear),
      comfort: Math.max(0, 1 - this.comfortLoss),
      harshMoments: this.harshCount,
      carDamage: Math.min(1, this.damage),
      fuelLitres: this.firstFuel < 0 ? 0 : Math.max(0, this.firstFuel - this.lastFuel),
      falls: this.fallCount,
    };
  }
}
