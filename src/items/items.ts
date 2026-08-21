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

export interface FuelCanItem {
  readonly type: 'fuel_can';
  readonly id: string;
  readonly fuel: 'petrol' | 'diesel';
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

export type Item = ToolItem | PartItem | FuelCanItem | WeaponItem | AmmoItem | QuarryItem;

/** Display name for the HUD and interaction prompts. */
export function itemLabel(item: Item): string {
  switch (item.type) {
    case 'tool':
      return item.tool;
    case 'part':
      return variant(item.part.variantId).label;
    case 'fuel_can':
      return `${item.fuel} can (${item.litres.toFixed(0)} L)`;
    case 'weapon':
      return `${item.weapon} (${item.loaded}/${item.magazine})`;
    case 'ammo':
      return `${item.forWeapon} rounds x${item.count}`;
    case 'quarry':
      return item.species;
  }
}

/** Carried mass in kg. Heavy items slow the player down on foot. */
export function itemMass(item: Item): number {
  switch (item.type) {
    case 'tool':
      return 1.2;
    case 'part':
      return variant(item.part.variantId).mass;
    case 'fuel_can':
      // Empty can plus roughly 0.75 kg per litre of fuel.
      return 2.5 + item.litres * 0.75;
    case 'weapon':
      return item.weapon === 'shotgun' ? 3.4 : 4.1;
    case 'ammo':
      return item.count * 0.024;
    case 'quarry':
      return item.mass;
  }
}

/** True while the item's primary action can be held down continuously. */
export function isContinuousUse(item: Item): boolean {
  return item.type === 'tool' || item.type === 'fuel_can';
}

/**
 * The player's carried items.
 *
 * Capacity is by mass, not slot count, so hauling an engine genuinely costs you.
 * Ordering is stable, because the HUD and the item-cycle key both index into it.
 */
export class Inventory {
  private readonly items: Item[] = [];
  private selected = 0;

  constructor(readonly massLimit = 95) {}

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
    return true;
  }

  remove(id: string): Item | null {
    const index = this.items.findIndex((i) => i.id === id);
    if (index < 0) return null;
    const [removed] = this.items.splice(index, 1);
    // Keep the selection in range after the array shrinks.
    if (this.selected >= this.items.length) this.selected = Math.max(0, this.items.length - 1);
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
    this.selected = (((this.selected + direction) % n) + n) % n;
  }

  select(id: string): void {
    const index = this.items.findIndex((i) => i.id === id);
    if (index >= 0) this.selected = index;
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
    if (index >= 0 && index < this.items.length) this.selected = index;
  }
}
