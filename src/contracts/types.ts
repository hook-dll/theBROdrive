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
 * `kind` ids are saved: never rename one.
 */

import type { CarState, WorldDelta } from '../game/state';
import type { ContractCargoItem } from '../items/items';
import type { StickerKind } from '../items/stickercatalog';

/** The catalog kinds. English snake_case ids, saved, never renamed. */
export type ContractKind =
  | 'parcel'
  | 'heavy_crate'
  | 'fragile_radio'
  | 'trailer_equipment'
  | 'oversize'
  | 'towing'
  | 'car_transfer';

/** Every declared kind id, for the save validator. */
export const CONTRACT_KIND_IDS: Record<ContractKind, true> = {
  parcel: true,
  heavy_crate: true,
  fragile_radio: true,
  trailer_equipment: true,
  oversize: true,
  towing: true,
  car_transfer: true,
};

/** Where a contract cargo item currently is. */
export type ContractPlace = 'courier' | 'hand' | 'car' | 'loose';

/**
 * Everything a kind remembers between ticks. All fields exist on every kind so the
 * save validator can rebuild the record without knowing the kind: a fresh contract
 * is `defaultProgress()`.
 */
export interface ContractProgress {
  /** Set the first time the cargo leaves its source courier: the contract clock. */
  started: boolean;
  /** Physical quality, 1..0 (fragile radio). */
  condition: number;
  /**
   * A kind's own flag. Towing reuses it as a "the bar was seen at least once" latch,
   * so its release later reads as the tow being let go.
   */
  heat: number;
  /** A disqualifying event happened; the special reward is gone, delivery still pays. */
  violated: boolean;
  /** Short status shown after the cargo name, or '' for none. */
  statusText: string;
}

/** A fresh, unstarted contract with every field at rest. */
export function defaultProgress(): ContractProgress {
  return {
    started: false,
    condition: 1,
    heat: 0,
    violated: false,
    statusText: '',
  };
}

/**
 * What a kind may ask about the car carrying it this tick. Built by the composition
 * root from `CarState` for the durable numbers and from the live `Vehicle` for the
 * ones only physics produces (impacts, rollover).
 */
export interface ContractCarTelemetry {
  /** Largest unexplained speed loss this step, m/s (0 on an ordinary step). */
  readonly impactMps: number;
  /** Downward speed killed by the ground this step, m/s (0 when nothing landed). */
  readonly landingMps: number;
  /** The chassis up-axis points well below the sky. */
  readonly upsideDown: boolean;
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
  /**
   * The cargo being ticked. A kind needs its own id here — a world object the
   * contract owns is named after the offer (`generatedSeed`), and the seed is on
   * the item, not on the progress record.
   */
  readonly item: ContractCargoItem;
  /** The carrying car's telemetry, null when the cargo is not in a car. */
  readonly car: ContractCarTelemetry | null;
  /** True on the tick the cargo left a hand or a car for the ground. */
  readonly droppedThisTick: boolean;
  /**
   * A live look at any car the contract names by id — the stranded car of a tow.
   * Distinct from `car` above, which is the car CARRYING the cargo: towing watches
   * a second car the contract owns, whose id comes from `contractCarId(item)`. Null
   * when no such car is in the world.
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
  /** The chassis up-axis points well below the sky. */
  readonly upsideDown: boolean;
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
  /** Structural world changes: `trailer_remove`, `car_remove`. */
  readonly deltas?: readonly WorldDelta[];
}

/** What a kind needs at the moment of delivery to judge its condition. */
export interface DeliveryContext {
  /** The cargo being delivered, so a condition can name its own car or part. */
  readonly item: ContractCargoItem;
  /** The world at the accepting courier; see `DeliveryProbe`. */
  readonly probe: DeliveryProbe;
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
  /** Progress a freshly generated offer starts with, from the offer seed. */
  readonly initialProgress: (seed: number) => ContractProgress;
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

/** Clamp a fraction to 0..1, tolerating a corrupt value. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
