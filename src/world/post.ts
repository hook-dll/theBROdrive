import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { SurfaceType } from '../core/surfaces';
import { offerDestinationIndex, postStock, POST_OFFER_COUNT } from '../contracts/offers';
import {
  contractAcceptRefusal,
  contractDeliveredText,
  contractDeliveryEffect,
  contractPosting,
  contractRelease,
  contractRewardSticker,
} from '../contracts/registry';
import type { DeliveryProbe } from '../contracts/types';
import { postHaulPlace } from '../contracts/world';
import { contractPay, giveCoins, licenceFor } from '../economy/economy';
import type { GameWorld } from '../game/state';
import {
  contractTier,
  isHaulKind,
  itemLabel,
  type ContractCargoItem,
  type Item,
  type StickerEnvelopeItem,
} from '../items/items';
import type { ChunkContext } from './chunks';
import { rayBox, type FixtureContext, type FixtureField, type WorldFixture } from './fixturefield';
import { paintSign, SIGN_PLANE, signMaterial } from './market';
import { box, C, cylinder } from './poi/kit';
import { postId, postStop, type PostStop } from './poststops';
import { addStatic, yawRotation } from './props/scatter';

/**
 * THE «ПОЧТА» MACHINE (game-design2.md §7): where contracts are taken and handed in, by
 * hand. One stands at every settlement's `post` spot (world/settlement.ts), the physical
 * face of the post network (world/poststops.ts) and its four offers (contracts/offers.ts).
 *
 * A blue cabinet under a «ПОЧТА» board, its front to the road, with five working parts,
 * each aimed on its own:
 *  - the SELECTOR WHEEL: F turns it one click to the next offer still in stock; the
 *    DISPLAY above shows that offer — its name, the destination's place name and distance,
 *    the reward, the cargo kind and its tier.
 *  - the RELEASE LEVER on the right flank: F pulls it. The selected offer's cargo falls
 *    into the delivery tray behind a little door (a passenger party is one teddy each);
 *    a haul's papers are handed straight over instead (its trailer or car waits on the
 *    lay-by, contracts/world.ts). Without the licence for the kind (economy `licenceFor`),
 *    or with full hands for the papers, the lever jams and the prompt says why.
 *  - the TRAY DOOR: F opens and shuts it; what fell in is a real loose item on the tray.
 *  - the DROP-OFF HATCH: with cargo bound here in hand, F posts it through the flap. The
 *    delivery pays its coins into the pack and drops the signed sticker envelope into the
 *    tray. A haul is handed in here too, with its trailer or car on the lay-by and its papers
 *    in hand, in the pack or in a boot. A registered parcel opens the rotary dial first
 *    (ui/dial.ts) and needs the PIN printed on its label.
 *
 * What the machine still holds is saved in `WorldState.courierStorage` (`courier_storage`
 * delta, the saved shape of the courier days): see `postStock`. Things an old save left in
 * a courier's boot come back through the tray when its door is first opened.
 *
 * Built of POI kit boxes and cylinders (flat materials) and sign-shaped boards whose
 * programs `marketProgramAnchor` links at boot; the display is one sign material per
 * machine whose canvas is repainted in place, so no shader program links mid-drive.
 */

// The cabinet, local metres: base centre at the origin, front facing -Z, so the
// viewer's left is local +X (as the vending machine).
const W = 0.8;
const H = 1.7;
const D = 0.5;
const FRONT = -D / 2;
const BODY_COLOUR = 0x3e5f86;

const BOARD_Y = 1.56;
const DISPLAY_Y = 1.25;
const DISPLAY_W = 0.6;
const DISPLAY_H = 0.28;

const WHEEL_X = -0.23;
const WHEEL_Y = 0.9;
const WHEEL_R = 0.1;
/** One click of the wheel, radians: eight detents to the turn. */
const WHEEL_STEP = Math.PI / 4;

const HATCH_X = 0.13;
const HATCH_Y = 0.9;
const HATCH_W = 0.34;
const HATCH_H = 0.16;
/** The flap swings in this far as a thing goes through, radians. */
const FLAP_OPEN = -1.15;

const LEVER_Y = 0.95;
const LEVER_Z = FRONT + 0.14;
/** The lever's swing toward the viewer, radians: pulled home, and as far as a jam lets it. */
const LEVER_PULLED = -1.3;
const LEVER_JAM = -0.26;

/** The tray: a compartment standing out of the front at the bottom. */
const TRAY_W = 0.56;
const TRAY_DEPTH = 0.32;
const TRAY_FLOOR = 0.3;
const TRAY_TOP = 0.64;
const TRAY_Z = FRONT - TRAY_DEPTH / 2;
/** The door's hinge runs along the compartment's top front edge; open it lies out flat. */
const DOOR_OPEN = 1.5;

/** Timelines, seconds. */
const PULL_DOWN_S = 0.28;
const LEVER_RETURN_S = 0.6;
const JAM_S = 0.45;
const FLAP_S = 0.55;
/** How long a jam's reason stays on the prompt. */
const JAM_TEXT_S = 3.5;

type Part = 'body' | 'wheel' | 'lever' | 'door' | 'hatch';

/** The cargo kind as the display prints it. */
function kindText(offer: ContractCargoItem): string {
  if (offer.party) return `passengers ×${offer.party.size}`;
  if (isHaulKind(offer.contractKind)) return 'haul';
  switch (offer.contractKind) {
    case 'fragile_radio':
      return 'fragile';
    case 'heavy_crate':
      return 'heavy';
    default:
      return 'parcel';
  }
}

/**
 * Builds stop `stop`'s machine at ABSOLUTE (`x`, `z`) on the sand, its front turned by
 * `yaw` (front local -Z: the settlement spot's convention). In the physics band it is
 * solid and registers its fixture (id pushed to `registered`, for the chunk to forget);
 * beyond it, it is only seen. `disposers` gets the display's own material.
 */
export function buildPost(
  ctx: ChunkContext,
  stop: PostStop,
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
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const local = (lx: number, lz: number): [number, number] => [x + c * lx + s * lz, z - s * lx + c * lz];
  // On the lowest corner of the cabinet and the tray, a little sunk: upright on a slope.
  let y = Infinity;
  for (const [lx, lz] of [[-W / 2, FRONT - TRAY_DEPTH], [W / 2, FRONT - TRAY_DEPTH], [-W / 2, -FRONT], [W / 2, -FRONT]] as const) {
    const [wx, wz] = local(lx, lz);
    y = Math.min(y, ctx.terrain.heightAt(wx, wz, stop.s));
  }
  y -= 0.04;

  const root = new THREE.Group();
  root.name = 'post-machine';
  root.position.set(x - ctx.originX, y, z - ctx.originZ);
  root.rotation.y = yaw;
  box(root, [W, H, D], [0, H / 2, 0], BODY_COLOUR);
  box(root, [W + 0.04, 0.08, D + 0.04], [0, 0.04, 0], C.darkMetal);
  box(root, [W + 0.06, 0.05, D + 0.06], [0, H + 0.025, 0], C.darkMetal);
  // The head board: ПОЧТА.
  const board = new THREE.Mesh(SIGN_PLANE, signMaterial(['ПОЧТА'], '#f2ecd8', '#1f3f7a', 512, 128));
  board.scale.set(0.74, 0.18, 1);
  board.position.set(0, BOARD_Y, FRONT - 0.006);
  board.rotation.y = Math.PI;
  root.add(board);
  // The display: a dark frame and its window, repainted with the selected offer.
  box(root, [DISPLAY_W + 0.06, DISPLAY_H + 0.06, 0.03], [0, DISPLAY_Y, FRONT - 0.012], C.darkMetal);
  const displayMaterial = paintSign([''], '#101810', '#e8b048', 512, 240);
  disposers.push(() => {
    displayMaterial.map?.dispose();
    displayMaterial.dispose();
  });
  const display = new THREE.Mesh(SIGN_PLANE, displayMaterial);
  display.scale.set(DISPLAY_W, DISPLAY_H, 1);
  display.position.set(0, DISPLAY_Y, FRONT - 0.029);
  display.rotation.y = Math.PI;
  root.add(display);

  // The selector wheel: a steel disc on a hub, spokes and a red knob, turning about its
  // own axis (local Z); a fixed pointer over it marks the detent.
  const wheel = new THREE.Group();
  wheel.position.set(WHEEL_X, WHEEL_Y, FRONT - 0.03);
  cylinder(wheel, WHEEL_R, WHEEL_R, 0.035, 20, [0, 0, 0], C.metal, [Math.PI / 2, 0, 0]);
  cylinder(wheel, 0.03, 0.03, 0.05, 12, [0, 0, -0.01], C.darkMetal, [Math.PI / 2, 0, 0]);
  for (let k = 0; k < 4; k++) {
    box(wheel, [0.012, WHEEL_R * 1.7, 0.012], [0, 0, -0.022], C.darkMetal, [0, 0, (k * Math.PI) / 4]);
  }
  box(wheel, [0.03, 0.03, 0.04], [0, WHEEL_R * 0.72, -0.035], C.fadedRed);
  root.add(wheel);
  box(root, [0.02, 0.035, 0.02], [WHEEL_X, WHEEL_Y + WHEEL_R + 0.03, FRONT - 0.015], C.ochre);
  const selectorPlate = new THREE.Mesh(SIGN_PLANE, signMaterial(['ВЫБОР'], '#f2ecd8', '#26221c', 256, 64));
  selectorPlate.scale.set(0.16, 0.04, 1);
  selectorPlate.position.set(WHEEL_X, WHEEL_Y - WHEEL_R - 0.045, FRONT - 0.002);
  selectorPlate.rotation.y = Math.PI;
  root.add(selectorPlate);

  // The drop-off hatch: a dark mouth and its flap, hinged along the top, and its plate.
  box(root, [HATCH_W + 0.04, HATCH_H + 0.04, 0.02], [HATCH_X, HATCH_Y, FRONT - 0.008], C.darkMetal);
  box(root, [HATCH_W, HATCH_H, 0.01], [HATCH_X, HATCH_Y, FRONT - 0.019], 0x111314);
  const flap = new THREE.Group();
  flap.position.set(HATCH_X, HATCH_Y + HATCH_H / 2, FRONT - 0.022);
  box(flap, [HATCH_W - 0.01, HATCH_H - 0.005, 0.012], [0, -HATCH_H / 2, 0], C.metal);
  box(flap, [0.1, 0.014, 0.02], [0, -HATCH_H + 0.02, -0.012], C.darkMetal);
  root.add(flap);
  const hatchPlate = new THREE.Mesh(SIGN_PLANE, signMaterial(['ПРИЁМ'], '#f2ecd8', '#26221c', 256, 64));
  hatchPlate.scale.set(0.2, 0.05, 1);
  hatchPlate.position.set(HATCH_X, HATCH_Y + HATCH_H / 2 + 0.05, FRONT - 0.002);
  hatchPlate.rotation.y = Math.PI;
  root.add(hatchPlate);

  // The release lever on the viewer's right flank (local -X): a hub and an arm with a red
  // knob, swinging about local X toward the viewer.
  const lever = new THREE.Group();
  lever.position.set(-W / 2 - 0.02, LEVER_Y, LEVER_Z);
  box(lever, [0.04, 0.07, 0.07], [0, 0, 0], C.darkMetal);
  box(lever, [0.025, 0.28, 0.025], [-0.02, 0.14, 0], C.metal);
  box(lever, [0.055, 0.055, 0.055], [-0.02, 0.29, 0], C.fadedRed);
  root.add(lever);

  // The tray: floor, walls and lid standing out of the front, a dark back, and the little
  // door hinged along its top front edge.
  box(root, [TRAY_W, 0.03, TRAY_DEPTH], [0, TRAY_FLOOR - 0.015, TRAY_Z], C.darkMetal);
  box(root, [0.02, TRAY_TOP - TRAY_FLOOR, TRAY_DEPTH], [TRAY_W / 2, (TRAY_TOP + TRAY_FLOOR) / 2, TRAY_Z], BODY_COLOUR);
  box(root, [0.02, TRAY_TOP - TRAY_FLOOR, TRAY_DEPTH], [-TRAY_W / 2, (TRAY_TOP + TRAY_FLOOR) / 2, TRAY_Z], BODY_COLOUR);
  box(root, [TRAY_W + 0.04, 0.03, TRAY_DEPTH + 0.02], [0, TRAY_TOP + 0.015, TRAY_Z - 0.01], C.darkMetal);
  box(root, [TRAY_W - 0.02, TRAY_TOP - TRAY_FLOOR, 0.01], [0, (TRAY_TOP + TRAY_FLOOR) / 2, FRONT - 0.006], 0x16191a);
  const door = new THREE.Group();
  door.position.set(0, TRAY_TOP, FRONT - TRAY_DEPTH - 0.008);
  box(door, [TRAY_W - 0.01, TRAY_TOP - TRAY_FLOOR - 0.005, 0.014], [0, -(TRAY_TOP - TRAY_FLOOR) / 2, 0], C.metal);
  box(door, [0.12, 0.02, 0.025], [0, -(TRAY_TOP - TRAY_FLOOR) + 0.04, -0.015], C.darkMetal);
  root.add(door);

  group.add(root);

  const haul = postHaulPlace(ctx.world.seed, ctx.road, stop.index);
  const machine = new PostMachine(ctx.world, stop, haul.x, haul.z, x, y, z, yaw, wheel, lever, door, flap, displayMaterial);
  if (!ctx.hasPhysics) return;

  addStatic(
    ctx, bodies, colliders, x, y + H / 2, z,
    RAPIER.ColliderDesc.cuboid(W / 2, H / 2, D / 2),
    SurfaceType.Concrete,
    yawRotation(yaw),
  );
  // The tray's floor, walls and a low lip at its mouth, so what falls in stays in.
  const solid = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number): void => {
    const [wx, wz] = local(lx, lz);
    addStatic(ctx, bodies, colliders, wx, y + ly, wz, RAPIER.ColliderDesc.cuboid(hx, hy, hz), SurfaceType.Concrete, yawRotation(yaw));
  };
  solid(0, TRAY_FLOOR - 0.015, TRAY_Z, TRAY_W / 2, 0.015, TRAY_DEPTH / 2);
  solid(TRAY_W / 2, (TRAY_TOP + TRAY_FLOOR) / 2, TRAY_Z, 0.01, (TRAY_TOP - TRAY_FLOOR) / 2, TRAY_DEPTH / 2);
  solid(-TRAY_W / 2, (TRAY_TOP + TRAY_FLOOR) / 2, TRAY_Z, 0.01, (TRAY_TOP - TRAY_FLOOR) / 2, TRAY_DEPTH / 2);
  solid(0, TRAY_TOP + 0.015, TRAY_Z, TRAY_W / 2, 0.015, TRAY_DEPTH / 2);
  solid(0, TRAY_FLOOR + 0.03, FRONT - TRAY_DEPTH + 0.01, TRAY_W / 2, 0.03, 0.01);

  registered.push(fixtures.register(machine));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** A delivery the hatch would take now: the cargo and where it is held. */
interface Posting {
  readonly item: ContractCargoItem;
  /** In the pack (or the hands), or in a car's boot cell or cabin place. */
  readonly from: { readonly carId: string; readonly cell: number; readonly cabin: boolean } | null;
}

class PostMachine implements WorldFixture {
  readonly id: string;
  private part: Part | null = null;
  /** The offers by slot, null once released, and what an old save left inside. */
  private offers: (ContractCargoItem | null)[];
  private strays: Item[];
  /** The slot the wheel stands at, or -1 with nothing left. */
  private selected = -1;
  /** The wheel's angle and where its last click is taking it. */
  private wheelAngle = 0;
  private wheelTarget = 0;
  /** Seconds into a pull, or -1; seconds left of a jam's rattle and of its reason. */
  private pullT = -1;
  private jamT = 0;
  private jamText = '';
  private jamTextT = 0;
  private doorOpen = false;
  private doorAngle = 0;
  /** Seconds into the flap's swing, or -1; seconds left of a refused flap's rattle. */
  private flapT = -1;
  private flapJam = 0;
  /** The registered parcel whose PIN was dialled here, so the hatch takes it. */
  private dialledFor: string | null = null;

  constructor(
    private readonly world: GameWorld,
    private readonly stop: PostStop,
    /** ABSOLUTE metres of the lay-by place where hauls are left and handed in. */
    private readonly haulX: number,
    private readonly haulZ: number,
    /** ABSOLUTE metres of the cabinet's base centre. */
    private readonly x: number,
    private readonly y: number,
    private readonly z: number,
    private readonly yaw: number,
    private readonly wheel: THREE.Object3D,
    private readonly lever: THREE.Object3D,
    private readonly door: THREE.Object3D,
    private readonly flap: THREE.Object3D,
    private readonly displayMaterial: THREE.MeshStandardMaterial,
  ) {
    this.id = `post:${stop.index}`;
    const stock = postStock(world.state, world.seed, stop.index);
    this.offers = stock.offers.slice();
    this.strays = stock.strays.slice();
    this.selected = this.offers.findIndex((offer) => offer !== null);
    this.paintDisplay();
  }

  /** The tray's middle, ABSOLUTE metres, a little over its floor; `k` spreads several. */
  private trayPoint(k: number, of: number): { x: number; y: number; z: number } {
    const lx = of > 1 ? (k - (of - 1) / 2) * 0.16 : 0;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return { x: this.x + c * lx + s * TRAY_Z, y: this.y + TRAY_FLOOR + 0.12, z: this.z - s * lx + c * TRAY_Z };
  }

  /** Writes the stock as it stands: the offers by slot, nothing else. */
  private saveStock(extra?: { consumedItemId?: string; completedContractId?: string; completedContractKind?: ContractCargoItem['contractKind'] }): void {
    this.world.apply({ t: 'courier_storage', courierId: postId(this.stop.index), cells: this.offers.slice(), ...extra });
  }

  private paintDisplay(): void {
    // The headless tools build stops with no DOM: their display is a blank data texture.
    const map = this.displayMaterial.map;
    const canvas: unknown = map?.image;
    if (!map || typeof HTMLCanvasElement === 'undefined' || !(canvas instanceof HTMLCanvasElement)) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const w = canvas.width;
    const h = canvas.height;
    g.fillStyle = '#0f1a12';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8b048';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const offer = this.selected >= 0 ? this.offers[this.selected] ?? null : null;
    const left = this.offers.filter((o) => o !== null).length;
    if (!offer) {
      g.textAlign = 'center';
      g.font = 'bold 44px monospace';
      g.fillText('НЕТ ПОСЫЛОК', w / 2, h * 0.42);
      g.font = '28px monospace';
      g.fillText('no offers left', w / 2, h * 0.7);
    } else {
      const destination = offerDestinationIndex(offer);
      const km = (postStop(this.world.seed, destination).s - this.stop.s) / 1000;
      const row = (text: string, at: number, size: number): void => {
        g.font = `bold ${size}px monospace`;
        g.fillText(text, 18, h * at, w - 36);
      };
      row(offer.cargoName, 0.15, 34);
      row(`→ ${offer.destination ?? 'next post'}  ${km.toFixed(1)} km`, 0.38, 30);
      row(`${contractPay(this.world.seed, offer)} coins · ${kindText(offer)}`, 0.6, 30);
      row(`${contractTier(offer)}${offer.registeredPin ? ' · registered' : ''}`, 0.82, 26);
      g.textAlign = 'right';
      g.font = 'bold 26px monospace';
      g.fillText(`${this.offers.slice(0, this.selected + 1).filter((o) => o !== null).length}/${left}`, w - 18, h * 0.82);
    }
    // Scan lines, so it reads as a lit window rather than paper.
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let line = 0; line < h; line += 4) g.fillRect(0, line, w, 1);
    map.needsUpdate = true;
  }

  aim(
    originX: number,
    originZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    dx: number,
    dy: number,
    dz: number,
    range: number,
  ): number {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const rx = eyeX - (this.x - originX);
    const rz = eyeZ - (this.z - originZ);
    const ox = c * rx - s * rz;
    const oy = eyeY - this.y;
    const oz = s * rx + c * rz;
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    let best = rayBox(ox, oy, oz, lx, dy, lz, 0, H / 2, 0, W / 2, H / 2, D / 2);
    let part: Part = 'body';
    const test = (p: Part, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void => {
      const t = rayBox(ox, oy, oz, lx, dy, lz, cx, cy, cz, hx, hy, hz);
      if (t < best) {
        best = t;
        part = p;
      }
    };
    test('wheel', WHEEL_X, WHEEL_Y, FRONT - 0.04, WHEEL_R + 0.02, WHEEL_R + 0.02, 0.045);
    test('hatch', HATCH_X, HATCH_Y, FRONT - 0.025, HATCH_W / 2 + 0.02, HATCH_H / 2 + 0.02, 0.035);
    test('lever', -W / 2 - 0.04, LEVER_Y + 0.13, LEVER_Z - 0.08, 0.05, 0.19, 0.16);
    if (this.doorAngle < 0.3) {
      // Shut, the door covers the whole compartment.
      test('door', 0, (TRAY_TOP + TRAY_FLOOR) / 2, TRAY_Z - 0.01, TRAY_W / 2 + 0.01, (TRAY_TOP - TRAY_FLOOR) / 2 + 0.02, TRAY_DEPTH / 2 + 0.02);
    } else {
      // Open, only the door itself, lying out over the tray: what lies inside is aimed past it.
      test('door', 0, TRAY_TOP + 0.02, FRONT - TRAY_DEPTH - (TRAY_TOP - TRAY_FLOOR) / 2, TRAY_W / 2, 0.035, (TRAY_TOP - TRAY_FLOOR) / 2);
      // The compartment's lid and walls are the body; its open mouth is not.
    }
    this.part = best > range ? null : part;
    return best > range ? Infinity : best;
  }

  private selectedOffer(): ContractCargoItem | null {
    return this.selected >= 0 ? this.offers[this.selected] ?? null : null;
  }

  private probe(ctx: FixtureContext): DeliveryProbe {
    return ctx.probe(this.stop.index, this.haulX, this.haulZ);
  }

  /** What the hatch would take: the cargo in hand, else a haul's papers bound here. */
  private posting(ctx: FixtureContext): { posting: Posting | null; refusal: string | null } {
    const held = ctx.held;
    if (held?.type === 'contract_cargo') {
      return { posting: { item: held, from: null }, refusal: contractAcceptRefusal(held, this.probe(ctx)) };
    }
    if (held !== null) return { posting: null, refusal: null };
    // Empty hands: a haul is handed in by its papers wherever they are, with its trailer
    // or car on the lay-by.
    let refusal: string | null = null;
    const consider = (item: Item | null, from: Posting['from']): Posting | null => {
      if (item?.type !== 'contract_cargo' || !isHaulKind(item.contractKind)) return null;
      // Papers from this post itself are the job just taken, not one to hand in.
      if (item.sourceCourierIndex >= this.stop.index) return null;
      const why = contractAcceptRefusal(item, this.probe(ctx));
      if (why === null) return { item, from };
      refusal ??= why;
      return null;
    };
    for (const item of ctx.inventory.all) {
      const found = consider(item, null);
      if (found) return { posting: found, refusal: null };
    }
    for (const [carId, car] of Object.entries(this.world.state.cars)) {
      for (let cell = 0; cell < car.storage.length; cell++) {
        const found = consider(car.storage[cell] ?? null, { carId, cell, cabin: false });
        if (found) return { posting: found, refusal: null };
      }
      for (let cell = 0; cell < car.cabin.length; cell++) {
        const found = consider(car.cabin[cell] ?? null, { carId, cell, cabin: true });
        if (found) return { posting: found, refusal: null };
      }
    }
    return { posting: null, refusal };
  }

  prompt(ctx: FixtureContext): string | null {
    const offer = this.selectedOffer();
    switch (this.part) {
      case 'wheel': {
        const left = this.offers.filter((o) => o !== null).length;
        return left > 1 ? `[F] turn the selector — ${left} offers` : left === 1 ? 'selector — one offer left' : 'selector — no offers left';
      }
      case 'lever':
        if (this.jamTextT > 0) return `lever jammed — ${this.jamText}`;
        if (!offer) return 'release lever — nothing selected';
        return `[F] pull the lever — ${itemLabel(offer)}`;
      case 'door':
        if (this.doorAngle >= 0.3 || this.doorOpen) return '[F] shut the little door';
        return this.strays.length > 0
          ? '[F] open the little door — something was left for you'
          : '[F] open the little door';
      case 'hatch': {
        const { posting, refusal } = this.posting(ctx);
        if (!posting) return refusal ?? 'drop-off slot — post cargo bound here';
        if (refusal) return refusal;
        // One teddy of a party pays nothing on its own: the last of them pays the party.
        const party = contractPosting(posting.item, this.world.state.completedContractIds);
        if (!party.completes) return `[F] post ${itemLabel(posting.item)} — ${party.left} more to go`;
        const pay = contractPay(this.world.seed, posting.item);
        if (posting.item.registeredPin && this.dialledFor !== posting.item.id) {
          return `[F] registered — dial the PIN to post ${itemLabel(posting.item)}`;
        }
        return `[F] ${posting.from || isHaulKind(posting.item.contractKind) ? 'hand in' : 'post'} ${itemLabel(posting.item)} — ${pay} coins`;
      }
      case 'body':
        return offer ? `ПОЧТА — ${itemLabel(offer)}` : 'ПОЧТА — no offers left';
      default:
        return null;
    }
  }

  press(ctx: FixtureContext): FoleyEvent | null {
    switch (this.part) {
      case 'wheel':
        return this.turn();
      case 'lever':
        return this.pull(ctx);
      case 'door':
        return this.workDoor(ctx);
      case 'hatch':
        return this.post(ctx);
      default:
        return null;
    }
  }

  private turn(): FoleyEvent {
    this.wheelTarget += WHEEL_STEP;
    for (let k = 1; k <= POST_OFFER_COUNT; k++) {
      const slot = (this.selected + k + POST_OFFER_COUNT) % POST_OFFER_COUNT;
      if (this.offers[slot]) {
        this.selected = slot;
        break;
      }
    }
    this.paintDisplay();
    return 'click';
  }

  private jam(reason: string): FoleyEvent {
    this.jamT = JAM_S;
    this.jamText = reason;
    this.jamTextT = JAM_TEXT_S;
    return 'refused';
  }

  private pull(ctx: FixtureContext): FoleyEvent {
    if (this.pullT >= 0) return 'refused';
    const offer = this.selectedOffer();
    if (!offer) return this.jam('nothing selected');
    const licence = licenceFor(this.world.state, offer.contractKind);
    if (!licence.ok) return this.jam(licence.reason ?? 'no licence for this cargo');
    const haul = isHaulKind(offer.contractKind);
    if (haul && ctx.held !== null) return this.jam('free your hands to take the papers');
    // The stock first, so the cargo never exists twice.
    this.offers[this.selected] = null;
    this.saveStock();
    if (haul) {
      // The papers come out of the slot into the hand; the trailer or car is on the lay-by.
      if (!ctx.take(offer)) {
        const at = this.trayPoint(0, 1);
        ctx.drop(offer, at.x, at.y, at.z);
      }
      ctx.toast(`${offer.cargoName} — its ${offer.contractKind === 'trailer_equipment' || offer.contractKind === 'oversize' ? 'trailer' : 'car'} is on the lay-by`);
    } else {
      // Into the tray, behind its door.
      this.doorOpen = false;
      const items = contractRelease(offer);
      items.forEach((item, k) => {
        const at = this.trayPoint(k, items.length);
        ctx.drop(item, at.x, at.y, at.z);
      });
    }
    this.selected = this.offers.findIndex((o) => o !== null);
    this.pullT = 0;
    this.paintDisplay();
    return 'mount';
  }

  private workDoor(ctx: FixtureContext): FoleyEvent {
    this.doorOpen = !(this.doorOpen || this.doorAngle >= 0.3);
    if (this.doorOpen && this.strays.length > 0) {
      // What a courier's boot held in an old save comes back here, once.
      const strays = this.strays;
      this.strays = [];
      this.saveStock();
      strays.forEach((item, k) => {
        const at = this.trayPoint(k, strays.length);
        ctx.drop(item, at.x, at.y, at.z);
      });
    }
    return this.doorOpen ? 'door-open' : 'door-close';
  }

  private post(ctx: FixtureContext): FoleyEvent | null {
    const { posting, refusal } = this.posting(ctx);
    if (!posting || refusal) {
      this.flapJam = JAM_S;
      return 'refused';
    }
    const item = posting.item;
    if (item.registeredPin && this.dialledFor !== item.id) {
      const pin = item.registeredPin;
      ctx.dial(pin, () => {
        this.dialledFor = item.id;
        // Still in hand after the dial: posted at once.
        if (ctx.held?.id === item.id) this.post(ctx);
      });
      return 'click';
    }
    const probe = this.probe(ctx);
    const effect = contractDeliveryEffect(item, probe);
    const result = contractPosting(item, this.world.state.completedContractIds);
    if (posting.from) {
      const { carId, cell, cabin } = posting.from;
      this.world.apply(cabin ? { t: 'car_cabin', carId, place: cell, item: null } : { t: 'car_storage', carId, cell, item: null });
    }
    this.flapT = 0;
    if (!result.completes) {
      // One of a party: taken in, counted, paid with the last of them.
      this.saveStock({ consumedItemId: item.id, completedContractId: item.id });
      ctx.give(item.id);
      ctx.toast(`teddy handed in — ${result.left} to go`);
      return 'drop';
    }
    const contractId = result.contractId;
    const coins = contractPay(this.world.seed, item) + ctx.raceCoins(contractId);
    // The completed id and the ledger first; the kind's own world change (the trailer or
    // car taken in) after it, so a crash between the halves cannot pay twice.
    this.saveStock({ consumedItemId: item.id, completedContractId: contractId, completedContractKind: item.contractKind });
    if (effect?.deltas) for (const delta of effect.deltas) this.world.apply(delta);
    ctx.give(item.id);
    const envelope: StickerEnvelopeItem = {
      type: 'sticker_envelope',
      id: `${contractId}:signed:${this.stop.index}`,
      stickerKind: contractRewardSticker(item),
      completedContractId: contractId,
    };
    this.doorOpen = false;
    const tray = this.trayPoint(0, 1);
    ctx.drop(envelope, tray.x, tray.y, tray.z);
    const leftover = giveCoins(ctx.inventory, coins, `${contractId}:coin`);
    if (leftover) {
      const at = this.trayPoint(1, 2);
      ctx.drop(leftover, at.x, at.y, at.z);
    }
    ctx.toast(contractDeliveredText(item, coins) ?? `delivered — ${coins} coins, the signed envelope is in the tray`);
    return 'drop';
  }

  update(dt: number): void {
    // The wheel eases onto its detent.
    this.wheelAngle += (this.wheelTarget - this.wheelAngle) * Math.min(1, dt * 16);
    this.wheel.rotation.z = -this.wheelAngle;

    let lever = 0;
    if (this.pullT >= 0) {
      this.pullT += dt;
      const t = this.pullT;
      lever = t < LEVER_RETURN_S
        ? lerp(0, LEVER_PULLED, t / PULL_DOWN_S)
        : lerp(LEVER_PULLED, 0, (t - LEVER_RETURN_S) / 0.25);
      if (t >= LEVER_RETURN_S + 0.25) this.pullT = -1;
    }
    if (this.jamT > 0) {
      this.jamT = Math.max(0, this.jamT - dt);
      const k = this.jamT / JAM_S;
      lever = Math.min(lever, LEVER_JAM * Math.sin(Math.PI * k) - 0.035 * Math.sin(this.jamT * 70) * k);
    }
    this.lever.rotation.x = lever;
    if (this.jamTextT > 0) this.jamTextT = Math.max(0, this.jamTextT - dt);

    const doorTarget = this.doorOpen ? DOOR_OPEN : 0;
    this.doorAngle += (doorTarget - this.doorAngle) * Math.min(1, dt * 9);
    this.door.rotation.x = this.doorAngle;

    let flap = 0;
    if (this.flapT >= 0) {
      this.flapT += dt;
      const t = this.flapT / FLAP_S;
      flap = FLAP_OPEN * Math.sin(Math.PI * Math.min(1, t));
      if (t >= 1) this.flapT = -1;
    }
    if (this.flapJam > 0) {
      this.flapJam = Math.max(0, this.flapJam - dt);
      flap += -0.12 * Math.sin(this.flapJam * 60) * (this.flapJam / JAM_S);
    }
    this.flap.rotation.x = flap;
  }
}
