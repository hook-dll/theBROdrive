import type { PartInstance } from '../parts/registry';
import { variant } from '../parts/registry';
import { stickerDef, type StickerKind } from './stickercatalog';
import { carPaintSwatch } from '../vehicle/carpaint';
import type { ContractKind, ContractProgress } from '../contracts/types';

/**
 * Everything the player can hold, carry or use.
 *
 * Parts, tools, fuel cans, weapons and ammo all flow through one representation so
 * the interaction and inventory code has exactly one shape to handle. A rifle is
 * not a special case of anything; it is an item whose primary use fires.
 */

/**
 * The one cleaning tool. There used to be a brush for rust and coarse dirt and a sponge
 * to finish; the sponge now does everything, and it wears out (`ToolItem.capacity`).
 */
export type ToolKind = 'sponge';
export type WeaponKind = 'rifle' | 'shotgun';
export type ShadeTint = 'green' | 'yellow' | 'red';

/** A professional camera takes five exposures before its roll is spent. */
export const CAMERA_FRAME_LIMIT = 5;

/**
 * Everything that can be poured into a car.
 *
 * One union rather than "fuel" plus a special case each for the others: the pour
 * mechanic is identical for all three, and the only thing the kind decides is which
 * reservoir it goes into.
 */
export type FluidKind = 'petrol' | 'water' | 'oil';

export interface ToolItem {
  readonly type: 'tool';
  readonly id: string;
  readonly tool: ToolKind;
  /** Share of the sponge's life left, 0..1 where 1 is new; 0 is used up. */
  integrity: number;
  /**
   * Everything it can take off over its whole life, as a sum of fractions of a full
   * layer: dirt, rust and scratches all count. 0.45..0.65 for every sponge made.
   */
  readonly capacity: number;
}

/** A new sponge cleans away between 45% and 65% before it is spent. */
export const SPONGE_CAPACITY_MIN = 0.45;
export const SPONGE_CAPACITY_MAX = 0.65;
/** Below this share of its life a sponge is spent: dirty, and no use to anyone. */
export const SPONGE_SPENT = 1e-4;

/** A sponge; `capacityRoll` is a 0..1 roll for how much it can clean over its life. */
export function makeSponge(id: string, capacityRoll: number, integrity = 1): ToolItem {
  return {
    type: 'tool',
    id,
    tool: 'sponge',
    integrity,
    capacity: SPONGE_CAPACITY_MIN + (SPONGE_CAPACITY_MAX - SPONGE_CAPACITY_MIN) * capacityRoll,
  };
}

export function spongeSpent(item: ToolItem): boolean {
  return item.integrity <= SPONGE_SPENT;
}

export interface PartItem {
  readonly type: 'part';
  readonly id: string;
  readonly part: PartInstance;
}

export interface FluidCanItem {
  readonly type: 'fluid_can';
  readonly id: string;
  readonly fluid: FluidKind;
  readonly capacity: number;
  /** Litres currently inside. */
  litres: number;
}

/**
 * An aerosol of car paint, in one of the factory colours (vehicle/carpaint.ts).
 * Held against a car's body it lays that colour over whatever is there; one can is
 * a little more than one full coat.
 */
export interface SprayCanItem {
  readonly type: 'spray_can';
  readonly id: string;
  /** 0xRRGGBB, always one of `CAR_PAINTS`. */
  readonly paint: number;
  /** Paint left, 0..1 of a full can. */
  charge: number;
}

export interface WeaponItem {
  readonly type: 'weapon';
  readonly id: string;
  readonly weapon: WeaponKind;
  /** Rounds in the weapon right now. */
  loaded: number;
  readonly magazine: number;
  /** Seconds between shots. */
  readonly cycleTime: number;
  /** Muzzle velocity, m/s. Determines lead and drop on distant birds. */
  readonly muzzleVelocity: number;
  /** Spread half-angle in radians when fired from the hip. */
  readonly hipSpread: number;
}

export interface AmmoItem {
  readonly type: 'ammo';
  readonly id: string;
  readonly forWeapon: WeaponKind;
  count: number;
}

export interface QuarryItem {
  readonly type: 'quarry';
  readonly id: string;
  readonly species: string;
  readonly mass: number;
}

export interface BubbleGumItem {
  readonly type: 'bubble_gum';
  readonly id: string;
  /** Remaining pieces in this pack. A fresh gas-station pack contains five. */
  charges: number;
}

/** One sealed dose: the bottle visibly contains two pills and is consumed whole. */
export interface MedicineItem {
  readonly type: 'medicine';
  readonly id: string;
}

export interface BinocularItem {
  readonly type: 'binoculars';
  readonly id: string;
}

export interface TorchlightItem {
  readonly type: 'torchlight';
  readonly id: string;
}

export interface SunShadesItem {
  readonly type: 'sun_shades';
  readonly id: string;
  readonly tint: ShadeTint;
}

export interface CameraItem {
  readonly type: 'camera';
  readonly id: string;
  /** Exposures still available on this individual camera. */
  framesRemaining: number;
}

export interface PhotographItem {
  readonly type: 'photograph';
  readonly id: string;
  /** Downscaled JPEG captured from the rendered frame; persisted with the item. */
  readonly imageDataUrl: string;
}

export interface FootballItem {
  readonly type: 'football';
  readonly id: string;
}

export interface PocketWatchItem {
  readonly type: 'pocket_watch';
  readonly id: string;
}

/**
 * The card the player starts with: a printed postcard from home, its message on one
 * face and a photograph of the house by the sea on the other.
 *
 * It carries no state of its own. The words are the `postcard.message` string (i18n/strings.ts)
 * and the card is drawn from it at build time, so the item is only a reason for the
 * pack to hold a piece of card that E raises to the eye and turns over.
 */
export interface PostcardItem {
  readonly type: 'postcard';
  readonly id: string;
}

/**
 * A race prize. Coins STACK: one meeting another — picked up into a pack that holds
 * one, or taken from a cell while holding one — becomes a single coin carrying the
 * sum, so `value` is what it is worth and a pile never costs more than one slot.
 */
export interface CoinItem {
  readonly type: 'coin';
  readonly id: string;
  readonly value: number;
}

export type { StickerKind } from './stickercatalog';

/** A physical task object. Its source index is the complete delivery contract. */
export interface ContractCargoItem {
  readonly type: 'contract_cargo';
  readonly id: string;
  readonly sourceCourierIndex: number;
  /** Which catalog kind this is; see contracts/types.ts. */
  readonly contractKind: ContractKind;
  readonly cargoName: string;
  /**
   * The ordinary sticker a delivery pays. Kinds with a signature reward pay that
   * instead when their condition held, so this is the fallback for every kind.
   */
  readonly rewardStickerKind: StickerKind;
  readonly generatedSeed: number;
  /** Cargo mass, kg, when the kind carries more than the usual 12 (heavy crate). */
  massKg?: number;
  /**
   * A race offer: how many couriers on its destination is, 1 or 2. The cargo is
   * signed only from there on, three rivals carry the same thing there, and the
   * player handing in first wins this many coins. Absent on an ordinary trip.
   */
  raceLegs?: 1 | 2;
  /**
   * Contract state, saved on the item so it travels with every physical move.
   * The contract runtime (`contracts/runtime.ts`) is its only writer.
   */
  progress: ContractProgress;
}

/** Signed physical reward, consumed only when its sticker is confirmed on a car. */
export interface StickerEnvelopeItem {
  readonly type: 'sticker_envelope';
  readonly id: string;
  readonly stickerKind: StickerKind;
  readonly completedContractId: string;
}

export type Item =
  | ToolItem
  | PartItem
  | FluidCanItem
  | SprayCanItem
  | WeaponItem
  | AmmoItem
  | QuarryItem
  | BubbleGumItem
  | MedicineItem
  | BinocularItem
  | TorchlightItem
  | SunShadesItem
  | CameraItem
  | PhotographItem
  | FootballItem
  | PocketWatchItem
  | PostcardItem
  | CoinItem
  | ContractCargoItem
  | StickerEnvelopeItem;

/**
 * Density, kg/litre. Petrol is the light one; water is water and oil is a shade
 * under it.
 *
 * Exported because mass is summed in two places — the pack's own carried weight in
 * `itemMass`, and each reservoir's contribution to the car in `Vehicle.computeStats`
 * — and a car whose tank weighed a different petrol per litre than the can that
 * filled it would be two different games.
 */
export const FLUID_DENSITY: Record<FluidKind, number> = {
  petrol: 0.75,
  water: 1.0,
  oil: 0.87,
};

/**
 * One litre format for every container, `12.3 L`.
 *
 * A can used to round to whole litres while a reservoir readout showed a tenth, so
 * pouring 4.4 L out of a can labelled `5 L` into a tank that then read `4.4/40.0 L`
 * looked like the game had lost half a litre. It had not: the two were printing the
 * same fluid to different precision.
 */
export function litreText(litres: number): string {
  return `${litres.toFixed(1)} L`;
}

/** Kinds that bring a trailer or a second car: the courier's fourth, "big haul" offer. */
const HAUL_KINDS: Readonly<Partial<Record<ContractKind, true>>> = {
  trailer_equipment: true,
  oversize: true,
  towing: true,
  car_transfer: true,
};

/** True for a kind that is a haul rather than something carried in a boot. */
export function isHaulKind(kind: ContractKind): boolean {
  return HAUL_KINDS[kind] === true;
}

/**
 * The short title a courier's boot shows before the cargo's name, so the four offers
 * read at a glance: a sticker run, a race to the next courier (a coin to the winner),
 * a race two couriers on (two coins), and a haul with a trailer or a car in tow.
 */
export function contractTier(item: ContractCargoItem): string {
  if (item.raceLegs === 1) return 'race · 1 stop';
  if (item.raceLegs === 2) return 'race · 2 stops';
  return isHaulKind(item.contractKind) ? 'big haul' : 'easy run';
}

/** Display name for the HUD and interaction prompts. */
export function itemLabel(item: Item): string {
  switch (item.type) {
    case 'tool':
      return spongeSpent(item) ? 'used-up sponge' : `sponge (${Math.round(item.integrity * 100)}%)`;
    case 'part': {
      const label = variant(item.part.variantId).label;
      const named = item.part.destroyed ? `destroyed ${label}` : label;
      // A detached container carries its fluid with it (see `PartInstance.litres`),
      // and the amount is the whole reason to pick this one up rather than that one.
      // An air filter's wear is the same kind of reason.
      if (item.part.clog !== undefined) return `${named} (${Math.round(item.part.clog * 100)}% clogged)`;
      const litres = item.part.litres ?? 0;
      if (litres <= 0) return named;
      return `${named} (${litreText(litres)})`;
    }
    case 'fluid_can':
      return `${item.fluid} can (${litreText(item.litres)})`;
    case 'spray_can': {
      const name = carPaintSwatch(item.paint)?.name ?? 'paint';
      return item.charge > 0
        ? `${name} spray paint (${Math.round(item.charge * 100)}%)`
        : `empty ${name} spray can`;
    }
    case 'weapon':
      return `${item.weapon} (${item.loaded}/${item.magazine})`;
    case 'ammo':
      return `${item.forWeapon} rounds x${item.count}`;
    case 'quarry':
      return item.species;
    case 'bubble_gum':
      return `bubble gum x${item.charges}`;
    case 'medicine':
      return 'medicine bottle';
    case 'binoculars':
      return 'binoculars';
    case 'torchlight':
      return 'torchlight';
    case 'sun_shades':
      return `${item.tint} sun shades`;
    case 'camera':
      return `professional camera (${item.framesRemaining}/${CAMERA_FRAME_LIMIT})`;
    case 'photograph':
      return 'photograph';
    case 'football':
      return 'football';
    case 'pocket_watch':
      return 'pocket watch';
    case 'postcard':
      return 'postcard from home';
    case 'coin':
      return item.value === 1 ? 'coin' : `coin · ${item.value}`;
    case 'contract_cargo':
      return `${contractTier(item)}: ${item.cargoName}`;
    case 'sticker_envelope':
      // The name is on the envelope; the picture is seen when it is tried on.
      return `sticker envelope · ${stickerDef(item.stickerKind).label}`;
  }
}

/** Carried mass in kg. Heavy items slow the player down on foot. */
export function itemMass(item: Item): number {
  switch (item.type) {
    case 'tool':
      return 1.2;
    case 'part': {
      const v = variant(item.part.variantId);
      const litres = item.part.litres ?? 0;
      if (litres <= 0) return v.mass;
      // A full radiator or tank is mostly fluid, and the player feels that on foot.
      const fluid: FluidKind =
        v.kind === 'engine' ? 'oil' : v.kind === 'fuel_tank' ? 'petrol' : 'water';
      return v.mass + litres * FLUID_DENSITY[fluid];
    }
    case 'fluid_can':
      // Empty can plus the fluid's own weight.
      return 2.5 + item.litres * FLUID_DENSITY[item.fluid];
    case 'spray_can':
      // A 400 ml aerosol: the tin, plus the paint and propellant still in it.
      return 0.12 + item.charge * 0.36;
    case 'weapon':
      return item.weapon === 'shotgun' ? 3.4 : 4.1;
    case 'ammo':
      return item.count * 0.024;
    case 'quarry':
      return item.mass;
    case 'bubble_gum':
      return 0.02;
    case 'medicine':
      return 0.09;
    case 'binoculars':
      return 0.75;
    case 'torchlight':
      return 0.45;
    case 'sun_shades':
      return 0.08;
    case 'camera':
      return 1.35;
    case 'photograph':
      return 0.005;
    case 'football':
      return 0.43;
    case 'pocket_watch':
      return 0.12;
    case 'postcard':
      // One printed card, and you carry that without noticing.
      return 0.008;
    case 'coin':
      return 0.008 * item.value;
    case 'contract_cargo':
      // A heavy crate carries its own mass; every other contract is a parcel.
      return item.massKg ?? 12;
    case 'sticker_envelope':
      return 0.08;
  }
}

/** True while the item's primary action can be held down continuously. */
export function isContinuousUse(item: Item): boolean {
  return item.type === 'tool' || item.type === 'fluid_can' || item.type === 'spray_can';
}

/**
 * The player's carried items.
 *
 * Capacity is limited by both mass and three physical slots. Ordering is stable,
 * because the HUD and the item-cycle key both index into it.
 *
 * The pack is authoritative here rather than in `WorldState`, so every structural
 * change reports through `onChange` and the owner mirrors it into state for saving.
 * Only structure is reported: per-item fields (ammo counts, can litres, tool
 * integrity) are mutated in place, and the mirror holds the same object references,
 * so those ride along without a notification of their own.
 */
export const INVENTORY_ITEM_LIMIT = 3;
export class Inventory {
  private readonly items: Item[] = [];
  private selected = 0;
  private listener: (() => void) | null = null;

  constructor(readonly massLimit = 95) {}

  /** Called after every add, removal or selection change. */
  setListener(listener: (() => void) | null): void {
    this.listener = listener;
  }

  /**
   * Replaces the whole pack from a loaded save. Silent: the caller already holds
   * the state this would write back, and notifying would be a redundant round trip.
   * Legacy items beyond the three-slot limit are returned so the caller can drop
   * them into the world instead of deleting them.
   */
  restore(items: readonly Item[], selected: number): readonly Item[] {
    this.items.length = 0;
    this.items.push(...items.slice(0, INVENTORY_ITEM_LIMIT));
    this.selected = this.items.length === 0
      ? 0
      : Math.min(Math.max(0, Math.trunc(selected)), this.items.length - 1);
    return items.slice(INVENTORY_ITEM_LIMIT);
  }

  get all(): readonly Item[] {
    return this.items;
  }

  get carriedMass(): number {
    let total = 0;
    for (const item of this.items) total += itemMass(item);
    return total;
  }

  get held(): Item | null {
    return this.items[this.selected] ?? null;
  }

  /** Everything carried, in slot order. */
  get contents(): readonly Item[] {
    return this.items;
  }

  /**
   * Fails when all three slots are occupied or the item would exceed the mass limit,
   * so the caller can explain why.
   *
   * Exception, and it is load-bearing for the whole game: a single item may always be
   * picked up when your hands are otherwise empty, however heavy it is. Engines run
   * 118-402 kg against a 95 kg limit, so without this you could never carry an engine
   * to the car and the game would be unfinishable. Hauling one is deliberately
   * miserable instead — `carriedMass` saturates the movement penalty.
   *
   * A coin joining a pack that already holds one merges into it (see `CoinItem`),
   * so it never needs a free slot.
   */
  add(item: Item): boolean {
    if (item.type === 'coin') {
      const index = this.items.findIndex((held) => held.type === 'coin');
      const pile = this.items[index];
      if (pile?.type === 'coin') {
        this.items[index] = { ...pile, value: pile.value + item.value };
        this.listener?.();
        return true;
      }
    }
    if (this.items.length >= INVENTORY_ITEM_LIMIT) return false;
    const mass = itemMass(item);
    const soleHeavyHaul = this.items.length === 0 && mass > this.massLimit;
    if (!soleHeavyHaul && this.carriedMass + mass > this.massLimit) return false;
    this.items.push(item);
    this.listener?.();
    return true;
  }

  remove(id: string): Item | null {
    const index = this.items.findIndex((i) => i.id === id);
    if (index < 0) return null;
    const [removed] = this.items.splice(index, 1);
    // Keep the selection in range after the array shrinks.
    if (this.selected >= this.items.length) this.selected = Math.max(0, this.items.length - 1);
    this.listener?.();
    return removed ?? null;
  }

  find(id: string): Item | null {
    return this.items.find((i) => i.id === id) ?? null;
  }

  cycle(direction: number): void {
    if (this.items.length === 0) {
      this.selected = 0;
      return;
    }
    const n = this.items.length;
    const next = (((this.selected + direction) % n) + n) % n;
    if (next === this.selected) return;
    this.selected = next;
    this.listener?.();
  }

  select(id: string): void {
    const index = this.items.findIndex((i) => i.id === id);
    if (index >= 0 && index !== this.selected) {
      this.selected = index;
      this.listener?.();
    }
  }

  /** Index of the held item, or -1 when empty. The HUD highlights this slot. */
  get selectedIndex(): number {
    return this.items.length === 0 ? -1 : this.selected;
  }

  /**
   * Picks a slot by position. Out-of-range picks are ignored rather than clamped:
   * pressing 6 with four items should do nothing, not jump to the last item.
   */
  selectIndex(index: number): void {
    if (index >= 0 && index < this.items.length && index !== this.selected) {
      this.selected = index;
      this.listener?.();
    }
  }
}
