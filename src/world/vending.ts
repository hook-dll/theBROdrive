import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { hash01, pick } from '../core/rng';
import { formatPay, itemShells } from '../economy/economy';
import type { GameWorld } from '../game/state';
import { itemLabel, type Item, type ShadeTint } from '../items/items';
import { IMPORT_ENGINE_IDS, variantsOfKind, type PartInstance } from '../parts/registry';
import { CAR_PAINTS } from '../vehicle/carpaint';
import { buildCardMachineSteps, CardMachine, NICHE_FLOOR_Y, NICHE_X, NICHE_Z, paintCardFace, registerCardMachineSigns, type CardMachineParts } from './cardmachine';
import type { ChunkContext } from './chunks';
import type { FixtureContext, FixtureField } from './fixturefield';
import type { Poi } from './poi';
import { box } from './poi/kit';

/**
 * THE GARAGE MACHINE: where a driver buys what his car needs, at the settlements that
 * have one (world/settlement.ts `poiHasMachine`: posts 0..2 always, past them half).
 *
 * A card machine (world/cardmachine.ts), the post's twin in a workshop's cabinet (dark
 * steel, rivets, a pegboard with tools on its flanks, a spanner on its hood): the wheel
 * turns through a card for each thing still in it, the showcase beside the window holds
 * the one the card names, and BUY takes its price out of the player's jar and lays the
 * thing in the machine's grid, where he takes it as from a boot. Short, the button
 * springs back with a rattle, nothing is given, and the card says the shells are short;
 * with the grid's one cell taken (a thing bought and not taken), it refuses before
 * taking any shells. What lies in the grid is saved (`WorldState.machineGrids`), so a
 * thing paid for and left there waits for him.
 *
 * What a machine holds is a pure function of the stop's seed, so it needs no saved stock
 * of its own: `vendingSold` records which slots were paid for, and those stay empty for
 * good. A machine never restocks.
 *
 * Every machine draws from one short list (game-design2.md §8): car parts (an air
 * filter, a turbine, a radiator, a gearbox, an engine — the engines and gearboxes the
 * catalogue's cars are built with, not the imports the scrapyards keep), one or two
 * spray cans of a random paint (the colour is on the card), empty cans of 5, 10 or 20
 * litres, and the small goods: bubble gum and sun shades of a random tint. Not every
 * machine has every kind. No fluid is sold here: an empty can, a dry engine or radiator
 * is filled at a settlement's pumps (world/pumps.ts) or from another can. Stickers are
 * not sold here: the claw machine gives them (world/claw.ts).
 *
 * Prices are not set here: the economy prices each item (`itemShells`,
 * economy/economy.ts), the same count of shells down the whole road.
 */

/** Most things one machine is stocked with. */
const GARAGE_SLOTS = 12;

/** Domain tag for the garage rolls. */
const GARAGE_DOMAIN = 0x47415231; // 'GAR1'

type Ware =
  | 'air_filter'
  | 'turbine'
  | 'radiator'
  | 'gearbox'
  | 'engine'
  | 'spray'
  | 'can5'
  | 'can10'
  | 'can20'
  | 'gum'
  | 'shades';

const SHADE_TINTS: readonly ShadeTint[] = ['green', 'yellow', 'red'];
const CAN_WARES: readonly Ware[] = ['can5', 'can5', 'can10', 'can10', 'can20'];
/** The engines and gearboxes a machine may hold: every one a car takes (the ZIL's V8 too), no import. */
const ENGINE_IDS: readonly string[] = variantsOfKind('engine', 'car')
  .filter((v) => !IMPORT_ENGINE_IDS.includes(v.id))
  .map((v) => v.id);
const GEARBOX_IDS: readonly string[] = variantsOfKind('gearbox', 'car').map((v) => v.id);
const RADIATOR_IDS: readonly string[] = variantsOfKind('radiator', 'car').map((v) => v.id);

/** How each ware looks in the showcase: a coloured block of its size, metres [w, h, d]. */
const PRODUCT_LOOK: Readonly<Record<Ware, { readonly colour: number; readonly size: readonly [number, number, number] }>> = {
  air_filter: { colour: 0xc87a35, size: [0.14, 0.07, 0.1] },
  turbine: { colour: 0x9a9a92, size: [0.13, 0.12, 0.1] },
  radiator: { colour: 0x8a8f7a, size: [0.2, 0.14, 0.03] },
  gearbox: { colour: 0x7a7d80, size: [0.18, 0.12, 0.1] },
  engine: { colour: 0x4a4c50, size: [0.2, 0.16, 0.1] },
  spray: { colour: 0xffffff, size: [0.05, 0.15, 0.05] },
  can20: { colour: 0x5a6238, size: [0.15, 0.17, 0.08] },
  can10: { colour: 0x5a6238, size: [0.12, 0.14, 0.07] },
  can5: { colour: 0x5a6238, size: [0.1, 0.12, 0.06] },
  gum: { colour: 0xd46a9a, size: [0.1, 0.05, 0.04] },
  shades: { colour: 0x28251f, size: [0.13, 0.045, 0.03] },
};

/** A pair of shades shows its lens colour in the window, as the item itself does. */
const SHADE_LOOK: Readonly<Record<ShadeTint, number>> = { green: 0x416a42, yellow: 0xb78e32, red: 0x8b3934 };

function makeWare(ware: Ware, id: string, seed: number, slot: number): Item {
  const can = (capacity: number): Item => ({ type: 'fluid_can', id, fluid: null, capacity, litres: 0 });
  const part = (variantId: string): Item => {
    const instance: PartInstance = { id, variantId, dirt: 0, rust: 0 };
    if (variantId === 'air_filter') instance.clog = 0;
    return { type: 'part', id, part: instance };
  };
  switch (ware) {
    case 'air_filter':
      return part('air_filter');
    case 'turbine':
      return part('turbine_standard');
    case 'radiator':
      return part(pick(RADIATOR_IDS, seed, GARAGE_DOMAIN, slot, 47));
    case 'gearbox':
      return part(pick(GEARBOX_IDS, seed, GARAGE_DOMAIN, slot, 49));
    case 'engine':
      return part(pick(ENGINE_IDS, seed, GARAGE_DOMAIN, slot, 51));
    case 'spray':
      return { type: 'spray_can', id, paint: pick(CAR_PAINTS, seed, GARAGE_DOMAIN, slot, 43).hex, charge: 1 };
    case 'can5':
      return can(5);
    case 'can10':
      return can(10);
    case 'can20':
      return can(20);
    case 'gum':
      return { type: 'bubble_gum', id, charges: 5 };
    case 'shades':
      return { type: 'sun_shades', id, tint: pick(SHADE_TINTS, seed, GARAGE_DOMAIN, slot, 45) };
  }
}

/**
 * The wares a machine was stocked with, in window order: each kind is there by its own
 * roll and in its own count, the parts first, then paint, cans and the small goods; a
 * machine that drew more than its window holds gives up gum, then cans, until it fits.
 */
function garageWares(seed: number): Ware[] {
  const roll = (k: number): number => hash01(seed, GARAGE_DOMAIN, k);
  const count = (k: number, chance: number, min: number, max: number): number =>
    roll(k) < chance ? min + Math.floor(roll(k + 1) * (max - min + 1)) : 0;
  const counts = {
    air_filter: count(10, 0.6, 1, 1),
    turbine: count(12, 0.3, 1, 1),
    radiator: count(14, 0.4, 1, 1),
    gearbox: count(16, 0.25, 1, 1),
    engine: count(18, 0.2, 1, 1),
    spray: count(20, 0.85, 1, 2),
    cans: count(22, 0.9, 1, 3),
    gum: count(24, 0.7, 1, 2),
    shades: count(26, 0.6, 1, 1),
  };
  const total = (): number => Object.values(counts).reduce((sum, n) => sum + n, 0);
  while (total() > GARAGE_SLOTS && counts.gum > 0) counts.gum--;
  while (total() > GARAGE_SLOTS && counts.cans > 1) counts.cans--;
  const wares: Ware[] = [];
  const add = (ware: Ware, n: number): void => {
    for (let i = 0; i < n; i++) wares.push(ware);
  };
  add('air_filter', counts.air_filter);
  add('turbine', counts.turbine);
  add('radiator', counts.radiator);
  add('gearbox', counts.gearbox);
  add('engine', counts.engine);
  add('spray', counts.spray);
  for (let i = 0; i < counts.cans; i++) wares.push(pick(CAN_WARES, seed, GARAGE_DOMAIN, 30 + i));
  add('gum', counts.gum);
  add('shades', counts.shades);
  return wares;
}

/** What a machine was stocked with, by slot, and the ware behind each (for its look). */
function garageStock(
  world: GameWorld,
  poi: Poi,
): { readonly items: (Item | null)[]; readonly wares: (Ware | null)[] } {
  const items = new Array<Item | null>(GARAGE_SLOTS).fill(null);
  const wares = new Array<Ware | null>(GARAGE_SLOTS).fill(null);
  garageWares(poi.variantSeed).forEach((ware, slot) => {
    items[slot] = makeWare(ware, world.generatedPartId('garage', poi.index, slot), poi.variantSeed, slot);
    wares[slot] = ware;
  });
  return { items, wares };
}

/** Workshop steel on the body and the deck, a hazard-yellow BUY. */
const GARAGE_LOOK = { cabinet: 'garage', body: 0x46525c, buttonLabel: 'BUY', buttonColour: 0xd9a52b } as const;
registerCardMachineSigns(GARAGE_LOOK);

/** What the card says a ware is, and the colour of its band. */
const WARE_CARD: Readonly<Record<Ware, { readonly band: string; readonly kind: string; readonly line: string }>> = {
  air_filter: { band: '#2f4f7a', kind: 'PART', line: 'a new air filter for the engine' },
  turbine: { band: '#2f4f7a', kind: 'PART', line: 'a standard turbine' },
  radiator: { band: '#2f4f7a', kind: 'PART', line: 'dry — water it at a pump' },
  gearbox: { band: '#2f4f7a', kind: 'PART', line: 'a gearbox for a car' },
  engine: { band: '#2f4f7a', kind: 'ENGINE', line: 'dry — oil it at a pump' },
  spray: { band: '#8a3f6e', kind: 'PAINT', line: 'a spray can of this colour' },
  can5: { band: '#4f6a3a', kind: 'CAN', line: 'empty — fill it at a pump' },
  can10: { band: '#4f6a3a', kind: 'CAN', line: 'empty — fill it at a pump' },
  can20: { band: '#4f6a3a', kind: 'CAN', line: 'empty — fill it at a pump' },
  gum: { band: '#a2457a', kind: 'GUM', line: 'five chews — a bubble rights a car' },
  shades: { band: '#6e5a2a', kind: 'SHADES', line: 'sun shades for the drive' },
};

/**
 * Builds a machine standing at absolute (`x`, `z`) on the sand, its front turned by `yaw`.
 * In the physics band it is solid and registers its fixture (id pushed to `registered`,
 * for the chunk to forget). `disposers` gets the card materials. Yields between its stages.
 */
export function* buildGarageSteps(
  ctx: ChunkContext,
  poi: Poi,
  x: number,
  z: number,
  yaw: number,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  fixtures: FixtureField,
  registered: string[],
  disposers: Array<() => void>,
): Generator<void, void> {
  const parts = yield* buildCardMachineSteps(ctx, poi.s, x, z, yaw, GARAGE_LOOK, group, bodies, colliders, disposers);
  yield;
  // The machine's key in `WorldState.vendingSold` and `machineGrids`, and its fixture id.
  // `vend:<poi>` was the mixed shop's before the garage machine replaced it: save/save.ts
  // drops that one's sold slots and moves what lay in its grid to this key.
  const id = `garage:${poi.index}`;
  const { items, wares } = garageStock(ctx.world, poi);

  // The showcase: every ware still in the machine standing on its floor, only the one
  // on the card shown.
  const root = parts.root;
  const products: (THREE.Object3D | null)[] = new Array<THREE.Object3D | null>(GARAGE_SLOTS).fill(null);
  const sold = ctx.world.state.vendingSold[id] ?? [];
  for (let slot = 0; slot < GARAGE_SLOTS; slot++) {
    const ware = wares[slot];
    const item = items[slot];
    if (!ware || !item || sold.includes(slot)) continue;
    const look = PRODUCT_LOOK[ware];
    const colour = item.type === 'spray_can' ? item.paint : item.type === 'sun_shades' ? SHADE_LOOK[item.tint] : look.colour;
    const product = box(root, look.size, [NICHE_X, NICHE_FLOOR_Y + look.size[1] / 2, NICHE_Z], colour);
    product.visible = false;
    // Shown one at a time, on its card: never merged.
    product.userData.kitKeep = true;
    products[slot] = product;
  }

  const machine = new GarageMachine(ctx.world, id, items, wares, products, parts);
  if (ctx.hasPhysics) registered.push(fixtures.register(machine));
}

class GarageMachine extends CardMachine {
  /** The slots still for sale, in window order: the cards. */
  private readonly available: number[];
  /** The slot whose BUY the jar was too short for, painted on its card until it turns. */
  private short: number | null = null;

  constructor(
    world: GameWorld,
    id: string,
    private readonly items: readonly (Item | null)[],
    private readonly wares: readonly (Ware | null)[],
    private readonly products: readonly (THREE.Object3D | null)[],
    parts: CardMachineParts,
  ) {
    super(id, parts, world);
    const sold = world.state.vendingSold[id] ?? [];
    this.available = [];
    for (let slot = 0; slot < GARAGE_SLOTS; slot++) {
      if (items[slot] && !sold.includes(slot)) this.available.push(slot);
    }
    this.start();
  }

  protected cardCount(): number {
    return this.available.length;
  }

  protected override onShown(index: number): void {
    const showing = index >= 0 ? this.available[index] : undefined;
    if (showing !== this.short) this.short = null;
    this.products.forEach((product, slot) => {
      if (product) product.visible = slot === showing;
    });
  }

  protected paintCard(g: CanvasRenderingContext2D, w: number, h: number, index: number): void {
    const slot = this.available[index];
    const item = slot === undefined ? null : this.items[slot];
    const ware = slot === undefined ? null : this.wares[slot];
    if (!item || !ware) {
      paintCardFace(g, w, h, {
        band: '#5a5a5a',
        bandText: 'SOLD OUT',
        corner: '',
        headline: 'EMPTY',
        lines: ['everything here has been bought', 'the next garage is down the road'],
        footer: 'the machine never restocks',
      });
      return;
    }
    const card = WARE_CARD[ware];
    const price = itemShells(item);
    paintCardFace(g, w, h, {
      band: card.band,
      bandText: card.kind,
      corner: `${index + 1}/${this.available.length}`,
      headline: itemLabel(item),
      lines: [
        formatPay(price),
        slot === this.short ? 'NOT ENOUGH SHELLS' : card.line,
      ],
      footer: '',
    });
    // The paint's own colour, as a swatch in the corner of the card.
    const swatch = item.type === 'spray_can' ? item.paint : item.type === 'sun_shades' ? SHADE_LOOK[item.tint] : null;
    if (swatch !== null) {
      g.fillStyle = `#${swatch.toString(16).padStart(6, '0')}`;
      g.fillRect(w * 0.74, h * 0.66, w * 0.2, h * 0.24);
      g.strokeStyle = '#2a2620';
      g.lineWidth = 3;
      g.strokeRect(w * 0.74, h * 0.66, w * 0.2, h * 0.24);
    }
  }

  private itemAt(index: number): { slot: number; item: Item } | null {
    const slot = this.available[index];
    const item = slot === undefined ? null : this.items[slot];
    return slot === undefined || !item ? null : { slot, item };
  }

  protected pressButton(ctx: FixtureContext, index: number): FoleyEvent {
    const at = this.itemAt(index);
    if (!at) return this.refuse();
    if (!this.cellFree()) {
      ctx.toast('take out what lies in the grid first');
      return this.refuse();
    }
    const price = itemShells(at.item);
    if (!ctx.debit(price)) {
      // The card says why, painted afresh in place.
      this.short = at.slot;
      this.cardsChanged();
      return this.refuse();
    }
    this.short = null;
    this.world.apply({ t: 'vend_sold', machineId: this.id, slot: at.slot });
    this.available.splice(index, 1);
    const product = this.products[at.slot];
    if (product) product.visible = false;
    this.cardsChanged();
    // Into the grid, where he takes it from as from a boot.
    this.give(at.item);
    this.saveGrid();
    return 'drop';
  }
}
