import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { hash01, pick } from '../core/rng';
import { formatMoney, itemPrice } from '../economy/economy';
import type { GameWorld } from '../game/state';
import { itemLabel, type Item, type ShadeTint } from '../items/items';
import { STICKERS } from '../items/stickercatalog';
import type { PartInstance } from '../parts/registry';
import { CAR_PAINTS } from '../vehicle/carpaint';
import { buildCardMachine, CardMachine, MACHINE_D, PANEL_X, PANEL_Y, paintCardFace, registerCardMachineSigns, type CardMachineParts } from './cardmachine';
import type { ChunkContext } from './chunks';
import type { FixtureContext, FixtureField } from './fixturefield';
import type { Poi } from './poi';
import { box, C, mergeKitStatics } from './poi/kit';

/**
 * The SHOP machines: where the small things a driver needs are bought.
 *
 * A card machine (world/cardmachine.ts), the post's twin: the crank turns through a card
 * for each thing still in it, the showcase beside the button holds the one the card
 * names, and BUY takes its price from the player's money and drops
 * it into the tray. Short, the button springs back with a rattle, nothing drops, and the
 * card says the money is short.
 *
 * What a machine holds is a pure function of the stop's seed, so it needs no saved stock
 * of its own: `vendingSold` records which slots were paid for, and those stay empty for
 * good. A machine never restocks.
 *
 * Every machine draws from one short list (game-design2.md §8): one or two spray cans of
 * a random paint (the colour is on the card), sun shades of a random tint, an air
 * filter, a turbine, empty cans of 5, 10 or 20 litres, bubble gum and four or five
 * envelopes of random stickers. Not every machine has every kind. No fluid is sold here:
 * an empty can is filled at a settlement's pumps (world/pumps.ts) or from another can.
 *
 * Prices are not set here: the economy prices each item where the machine stands
 * (`itemPrice`, economy/economy.ts), so further down the road the same can costs more.
 */

/** Most things one machine is stocked with. */
const SHOP_SLOTS = 12;

/** Domain tag for the vending rolls. */
const VENDING_DOMAIN = 0x56454e32; // 'VEN2'

type Ware = 'spray' | 'shades' | 'air_filter' | 'turbine' | 'can5' | 'can10' | 'can20' | 'gum' | 'sticker';

const SHADE_TINTS: readonly ShadeTint[] = ['green', 'yellow', 'red'];
const CAN_WARES: readonly Ware[] = ['can5', 'can5', 'can10', 'can10', 'can20'];

/** How each ware looks in the window: a coloured block of its size, metres [w, h, d]. */
const PRODUCT_LOOK: Readonly<Record<Ware, { readonly colour: number; readonly size: readonly [number, number, number] }>> = {
  spray: { colour: 0xffffff, size: [0.05, 0.15, 0.05] },
  shades: { colour: 0x28251f, size: [0.13, 0.045, 0.03] },
  air_filter: { colour: 0xc87a35, size: [0.14, 0.07, 0.1] },
  turbine: { colour: 0x9a9a92, size: [0.13, 0.12, 0.1] },
  can20: { colour: 0x5a6238, size: [0.15, 0.17, 0.08] },
  can10: { colour: 0x5a6238, size: [0.12, 0.14, 0.07] },
  can5: { colour: 0x5a6238, size: [0.1, 0.12, 0.06] },
  gum: { colour: 0xd46a9a, size: [0.1, 0.05, 0.04] },
  sticker: { colour: 0xe6dcc2, size: [0.12, 0.085, 0.012] },
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
    case 'spray':
      return { type: 'spray_can', id, paint: pick(CAR_PAINTS, seed, VENDING_DOMAIN, slot, 43).hex, charge: 1 };
    case 'shades':
      return { type: 'sun_shades', id, tint: pick(SHADE_TINTS, seed, VENDING_DOMAIN, slot, 45) };
    case 'air_filter':
      return part('air_filter');
    case 'turbine':
      return part('turbine_standard');
    case 'can5':
      return can(5);
    case 'can10':
      return can(10);
    case 'can20':
      return can(20);
    case 'gum':
      return { type: 'bubble_gum', id, charges: 5 };
    case 'sticker':
      return {
        type: 'sticker_envelope',
        id,
        stickerKind: pick(STICKERS, seed, VENDING_DOMAIN, slot, 47).kind,
      };
  }
}

/**
 * The wares a machine was stocked with, in window order: each kind is there by its own
 * roll and in its own count, and a machine that drew more than its window holds gives
 * up gum, then cans, then a sticker until it fits.
 */
function vendingWares(seed: number): Ware[] {
  const roll = (k: number): number => hash01(seed, VENDING_DOMAIN, k);
  const count = (k: number, chance: number, min: number, max: number): number =>
    roll(k) < chance ? min + Math.floor(roll(k + 1) * (max - min + 1)) : 0;
  const counts = {
    spray: count(10, 0.85, 1, 2),
    shades: count(12, 0.6, 1, 1),
    air_filter: count(14, 0.6, 1, 1),
    turbine: count(16, 0.3, 1, 1),
    cans: count(18, 0.9, 1, 3),
    gum: count(20, 0.7, 1, 2),
    sticker: count(22, 0.85, 4, 5),
  };
  const total = (): number => Object.values(counts).reduce((sum, n) => sum + n, 0);
  while (total() > SHOP_SLOTS && counts.gum > 0) counts.gum--;
  while (total() > SHOP_SLOTS && counts.cans > 1) counts.cans--;
  while (total() > SHOP_SLOTS && counts.sticker > 4) counts.sticker--;
  const wares: Ware[] = [];
  const add = (ware: Ware, n: number): void => {
    for (let i = 0; i < n; i++) wares.push(ware);
  };
  add('spray', counts.spray);
  add('shades', counts.shades);
  add('air_filter', counts.air_filter);
  add('turbine', counts.turbine);
  for (let i = 0; i < counts.cans; i++) wares.push(pick(CAN_WARES, seed, VENDING_DOMAIN, 30 + i));
  add('gum', counts.gum);
  add('sticker', counts.sticker);
  return wares;
}

/** What a machine was stocked with, by slot, and the ware behind each (for its look). */
function vendingStock(
  world: GameWorld,
  poi: Poi,
): { readonly items: (Item | null)[]; readonly wares: (Ware | null)[] } {
  const items = new Array<Item | null>(SHOP_SLOTS).fill(null);
  const wares = new Array<Ware | null>(SHOP_SLOTS).fill(null);
  vendingWares(poi.variantSeed).forEach((ware, slot) => {
    items[slot] = makeWare(ware, world.generatedPartId('vend', poi.index, slot), poi.variantSeed, slot);
    wares[slot] = ware;
  });
  return { items, wares };
}

const SHOP_LOOK = { title: 'SHOP', body: C.fadedBlue, buttonLabel: 'BUY', buttonColour: 0xb03a2e } as const;
registerCardMachineSigns(SHOP_LOOK);

/** What the card says a ware is, and the colour of its band. */
const WARE_CARD: Readonly<Record<Ware, { readonly band: string; readonly kind: string; readonly line: string }>> = {
  spray: { band: '#8a3f6e', kind: 'PAINT', line: 'a spray can of this colour' },
  shades: { band: '#6e5a2a', kind: 'SHADES', line: 'sun shades for the drive' },
  air_filter: { band: '#2f4f7a', kind: 'PART', line: 'a new air filter for the engine' },
  turbine: { band: '#2f4f7a', kind: 'PART', line: 'a standard turbine' },
  can5: { band: '#4f6a3a', kind: 'CAN', line: 'empty — fill it at a pump' },
  can10: { band: '#4f6a3a', kind: 'CAN', line: 'empty — fill it at a pump' },
  can20: { band: '#4f6a3a', kind: 'CAN', line: 'empty — fill it at a pump' },
  gum: { band: '#a2457a', kind: 'GUM', line: 'five chews — a bubble rights a car' },
  sticker: { band: '#b0702a', kind: 'STICKER', line: 'sealed — a sticker you see once it is open' },
};

/** The showcase beside the button: a lit niche with a shelf, local metres. */
const CASE_W = 0.28;
const CASE_H = 0.24;
const CASE_FRONT = -MACHINE_D / 2;

/**
 * Builds a machine standing at absolute (`x`, `z`) on the sand, its front turned by `yaw`.
 * In the physics band it is solid and registers its fixture (id pushed to `registered`,
 * for the chunk to forget). `disposers` gets the card materials.
 */
export function buildShop(
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
): void {
  const parts = buildCardMachine(ctx, poi.s, x, z, yaw, SHOP_LOOK, group, bodies, colliders, disposers);
  const id = shopId(poi.index);
  const { items, wares } = vendingStock(ctx.world, poi);

  // The showcase: a frame, a pale back, a shelf, and every ware still in the machine
  // standing on it, only the one on the card shown.
  const root = parts.root;
  box(root, [CASE_W + 0.04, CASE_H + 0.04, 0.05], [PANEL_X, PANEL_Y, CASE_FRONT - 0.02], C.darkMetal);
  box(root, [CASE_W, CASE_H, 0.01], [PANEL_X, PANEL_Y, CASE_FRONT - 0.046], 0xbcb8aa);
  const shelfY = PANEL_Y - CASE_H / 2 + 0.03;
  box(root, [CASE_W, 0.012, 0.06], [PANEL_X, shelfY, CASE_FRONT - 0.08], C.metal);
  const products: (THREE.Object3D | null)[] = new Array<THREE.Object3D | null>(SHOP_SLOTS).fill(null);
  const sold = ctx.world.state.vendingSold[id] ?? [];
  for (let slot = 0; slot < SHOP_SLOTS; slot++) {
    const ware = wares[slot];
    const item = items[slot];
    if (!ware || !item || sold.includes(slot)) continue;
    const look = PRODUCT_LOOK[ware];
    const colour = item.type === 'spray_can' ? item.paint : item.type === 'sun_shades' ? SHADE_LOOK[item.tint] : look.colour;
    const product = box(root, look.size, [PANEL_X, shelfY + 0.006 + look.size[1] / 2, CASE_FRONT - 0.08], colour);
    product.visible = false;
    // Shown one at a time, on its card: never merged.
    product.userData.kitKeep = true;
    products[slot] = product;
  }
  // The showcase joins the cabinet's merged boxes.
  mergeKitStatics(root);

  const machine = new ShopMachine(ctx.world, id, poi.s / 1000, items, wares, products, parts);
  if (ctx.hasPhysics) registered.push(fixtures.register(machine));
}

/** The machine's key in `WorldState.vendingSold`, and its fixture id. */
function shopId(poiIndex: number): string {
  return `vend:${poiIndex}`;
}

class ShopMachine extends CardMachine {
  protected readonly title = 'SHOP';
  /** The slots still for sale, in window order: the cards. */
  private readonly available: number[];
  /** The slot whose BUY the money was too short for, painted on its card until it turns. */
  private short: number | null = null;

  constructor(
    private readonly world: GameWorld,
    id: string,
    /** Kilometres from home: the price's argument. */
    private readonly km: number,
    private readonly items: readonly (Item | null)[],
    private readonly wares: readonly (Ware | null)[],
    private readonly products: readonly (THREE.Object3D | null)[],
    parts: CardMachineParts,
  ) {
    super(id, parts);
    const sold = world.state.vendingSold[id] ?? [];
    this.available = [];
    for (let slot = 0; slot < SHOP_SLOTS; slot++) {
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
        lines: ['everything here has been bought', 'the next shop is down the road'],
        footer: 'the machine never restocks',
      });
      return;
    }
    const card = WARE_CARD[ware];
    const price = itemPrice(item, this.km);
    paintCardFace(g, w, h, {
      band: card.band,
      bandText: card.kind,
      corner: `${index + 1}/${this.available.length}`,
      headline: itemLabel(item),
      lines: [
        formatMoney(price),
        slot === this.short ? 'NOT ENOUGH MONEY' : card.line,
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
    const price = itemPrice(at.item, this.km);
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
    this.give(ctx, [at.item]);
    return 'drop';
  }
}
