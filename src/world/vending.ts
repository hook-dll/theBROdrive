import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { hash01, pick } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import type { GameWorld } from '../game/state';
import type { Item, ShadeTint } from '../items/items';
import { STICKERS } from '../items/stickercatalog';
import type { PartInstance } from '../parts/registry';
import { CAR_PAINTS } from '../vehicle/carpaint';
import type { ChunkContext } from './chunks';
import type { Poi } from './poi';
import { box, C } from './poi/kit';
import { addStatic, yawRotation } from './props/scatter';
import {
  SIGN_PLANE,
  signMaterial,
  VENDING_COLUMNS,
  VENDING_ROWS,
  VENDING_SLOTS,
  type MarketField,
  type VendingMachine,
} from './market';

/**
 * The МАГАЗИН machines: where the small things a driver needs are bought.
 *
 * One kind of machine, the same everywhere. Its window is four rows of three units; what
 * it holds is a pure function of the stop's seed, so the machine needs no saved stock of
 * its own: `vendingSold` records which slots were paid for, and those stay empty for
 * good. A machine never restocks.
 *
 * Every machine draws from one short list (game-design2.md §8): one or two spray cans of
 * a random paint (the colour stands in the window), sun shades of a random tint, an air
 * filter, a turbine, empty cans of 5, 10 or 20 litres, bubble gum and four or five
 * envelopes of random stickers. Not every machine has every kind, and slots past the
 * last ware stay empty. No fluid is sold: an empty can is filled at a stop's barrels
 * (world/barrels.ts) or from another can.
 *
 * Prices are not set here: the economy prices each item where the machine stands
 * (`itemPrice`, economy/economy.ts), so further down the road the same can costs more.
 */

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

/** The machine's paint and its head board. */
const BODY_COLOUR = C.fadedBlue;
const TITLE = 'МАГАЗИН';

// The cabinet, local metres: base centre at the origin, front facing -Z.
const W = 0.9;
const H = 1.9;
const D = 0.75;
const FRONT = -D / 2;
/**
 * The window the goods stand in. The front faces local -Z, so a viewer's left is local
 * +X: the window stands on his left, the coin panel on his right, and a row fills from
 * his left (`WIN_X1` down).
 */
const WIN_X0 = -0.16;
const WIN_X1 = 0.4;
const WIN_Y0 = 0.62;
const WIN_Y1 = 1.58;
const COL_W = (WIN_X1 - WIN_X0) / VENDING_COLUMNS;
const ROW_H = (WIN_Y1 - WIN_Y0) / VENDING_ROWS;
/** The tray a bought thing drops into: its ledge's centre and top, and its mouth's height. */
const TRAY_X = 0.12;
const TRAY_Z = FRONT - 0.1;
const TRAY_TOP = 0.26;
const TRAY_MOUTH_H = 0.3;

/** The machine's key in `WorldState.vendingSold`. */
export function vendingMachineId(poiIndex: number): string {
  return `vend:${poiIndex}`;
}

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
        completedContractId: id,
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
  while (total() > VENDING_SLOTS && counts.gum > 0) counts.gum--;
  while (total() > VENDING_SLOTS && counts.cans > 1) counts.cans--;
  while (total() > VENDING_SLOTS && counts.sticker > 4) counts.sticker--;
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
  const items = new Array<Item | null>(VENDING_SLOTS).fill(null);
  const wares = new Array<Ware | null>(VENDING_SLOTS).fill(null);
  vendingWares(poi.variantSeed).forEach((ware, slot) => {
    items[slot] = makeWare(ware, world.generatedPartId('vend', poi.index, slot), poi.variantSeed, slot);
    wares[slot] = ware;
  });
  return { items, wares };
}

/**
 * Builds a machine standing at absolute (`x`, `z`) on the sand, its front turned by `yaw`,
 * with the goods not yet sold in its window. In the physics band it is solid, its tray
 * holds what drops into it, and it joins the market's registry for the eye ray.
 */
export function buildVendingMachine(
  ctx: ChunkContext,
  poi: Poi,
  x: number,
  z: number,
  yaw: number,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  market: MarketField,
  registered: string[],
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // On the lowest of its four corners, a little sunk: upright on a slope, never on air.
  let y = Infinity;
  for (const [lx, lz] of [[-W / 2, FRONT], [W / 2, FRONT], [-W / 2, -FRONT], [W / 2, -FRONT]] as const) {
    y = Math.min(y, ctx.terrain.heightAt(x + c * lx + s * lz, z - s * lx + c * lz, poi.s));
  }
  y -= 0.04;

  const id = vendingMachineId(poi.index);
  const { items, wares } = vendingStock(ctx.world, poi);
  const sold = ctx.world.state.vendingSold[id] ?? [];

  const root = new THREE.Group();
  root.name = 'vending-machine';
  root.position.set(x - ctx.originX, y, z - ctx.originZ);
  root.rotation.y = yaw;
  box(root, [W, H, D], [0, H / 2, 0], BODY_COLOUR);
  box(root, [W + 0.04, 0.08, D + 0.04], [0, 0.04, 0], C.darkMetal);
  box(root, [W + 0.04, 0.05, D + 0.04], [0, H + 0.025, 0], C.darkMetal);
  // The window: a pale lit back, a frame and a shelf under each row.
  box(root, [WIN_X1 - WIN_X0, WIN_Y1 - WIN_Y0, 0.02], [(WIN_X0 + WIN_X1) / 2, (WIN_Y0 + WIN_Y1) / 2, FRONT - 0.005], 0xbcb8aa);
  const frameZ = FRONT - 0.025;
  box(root, [WIN_X1 - WIN_X0 + 0.06, 0.03, 0.05], [(WIN_X0 + WIN_X1) / 2, WIN_Y1 + 0.015, frameZ], C.darkMetal);
  box(root, [WIN_X1 - WIN_X0 + 0.06, 0.03, 0.05], [(WIN_X0 + WIN_X1) / 2, WIN_Y0 - 0.015, frameZ], C.darkMetal);
  box(root, [0.03, WIN_Y1 - WIN_Y0, 0.05], [WIN_X0 - 0.015, (WIN_Y0 + WIN_Y1) / 2, frameZ], C.darkMetal);
  box(root, [0.03, WIN_Y1 - WIN_Y0, 0.05], [WIN_X1 + 0.015, (WIN_Y0 + WIN_Y1) / 2, frameZ], C.darkMetal);
  for (let row = 1; row < VENDING_ROWS; row++) {
    box(root, [WIN_X1 - WIN_X0, 0.015, 0.06], [(WIN_X0 + WIN_X1) / 2, WIN_Y1 - row * ROW_H, FRONT - 0.03], C.metal);
  }
  // The coin panel: a slot and a column of buttons.
  box(root, [0.17, 0.52, 0.03], [-0.29, 1.15, FRONT - 0.012], C.metal);
  box(root, [0.035, 0.08, 0.012], [-0.29, 1.33, FRONT - 0.03], 0x111314);
  for (let i = 0; i < 3; i++) box(root, [0.08, 0.04, 0.015], [-0.29, 1.18 - i * 0.075, FRONT - 0.03], C.darkMetal);
  // The tray: a dark mouth tall enough for a 20 L can, and the ledge in front of it.
  box(root, [0.5, TRAY_MOUTH_H, 0.02], [TRAY_X, TRAY_TOP + TRAY_MOUTH_H / 2, FRONT - 0.005], 0x16191a);
  box(root, [0.5, 0.03, 0.2], [TRAY_X, TRAY_TOP - 0.015, TRAY_Z], C.darkMetal);
  // The head board: МАГАЗИН.
  const sign = new THREE.Mesh(SIGN_PLANE, signMaterial([TITLE], '#f1e7c8', '#26221c', 512, 128));
  sign.scale.set(0.84, 0.21, 1);
  sign.position.set(0, 1.74, FRONT - 0.006);
  sign.rotation.y = Math.PI;
  root.add(sign);

  const products: (THREE.Object3D | null)[] = new Array<THREE.Object3D | null>(VENDING_SLOTS).fill(null);
  for (let slot = 0; slot < VENDING_SLOTS; slot++) {
    const ware = wares[slot];
    const item = items[slot];
    if (!ware || !item || sold.includes(slot)) continue;
    const look = PRODUCT_LOOK[ware];
    const colour = item.type === 'spray_can' ? item.paint : item.type === 'sun_shades' ? SHADE_LOOK[item.tint] : look.colour;
    const row = Math.floor(slot / VENDING_COLUMNS);
    const column = slot % VENDING_COLUMNS;
    const floor = WIN_Y1 - (row + 1) * ROW_H + 0.008;
    products[slot] = box(
      root,
      look.size,
      [WIN_X1 - (column + 0.5) * COL_W, floor + look.size[1] / 2, FRONT - 0.02 - look.size[2] / 2],
      colour,
    );
  }
  group.add(root);

  if (!ctx.hasPhysics) return;
  addStatic(
    ctx, bodies, colliders, x, y + H / 2, z,
    RAPIER.ColliderDesc.cuboid(W / 2, H / 2, D / 2),
    SurfaceType.Concrete,
    yawRotation(yaw),
  );
  addStatic(
    ctx, bodies, colliders,
    x + c * TRAY_X + s * TRAY_Z, y + TRAY_TOP - 0.015, z - s * TRAY_X + c * TRAY_Z,
    RAPIER.ColliderDesc.cuboid(0.25, 0.015, 0.1),
    SurfaceType.Concrete,
    yawRotation(yaw),
  );
  const machine: VendingMachine = {
    id,
    km: poi.s / 1000,
    x,
    y,
    z,
    yaw,
    stock: items,
    products,
  };
  market.registerMachine(machine);
  registered.push(id);
}

/** Where the eye ray meets a machine's front: its distance, and the window slot or -1. */
export interface VendingAim {
  distance: number;
  slot: number;
}

/**
 * Casts the eye ray (relative frame; `originX`/`originZ` the floating origin) at a
 * machine's front face. False when it misses or comes from behind; otherwise fills `out`.
 * Analytic, no allocation: the face is one plane in the machine's frame.
 */
export function aimVending(
  machine: VendingMachine,
  originX: number,
  originZ: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  out: VendingAim,
): boolean {
  const c = Math.cos(machine.yaw);
  const s = Math.sin(machine.yaw);
  const rx = eyeX - (machine.x - originX);
  const rz = eyeZ - (machine.z - originZ);
  const oz = s * rx + c * rz;
  const lz = s * dx + c * dz;
  if (oz >= FRONT || lz <= 1e-6) return false;
  const t = (FRONT - oz) / lz;
  if (t > maxDistance) return false;
  const hx = c * rx - s * rz + t * (c * dx - s * dz);
  const hy = eyeY - machine.y + t * dy;
  if (hx < -W / 2 || hx > W / 2 || hy < 0 || hy > H) return false;
  out.distance = t;
  out.slot = -1;
  if (hx >= WIN_X0 && hx <= WIN_X1 && hy >= WIN_Y0 && hy <= WIN_Y1) {
    const column = Math.min(VENDING_COLUMNS - 1, Math.floor((WIN_X1 - hx) / COL_W));
    const row = Math.min(VENDING_ROWS - 1, Math.floor((WIN_Y1 - hy) / ROW_H));
    out.slot = row * VENDING_COLUMNS + column;
  }
  return true;
}

/** Where a bought thing is let fall: over the middle of the tray, ABSOLUTE metres. */
export function vendingTrayPoint(machine: VendingMachine): { x: number; y: number; z: number } {
  const c = Math.cos(machine.yaw);
  const s = Math.sin(machine.yaw);
  return {
    x: machine.x + c * TRAY_X + s * TRAY_Z,
    y: machine.y + TRAY_TOP + 0.2,
    z: machine.z - s * TRAY_X + c * TRAY_Z,
  };
}
