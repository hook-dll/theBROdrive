/**
 * The physical contract system's shared shapes.
 *
 * A contract is not a journal entry: it is a `contract_cargo` item that exists in
 * one physical place (a courier boot, a hand, a car boot, the ground). What makes
 * two of them different is `contractKind`, and every kind's behaviour lives in its
 * own module under `kinds/` behind `ContractKindDef` (registry.ts). This file holds
 * only what all of them share: the kind ids, the progress record that is saved ON
 * the item, and the per-tick world view the kinds read.
 *
 * PROGRESS IS SAVED ON THE ITEM. A contract's progress travels with it through
 * every physical location and through save/load without a parallel world table, and
 * `itemLabel` can read it with no world access, so the HUD and the prompts always
 * show the live state ("fragile radio · 82%"). The contract runtime is the only
 * writer; the save validator rebuilds the record from known keys and clamps it.
 *
 * `kind` ids are saved: never rename one; wave-2 kinds are declared here up front so
 * their modules can be added without touching the wave-1 ones.
 */

import type { CarState, WorldDelta } from '../game/state';
import type { ContractCargoItem, Item } from '../items/items';
import type { StickerKind } from '../items/stickercatalog';
import type { PhotoSubjectsProvider } from './photosubjects';
import type { ContractGate } from './gates';

/** The twenty catalog kinds. English snake_case ids, saved, never renamed. */
export type ContractKind =
  | 'parcel'
  | 'heavy_crate'
  | 'fragile_radio'
  | 'urgent_film'
  | 'medical_thermo'
  | 'trailer_equipment'
  | 'oversize'
  | 'one_tank'
  | 'dont_overheat'
  | 'clean_delivery'
  | 'bald_tyres'
  | 'sand_route'
  | 'desert_slalom'
  | 'long_haul'
  | 'night_courier'
  | 'convoy'
  | 'towing'
  | 'car_transfer'
  | 'part_order'
  | 'photo_errand';

/**
 * Every declared kind id, for the save validator. The registry only knows the ones
 * with a module, but a saved item must load in a build that has not implemented its
 * kind yet: `contractKindDef` then falls back to the ordinary parcel's behaviour.
 */
export const CONTRACT_KIND_IDS: Record<ContractKind, true> = {
  parcel: true,
  heavy_crate: true,
  fragile_radio: true,
  urgent_film: true,
  medical_thermo: true,
  trailer_equipment: true,
  oversize: true,
  one_tank: true,
  dont_overheat: true,
  clean_delivery: true,
  bald_tyres: true,
  sand_route: true,
  desert_slalom: true,
  long_haul: true,
  night_courier: true,
  convoy: true,
  towing: true,
  car_transfer: true,
  part_order: true,
  photo_errand: true,
};

/** Where a contract cargo item currently is. */
export type ContractPlace = 'courier' | 'hand' | 'car' | 'loose';

/**
 * Everything a kind remembers between ticks. All fields exist on every kind so the
 * save validator can rebuild the record without knowing the kind: a fresh contract
 * is `defaultProgress()`, and each kind's `initialProgress(seed, offer)` overrides what
 * its offer needs (a soft deadline, the named subject of an errand).
 */
export interface ContractProgress {
  /** Set the first time the cargo leaves its source courier: the contract clock. */
  started: boolean;
  /** `WorldState.playedSeconds` at that moment. */
  startedAtS: number;
  /** Absolute soft deadline in `playedSeconds`, or 0 when the kind has none. */
  deadlineS: number;
  /** The offer's own deadline length in seconds, seeded at generation. */
  softDeadlineS: number;
  /** Physical quality, 1..0 (fragile radio). */
  condition: number;
  /** Accumulated heat above the safe band, degree-seconds (medical thermo box). */
  heat: number;
  /** Seconds spent exposed to daylight (night courier). */
  exposureS: number;
  /** A disqualifying event happened; the special reward is gone, delivery still pays. */
  violated: boolean;
  /** A soft deadline passed (urgent film). */
  late: boolean;
  /**
   * Gates of a gate contract (sand route, slalom) passed IN ORDER. Only the next
   * expected gate counts, so this is also the index of the one being asked for.
   */
  gatesPassed: number;
  /** `playedSeconds` the first gate was passed, 0 before the section started. */
  gateStartedAtS: number;
  /** `playedSeconds` the last gate was passed, 0 until the section is complete. */
  gateFinishedAtS: number;
  /** The slalom's own seeded section limit, seconds; 0 for kinds that have none. */
  gateTimeLimitS: number;
  /** The slalom's car came back onto the asphalt after the last gate. */
  gateReturned: boolean;
  /** Short status shown after the cargo name, or '' for none. */
  statusText: string;
  /**
   * Stable id of the photo subject the errand names (kind 20), or ''. Saved with the
   * rest of the record so the note carries its subject through every physical move.
   */
  subjectId: string;
}

/** A fresh, unstarted contract with every field at rest. */
export function defaultProgress(): ContractProgress {
  return {
    started: false,
    startedAtS: 0,
    deadlineS: 0,
    softDeadlineS: 0,
    condition: 1,
    heat: 0,
    exposureS: 0,
    violated: false,
    late: false,
    gatesPassed: 0,
    gateStartedAtS: 0,
    gateFinishedAtS: 0,
    gateTimeLimitS: 0,
    gateReturned: false,
    statusText: '',
    subjectId: '',
  };
}

/**
 * What a kind may ask about the car carrying it this tick. Built by the composition
 * root from `CarState` for the durable numbers and from the live `Vehicle` for the
 * ones only physics produces (impacts, rollover).
 */
export interface ContractCarTelemetry {
  readonly fuelLitres: number;
  /** Fuel rose since the last tick: a can was poured into this car. */
  readonly refuelled: boolean;
  readonly engineOverheating: boolean;
  readonly engineRunning: boolean;
  /** Largest unexplained speed loss this step, m/s (0 on an ordinary step). */
  readonly impactMps: number;
  /** Downward speed killed by the ground this step, m/s (0 when nothing landed). */
  readonly landingMps: number;
  /** The chassis up-axis points well below the sky. */
  readonly upsideDown: boolean;
  /** Absolute position of the carrying car, so a kind can place it in the world. */
  readonly absoluteX: number;
  readonly absoluteZ: number;
  /**
   * At least one loaded wheel is on the asphalt right now. Read from the live wheel
   * surfaces, so it is the same contact the tyre model uses, and it answers the one
   * question the slalom asks at the end of its section: did the car come back?
   */
  readonly onRoad: boolean;
  /** The trailer coupled to the carrying car, if any. */
  readonly trailerId: string | null;
  /**
   * Largest unexplained speed loss the coupled trailer suffered this step, m/s.
   * Measured the same way the car's own `impactMps` is: horizontal speed the
   * trailer's brakes and rolling resistance cannot explain. A blow that jolts the
   * load without slowing the trailer is below this floor and is not reported.
   */
  readonly trailerImpactMps: number;
  /** The coupled trailer is on its side or its roof. */
  readonly trailerUpsideDown: boolean;
}

export interface ContractTickContext {
  readonly dt: number;
  /** Monotonic game seconds (`WorldState.playedSeconds`). */
  readonly nowS: number;
  /**
   * The cargo being ticked. A kind needs its own id here — a world object the
   * contract owns is named after the offer (`generatedSeed`), and the seed is on
   * the item, not on the progress record.
   */
  readonly item: ContractCargoItem;
  /** Game-clock seconds within the day, 0 at midnight. */
  readonly timeOfDay: number;
  /** Seconds in a full in-game day (`DAY_LENGTH`). */
  readonly dayLength: number;
  /** Air temperature this tick, degrees C (`ambientAirC`). */
  readonly ambientC: number;
  readonly place: ContractPlace;
  /**
   * The gate sequence of a gate contract (kinds 12/13), rebuilt by the composition
   * root from the offer seed and the road geometry, or null for every other kind.
   * Cached there, so a kind may hold the reference for the tick. The same list backs
   * the gate posts the player drives at.
   */
  readonly gatesFor?: (item: ContractCargoItem) => readonly ContractGate[] | null;
  /** The carrying car's telemetry, null when the cargo is not in a car. */
  readonly car: ContractCarTelemetry | null;
  /** True on the tick the cargo left a hand or a car for the ground. */
  readonly droppedThisTick: boolean;
  /**
   * A live look at any car the contract names by id — the stranded car of a tow,
   * the escort of a convoy. Distinct from `car` above, which is the car CARRYING
   * the cargo: these kinds watch a second car the contract owns, whose id comes
   * from `contractCarId(item)`. Null when no such car is in the world.
   */
  readonly carById?: (carId: string) => ContractCarSnapshot | null;
}

/**
 * What a kind may ask about another car the contract owns, by id. Built by the
 * composition root from the saved `CarState` and, when it is materialised, its live
 * `Vehicle` — so a moving car answers from physics rather than from a pose up to a
 * transform-emit interval stale.
 */
export interface ContractCarSnapshot {
  readonly absoluteX: number;
  readonly absoluteZ: number;
  /** Largest unexplained speed loss this step, m/s (0 on an ordinary step). */
  readonly impactMps: number;
  /** The chassis up-axis points well below the sky. */
  readonly upsideDown: boolean;
  /** Cosmetic shell damage 0..1; the arrival measure the transfer kind uses. */
  readonly scratches: number;
  /** The car this one is towed by, or null. The live coupling, read from state. */
  readonly towedBy: string | null;
}

/**
 * A read-only look at the physical world at the courier that would accept the
 * cargo, built by the delivery code and handed to BOTH the prompt and the commit.
 * That is what keeps a prompt honest: the sentence the player reads while aiming is
 * produced by the same function F will run.
 *
 * Every getter is a live read. A trailer or car that is materialised answers from
 * its physics body; a dormant one answers from its saved pose, so a contract object
 * three kilometres away still resolves.
 */
export interface DeliveryProbe {
  /** Index of the courier being delivered to. */
  readonly targetCourierIndex: number;
  /** Absolute parking position of that courier. */
  readonly courierX: number;
  readonly courierZ: number;
  /** The car the player is driving, or null on foot. */
  readonly drivingCarId: string | null;
  /** Boot cells of the accepting courier (world override or its procedural default). */
  readonly courierCells: readonly (Item | null)[];
  /** The player's pack. */
  readonly carried: readonly Item[];
  /** Absolute X/Z of a trailer, live or saved; null when no such trailer exists. */
  readonly trailerPosition: (trailerId: string) => { readonly x: number; readonly z: number } | null;
  /**
   * Absolute X/Z of a car, live when it is materialised and from its saved pose
   * otherwise. A moving towed car answers from its body: the saved pose is up to a
   * transform-emit interval stale, which at road speed is metres.
   */
  readonly carPosition: (carId: string) => { readonly x: number; readonly z: number } | null;
  /** Saved car by id, or null. Pose, damage and boot contents all read from it. */
  readonly car: (carId: string) => CarState | null;
}

/**
 * The world changes a kind makes on a successful delivery, applied by the
 * interaction code in the same transaction as `courier_storage` (which writes the
 * envelope and the completed id FIRST, so a crash between the two halves cannot
 * pay twice).
 */
export interface DeliveryEffect {
  /** Items deleted from the accepting courier's boot, by id. */
  readonly consumeCourierItems?: readonly string[];
  /** Items deleted from the player's pack, by id. */
  readonly consumeCarried?: readonly string[];
  /** Structural world changes: `trailer_remove`, `car_remove`. */
  readonly deltas?: readonly WorldDelta[];
}

/** What a kind needs at the moment of delivery to judge its condition. */
export interface DeliveryContext {
  /** The cargo being delivered, so a condition can name its own car or part. */
  readonly item: ContractCargoItem;
  readonly nowS: number;
  readonly timeOfDay: number;
  readonly dayLength: number;
  /** The world at the accepting courier; see `DeliveryProbe`. */
  readonly probe: DeliveryProbe;
}

/**
 * What a kind is given when its offer is generated. The world seed and the courier
 * index are what a kind needs to name something that exists on the road ahead of it,
 * and `photoSubjects` resolves the roadside subject list for a range without the kind
 * importing the world's placement code.
 */
export interface ContractOfferContext {
  readonly seed: number;
  /** Index of the courier whose boot holds this offer. */
  readonly courierIndex: number;
  /** Subjects on the road in a range, from the world seed (see photosubjects.ts). */
  readonly photoSubjects: PhotoSubjectsProvider;
}

/** The registry entry for one kind: how it is offered, tracked and rewarded. */
export interface ContractKindDef {
  readonly kind: ContractKind;
  /** Relative chance of being drawn as a courier offer. Parcel is the common one. */
  readonly weight: number;
  /** Cargo names this kind draws from, per offer. */
  readonly offerNames: readonly string[];
  /**
   * The sticker this kind pays when its own condition held. `null` means the kind
   * has no signature and always pays the offer's seed-random reward (parcel).
   */
  readonly signatureSticker: StickerKind | null;
  /**
   * Progress a freshly generated offer starts with. `offer` carries the world seed,
   * the courier index and the roadside subject provider, so a kind can name something
   * that exists on the road ahead of its courier.
   */
  readonly initialProgress: (seed: number, offer: ContractOfferContext) => ContractProgress;
  /** Cargo mass this kind adds to a car or a pair of hands, kg. Omitted = 12 kg. */
  readonly massKg?: (seed: number) => number;
  /**
   * Why this courier may not accept the cargo, or null. Called after the base rule
   * (a courier never signs cargo from itself or further down the road).
   */
  readonly acceptRefusal?: (item: ContractCargoItem, probe: DeliveryProbe) => string | null;
  /** Advance progress one tick. Mutate `progress` in place. */
  readonly step: (progress: ContractProgress, ctx: ContractTickContext) => void;
  /** Whether the special condition held at delivery. */
  readonly conditionMet: (progress: ContractProgress, ctx: DeliveryContext) => boolean;
  /**
   * The world change this delivery also performs: consuming the trailer, car or
   * part the contract is about. Applied only after the courier accepted the cargo,
   * in the same transaction as the envelope.
   */
  readonly onDelivered?: (
    item: ContractCargoItem,
    probe: DeliveryProbe,
    delivery: DeliveryContext,
  ) => DeliveryEffect | null;
}

// A 24-hour game day. Night runs 20:00 -> 06:00, which is the band the sky darkens
// into and the band a light-sensitive cargo is meant to travel in.
export const NIGHT_START_FRACTION = 0.83;
export const NIGHT_END_FRACTION = 0.25;

export function isNightTime(timeOfDay: number, dayLength: number): boolean {
  if (!(dayLength > 0) || !Number.isFinite(timeOfDay)) return false;
  const f = ((timeOfDay / dayLength) % 1 + 1) % 1;
  return f >= NIGHT_START_FRACTION || f < NIGHT_END_FRACTION;
}

export function isDaylightTime(timeOfDay: number, dayLength: number): boolean {
  return !isNightTime(timeOfDay, dayLength);
}

/** Clamp a fraction to 0..1, tolerating a corrupt value. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Minutes:seconds text for a remaining time, used by the urgent-film label. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
