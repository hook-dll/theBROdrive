import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { hash01, pick } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import type { GameWorld } from '../game/state';
import { makeSponge, type Item } from '../items/items';
import { IMPORT_ENGINE_IDS, type PartInstance } from '../parts/registry';
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
 * The vending machines: where everything the road used to leave lying about is bought.
 *
 * One stands in front of every fuel and store stop. Its window is four rows of up to three
 * units; each row holds one ware. What it holds is a pure function of the stop (its seed
 * and its km band), so the machine needs no saved stock of its own: `vendingSold` records
 * which slots were paid for, and those stay empty for good. A machine never restocks.
 *
 * Prices are not set here: the economy prices each item where the machine stands
 * (`itemPrice`, economy/economy.ts), so further down the road the same can costs more.
 */

/** Domain tag for the vending rolls. */
const VENDING_DOMAIN = 0x56454e31; // 'VEN1'
/** Kilometres per assortment band: rarer wares unlock band by band, not metre by metre. */
const KM_BAND = 25;

export type VendingAssortment = 'fuel' | 'parts' | 'mixed';

type Ware =
  | 'petrol20'
  | 'petrol10'
  | 'petrol5'
  | 'oil5'
  | 'water5'
  | 'gum'
  | 'medicine'
  | 'sponge'
  | 'spray'
  | 'air_filter'
  | 'radiator'
  | 'turbine'
  | 'engine';

/** A ware a machine may stock, by weight, from `fromKm` down the road on. */
interface WareRow {
  readonly ware: Ware;
  readonly weight: number;
  readonly fromKm: number;
}

/**
 * What each kind of machine sells. A fuel machine is mostly petrol in three can sizes
 * with the engine's other two fluids; a parts machine sells the service parts, the
 * turbocharger from 75 km on and an imported engine past 150 km; a mixed one a bit of
 * everything a driver runs out of.
 */
const POOLS: Readonly<Record<VendingAssortment, readonly WareRow[]>> = {
  fuel: [
    { ware: 'petrol20', weight: 3, fromKm: 0 },
    { ware: 'petrol10', weight: 3, fromKm: 0 },
    { ware: 'petrol5', weight: 3, fromKm: 0 },
    { ware: 'oil5', weight: 1.5, fromKm: 0 },
    { ware: 'water5', weight: 1.5, fromKm: 0 },
    { ware: 'gum', weight: 0.5, fromKm: 0 },
  ],
  parts: [
    { ware: 'air_filter', weight: 3, fromKm: 0 },
    { ware: 'oil5', weight: 1.5, fromKm: 0 },
    { ware: 'water5', weight: 1, fromKm: 0 },
    { ware: 'sponge', weight: 1.2, fromKm: 0 },
    { ware: 'spray', weight: 1, fromKm: 0 },
    { ware: 'radiator', weight: 1.2, fromKm: 25 },
    { ware: 'turbine', weight: 0.6, fromKm: 75 },
    { ware: 'engine', weight: 0.35, fromKm: 150 },
  ],
  mixed: [
    { ware: 'petrol10', weight: 2, fromKm: 0 },
    { ware: 'petrol5', weight: 2, fromKm: 0 },
    { ware: 'oil5', weight: 1.5, fromKm: 0 },
    { ware: 'water5', weight: 1.5, fromKm: 0 },
    { ware: 'gum', weight: 1.2, fromKm: 0 },
    { ware: 'medicine', weight: 0.8, fromKm: 0 },
    { ware: 'sponge', weight: 1, fromKm: 0 },
    { ware: 'air_filter', weight: 1, fromKm: 0 },
    { ware: 'spray', weight: 0.6, fromKm: 0 },
  ],
};

const TITLE: Readonly<Record<VendingAssortment, string>> = { fuel: 'FUEL', parts: 'PARTS', mixed: 'GOODS' };
const BODY_COLOUR: Readonly<Record<VendingAssortment, number>> = {
  fuel: C.fadedRed,
  parts: C.fadedBlue,
  mixed: C.fadedGreen,
};

/** How each ware looks in the window: a coloured block of its size, metres [w, h, d]. */
const PRODUCT_LOOK: Readonly<Record<Ware, { readonly colour: number; readonly size: readonly [number, number, number] }>> = {
  petrol20: { colour: 0xb03a2e, size: [0.15, 0.17, 0.08] },
  petrol10: { colour: 0xb03a2e, size: [0.12, 0.14, 0.07] },
  petrol5: { colour: 0xb03a2e, size: [0.1, 0.12, 0.06] },
  oil5: { colour: 0x3a3f4c, size: [0.1, 0.12, 0.06] },
  water5: { colour: 0x2f6fa8, size: [0.1, 0.12, 0.06] },
  gum: { colour: 0xd46a9a, size: [0.1, 0.05, 0.04] },
  medicine: { colour: 0xe8e4da, size: [0.05, 0.09, 0.05] },
  sponge: { colour: 0xd8b84a, size: [0.12, 0.06, 0.07] },
  spray: { colour: 0xffffff, size: [0.05, 0.15, 0.05] },
  air_filter: { colour: 0xc87a35, size: [0.14, 0.07, 0.1] },
  radiator: { colour: 0x7a8288, size: [0.15, 0.15, 0.03] },
  turbine: { colour: 0x9a9a92, size: [0.13, 0.12, 0.1] },
  engine: { colour: 0x4a4f52, size: [0.16, 0.16, 0.1] },
};

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
/** The tray a bought thing drops into: its ledge's centre and top. */
const TRAY_X = 0.12;
const TRAY_Z = FRONT - 0.1;
const TRAY_TOP = 0.26;

/** What machine a stop has, or null: one at every fuel and store stop. */
export function vendingAssortment(poi: Poi): VendingAssortment | null {
  const roll = hash01(poi.variantSeed, VENDING_DOMAIN, 0);
  if (poi.stock === 'fuel') return roll < 0.7 ? 'fuel' : 'mixed';
  if (poi.stock === 'store') return roll < 0.5 ? 'parts' : 'mixed';
  return null;
}

/** The machine's key in `WorldState.vendingSold`. */
export function vendingMachineId(poiIndex: number): string {
  return `vend:${poiIndex}`;
}

function makeWare(ware: Ware, id: string, seed: number, slot: number): Item {
  const can = (fluid: 'petrol' | 'oil' | 'water', litres: number): Item => ({
    type: 'fluid_can',
    id,
    fluid,
    capacity: litres,
    litres,
  });
  const part = (variantId: string): Item => {
    const instance: PartInstance = { id, variantId, dirt: 0, rust: 0 };
    if (variantId === 'air_filter') instance.clog = 0;
    return { type: 'part', id, part: instance };
  };
  switch (ware) {
    case 'petrol20':
      return can('petrol', 20);
    case 'petrol10':
      return can('petrol', 10);
    case 'petrol5':
      return can('petrol', 5);
    case 'oil5':
      return can('oil', 5);
    case 'water5':
      return can('water', 5);
    case 'gum':
      return { type: 'bubble_gum', id, charges: 5 };
    case 'medicine':
      return { type: 'medicine', id };
    case 'sponge':
      return makeSponge(id, hash01(seed, VENDING_DOMAIN, slot, 41));
    case 'spray':
      return { type: 'spray_can', id, paint: pick(CAR_PAINTS, seed, VENDING_DOMAIN, slot, 43).hex, charge: 1 };
    case 'air_filter':
      return part('air_filter');
    case 'radiator':
      return part('radiator');
    case 'turbine':
      return part('turbine_standard');
    case 'engine':
      return part(pick(IMPORT_ENGINE_IDS, seed, VENDING_DOMAIN, slot, 47));
  }
}

/**
 * What a machine was stocked with, by slot, and the ware behind each (for its look).
 * Each row draws one ware from the pool its km band has unlocked and holds one to three
 * of it; an engine fills its row alone.
 */
export function vendingStock(
  world: GameWorld,
  poi: Poi,
  assortment: VendingAssortment,
): { readonly items: (Item | null)[]; readonly wares: (Ware | null)[] } {
  const bandKm = Math.floor(poi.s / 1000 / KM_BAND) * KM_BAND;
  const pool = POOLS[assortment].filter((row) => row.fromKm <= bandKm);
  const total = pool.reduce((sum, row) => sum + row.weight, 0);
  const items = new Array<Item | null>(VENDING_SLOTS).fill(null);
  const wares = new Array<Ware | null>(VENDING_SLOTS).fill(null);
  for (let row = 0; row < VENDING_ROWS; row++) {
    let roll = hash01(poi.variantSeed, VENDING_DOMAIN, bandKm, 10 + row) * total;
    let ware = pool[0]!.ware;
    for (const entry of pool) {
      roll -= entry.weight;
      if (roll < 0) {
        ware = entry.ware;
        break;
      }
    }
    const units = ware === 'engine' ? 1 : 1 + Math.floor(hash01(poi.variantSeed, VENDING_DOMAIN, 20 + row) * VENDING_COLUMNS);
    for (let column = 0; column < units; column++) {
      const slot = row * VENDING_COLUMNS + column;
      items[slot] = makeWare(ware, world.generatedPartId('vend', poi.index, slot), poi.variantSeed, slot);
      wares[slot] = ware;
    }
  }
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
  assortment: VendingAssortment,
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
  const { items, wares } = vendingStock(ctx.world, poi, assortment);
  const sold = ctx.world.state.vendingSold[id] ?? [];

  const root = new THREE.Group();
  root.name = 'vending-machine';
  root.position.set(x - ctx.originX, y, z - ctx.originZ);
  root.rotation.y = yaw;
  const body = BODY_COLOUR[assortment];
  box(root, [W, H, D], [0, H / 2, 0], body);
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
  // The tray: a dark mouth and the ledge in front of it.
  box(root, [0.5, 0.2, 0.02], [TRAY_X, 0.36, FRONT - 0.005], 0x16191a);
  box(root, [0.5, 0.03, 0.2], [TRAY_X, TRAY_TOP - 0.015, TRAY_Z], C.darkMetal);
  // The head sign naming what it sells.
  const sign = new THREE.Mesh(SIGN_PLANE, signMaterial([TITLE[assortment]], '#f1e7c8', '#26221c', 512, 128));
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
    const colour = item.type === 'spray_can' ? item.paint : look.colour;
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
    title: TITLE[assortment],
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
