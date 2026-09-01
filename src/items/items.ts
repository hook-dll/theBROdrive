import type { PartInstance } from '../parts/registry';
import { variant } from '../parts/registry';

/**
 * Everything the player can hold, carry or use.
 *
 * Parts, tools, fuel cans, weapons and ammo all flow through one representation so
 * the interaction and inventory code has exactly one shape to handle. A rifle is
 * not a special case of anything; it is an item whose primary use fires.
 */

export type ToolKind = 'brush' | 'sponge' | 'wrench';
export type WeaponKind = 'rifle' | 'shotgun';
export type ShadeTint = 'green' | 'yellow' | 'red';

/**
 * Everything that can be poured into a car.
 *
 * One union rather than "fuel" plus a special case each for the others: the pour
 * mechanic is identical for all four, and the only thing the kind decides is which
 * reservoir it goes into. Petrol and diesel additionally have to match the engine.
 */
export type FluidKind = 'petrol' | 'diesel' | 'coolant' | 'oil';

export interface ToolItem {
  readonly type: 'tool';
  readonly id: string;
  readonly tool: ToolKind;
  /** Tools wear out slowly with use; 0..1, where 1 is new. */
  integrity: number;
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

export type Item =
  | ToolItem
  | PartItem
  | FluidCanItem
  | WeaponItem
  | AmmoItem
  | QuarryItem
  | BubbleGumItem
  | BinocularItem
  | TorchlightItem
  | SunShadesItem;

/**
 * Density, kg/litre. Petrol and diesel are the light ones; coolant is basically
 * water with glycol in it and oil is a shade under water.
 */
const FLUID_DENSITY: Record<FluidKind, number> = {
  petrol: 0.75,
  diesel: 0.84,
  coolant: 1.07,
  oil: 0.87,
};

/** Display name for the HUD and interaction prompts. */
export function itemLabel(item: Item): string {
  switch (item.type) {
    case 'tool':
      return item.tool;
    case 'part': {
      const label = variant(item.part.variantId).label;
      return item.part.destroyed ? `destroyed ${label}` : label;
    }
    case 'fluid_can':
      return `${item.fluid} can (${item.litres.toFixed(0)} L)`;
    case 'weapon':
      return `${item.weapon} (${item.loaded}/${item.magazine})`;
    case 'ammo':
      return `${item.forWeapon} rounds x${item.count}`;
    case 'quarry':
      return item.species;
    case 'bubble_gum':
      return `bubble gum x${item.charges}`;
    case 'binoculars':
      return 'binoculars';
    case 'torchlight':
      return 'torchlight';
    case 'sun_shades':
      return `${item.tint} sun shades`;
  }
}

/** Carried mass in kg. Heavy items slow the player down on foot. */
export function itemMass(item: Item): number {
  switch (item.type) {
    case 'tool':
      return 1.2;
    case 'part':
      return variant(item.part.variantId).mass;
    case 'fluid_can':
      // Empty can plus the fluid's own weight.
      return 2.5 + item.litres * FLUID_DENSITY[item.fluid];
    case 'weapon':
      return item.weapon === 'shotgun' ? 3.4 : 4.1;
    case 'ammo':
      return item.count * 0.024;
    case 'quarry':
      return item.mass;
    case 'bubble_gum':
      return 0.02;
    case 'binoculars':
      return 0.75;
    case 'torchlight':
      return 0.45;
    case 'sun_shades':
      return 0.08;
  }
}

/** True while the item's primary action can be held down continuously. */
export function isContinuousUse(item: Item): boolean {
  return item.type === 'tool' || item.type === 'fluid_can';
}

/**
 * The player's carried items.
 *
 * Capacity is by mass, not slot count, so hauling an engine genuinely costs you.
 * Ordering is stable, because the HUD and the item-cycle key both index into it.
 *
 * The pack is authoritative here rather than in `WorldState`, so every structural
 * change reports through `onChange` and the owner mirrors it into state for saving.
 * Only structure is reported: per-item fields (ammo counts, can litres, tool
 * integrity) are mutated in place, and the mirror holds the same object references,
 * so those ride along without a notification of their own.
 */
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
   */
  restore(items: readonly Item[], selected: number): void {
    this.items.length = 0;
    this.items.push(...items);
    this.selected = this.items.length === 0
      ? 0
      : Math.min(Math.max(0, Math.trunc(selected)), this.items.length - 1);
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

  /**
   * Fails when the item would exceed the mass limit, so the caller can explain why.
   *
   * Exception, and it is load-bearing for the whole game: a single item may always be
   * picked up when your hands are otherwise empty, however heavy it is. Engines run
   * 118-402 kg against a 95 kg limit, so without this you could never carry an engine
   * to the car and the game would be unfinishable. Hauling one is deliberately
   * miserable instead — `carriedMass` saturates the movement penalty.
   */
  add(item: Item): boolean {
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
