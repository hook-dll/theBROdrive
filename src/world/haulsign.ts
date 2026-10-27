import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SurfaceType } from '../core/surfaces';
import { waitingHaul } from '../contracts/hauls';
import { offerDestinationIndex } from '../contracts/offers';
import { formatClock, type ContractKind } from '../contracts/types';
import { haulLoadId } from '../contracts/world';
import { contractPay, formatPay } from '../economy/economy';
import type { GameWorld } from '../game/state';
import { contractKindOf, type ContractCargoItem } from '../items/items';
import type { ChunkContext } from './chunks';
import type { FixtureField, WorldFixture } from './fixturefield';
import type { ParkingSlot } from './haulbay';
import { paintSign, SIGN_PLANE } from './market';
import { box, C, mergeKitStatics } from './poi/kit';
import { postStop, type PostStop } from './poststops';
import { addStatic, yawRotation } from './props/scatter';

/**
 * THE HAUL SIGN (game-design2.md §7.8): a board on a post beside a post's PICK-UP slot,
 * just past the slot's outer line by its back, facing out of the slot onto the pad. While
 * the post's haul load waits in the slot (contracts/hauls.ts `waitingHaul`, its trailer or
 * car in the world) the board shows what it is and where it goes, for a boy who can barely
 * read: a pictogram of the kind (a car with a trailer, a car towing a car, a car to
 * drive) and an arrow at the top, the DESTINATION big in the middle, the kilometres and
 * the pay (and an urgent clock) small underneath. With no load waiting — taken, or not
 * stood there yet — the board is blank.
 *
 * Kit materials like the shelter's timetable (world/shelter.ts); only the board has its
 * own painted canvas, read again every `REFRESH_S` by its fixture in the physics band.
 */

/** The post: its square section, the board's size and its middle's height, metres. */
const POST_W = 0.07;
const BOARD_W = 0.9;
const BOARD_H = 0.68;
const BOARD_Y = 1.55;
const POST_TOP = BOARD_Y + BOARD_H / 2;
/** Where the post stands in the slot's frame: this far past its outer side line, this far in from its back line. */
const SIDE_OUT_M = 0.75;
const BACK_IN_M = 0.8;
/** The board's canvas, pixels: its aspect is the board's. */
const CANVAS_W = 512;
const CANVAS_H = Math.round((CANVAS_W * BOARD_H) / BOARD_W);
const BOARD_BG = '#f2ecd8';
const BOARD_FG = '#1f3f7a';
/** The pictogram's loads and broken car, apart from the cars that pull them. */
const LOAD_COLOUR = '#b5532f';
/** The board is read again this often, s. */
const REFRESH_S = 0.4;

/**
 * Builds the sign of post `stop`'s pick-up slot `pickup`; `next` is the way along the
 * slot's local X the row's next slot lies. In the physics band its post is solid and its
 * fixture registered (id pushed to `registered`); beyond it, it is only seen.
 * `disposers` gets the board.
 */
export function buildHaulSign(
  ctx: ChunkContext,
  stop: PostStop,
  pickup: ParkingSlot,
  next: number,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  fixtures: FixtureField,
  registered: string[],
  disposers: Array<() => void>,
): void {
  const c = Math.cos(pickup.yaw);
  const s = Math.sin(pickup.yaw);
  const lx = -next * (pickup.halfWidth + SIDE_OUT_M);
  const lz = -pickup.halfDepth + BACK_IN_M;
  const x = pickup.x + c * lx + s * lz;
  const z = pickup.z - s * lx + c * lz;
  const y = ctx.terrain.heightAt(x, z, pickup.s);

  const root = new THREE.Group();
  root.name = 'haul-sign';
  root.position.set(x - ctx.originX, y, z - ctx.originZ);
  root.rotation.y = pickup.yaw;
  box(root, [0.18, 0.2, 0.18], [0, -0.05, 0], C.concrete);
  box(root, [POST_W, POST_TOP, POST_W], [0, POST_TOP / 2, 0], C.darkMetal, undefined, false, 'metal');
  // The board's frame, on the post's front.
  box(root, [BOARD_W + 0.05, BOARD_H + 0.05, 0.03], [0, BOARD_Y, POST_W / 2 + 0.015], C.darkMetal, undefined, false, 'metal');

  const world = ctx.world;
  const haul = shownHaul(world, stop.index);
  const material = paintSign([], BOARD_BG, BOARD_FG, CANVAS_W, CANVAS_H);
  paintBoard(material, world, stop, haul);
  const board = new THREE.Mesh(SIGN_PLANE, material);
  board.userData.kitKeep = true;
  board.scale.set(BOARD_W, BOARD_H, 1);
  board.position.set(0, BOARD_Y, POST_W / 2 + 0.031);
  root.add(board);
  disposers.push(() => {
    material.map?.dispose();
    material.dispose();
  });

  mergeKitStatics(root, { deep: true });
  group.add(root);

  if (!ctx.hasPhysics) return;
  addStatic(
    ctx, bodies, colliders, x, y + POST_TOP / 2, z,
    RAPIER.ColliderDesc.cuboid(POST_W / 2, POST_TOP / 2, POST_W / 2), SurfaceType.Concrete, yawRotation(pickup.yaw),
  );
  registered.push(fixtures.register(new HaulSign(world, stop, material, haul?.id ?? null)));
}

/** The haul whose load waits in post `index`'s pick-up slot now, or null: its round's trailer or car is not in the world. */
function shownHaul(world: GameWorld, index: number): ContractCargoItem | null {
  const haul = waitingHaul(world.state, world.seed, index);
  const id = haulLoadId(haul);
  return world.state.trailers[id] || world.state.cars[id] ? haul : null;
}

/** Paints the board for `haul` waiting at `stop`, blank for none, on the canvas `paintSign` made. Headless, nothing to paint. */
function paintBoard(material: THREE.MeshStandardMaterial, world: GameWorld, stop: PostStop, haul: ContractCargoItem | null): void {
  const texture = material.map;
  const canvas = texture?.image as HTMLCanvasElement | undefined;
  if (typeof document === 'undefined' || !texture || !(canvas instanceof HTMLCanvasElement)) return;
  const g = canvas.getContext('2d');
  if (!g) return;
  const w = canvas.width;
  const h = canvas.height;
  g.fillStyle = BOARD_BG;
  g.fillRect(0, 0, w, h);
  const border = Math.round(h * 0.03);
  g.strokeStyle = BOARD_FG;
  g.lineWidth = border;
  g.strokeRect(border, border, w - border * 2, h - border * 2);
  texture.needsUpdate = true;
  if (!haul) return;

  // The pictogram and the arrow, the top 38%.
  drawPictogram(g, contractKindOf(haul), w * 0.36, h * 0.21, h * 0.24);
  g.fillStyle = BOARD_FG;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h * 0.26)}px sans-serif`;
  g.fillText('→', w * 0.8, h * 0.2);
  // The destination, as big as it fits.
  const name = (haul.destination ?? 'the next post').toUpperCase();
  g.font = `bold ${Math.round(h * 0.25)}px sans-serif`;
  g.fillText(name, w * 0.5, h * 0.55, w - border * 6);
  // The kilometres, the pay, an urgent clock.
  const km = (postStop(world.seed, offerDestinationIndex(haul)).s - stop.s) / 1000;
  const urgent = haul.urgentS === undefined ? '' : ` · URGENT ${formatClock(haul.urgentS)}`;
  g.font = `bold ${Math.round(h * 0.12)}px sans-serif`;
  g.fillText(`${km.toFixed(1)} km · ${formatPay(contractPay(world.seed, haul))}${urgent}`, w * 0.5, h * 0.82, w - border * 6);
}

/** A side-on toy car, nose to +x, `s` long, its wheels' bottoms on `ground`: a body, a cabin, two wheels. */
function drawCar(g: CanvasRenderingContext2D, x: number, ground: number, s: number, colour: string): void {
  const wheel = s * 0.11;
  g.fillStyle = colour;
  g.fillRect(x - s / 2, ground - wheel - s * 0.22, s, s * 0.22);
  g.beginPath();
  g.moveTo(x - s * 0.3, ground - wheel - s * 0.22);
  g.lineTo(x - s * 0.2, ground - wheel - s * 0.4);
  g.lineTo(x + s * 0.14, ground - wheel - s * 0.4);
  g.lineTo(x + s * 0.26, ground - wheel - s * 0.22);
  g.closePath();
  g.fill();
  g.fillStyle = BOARD_FG;
  for (const wx of [-0.3, 0.3]) {
    g.beginPath();
    g.arc(x + wx * s, ground - wheel, wheel, 0, Math.PI * 2);
    g.fill();
  }
}

/**
 * The kind's pictogram, centred on (`cx`, `cy`), `size` tall: a car pulling a loaded
 * trailer, a car pulling a car on a bar, or one car with its key. The race sign
 * (race/visuals.ts) draws the trailer one for a trailer race.
 */
export function drawPictogram(g: CanvasRenderingContext2D, kind: ContractKind, cx: number, cy: number, size: number): void {
  const ground = cy + size / 2;
  const car = size * 1.25;
  g.strokeStyle = BOARD_FG;
  g.lineWidth = Math.max(2, size * 0.05);
  if (kind === 'trailer') {
    // The car ahead, the drawbar, the box on one wheel with its load standing in it.
    const carX = cx + car * 0.45;
    const boxW = car * 0.7;
    const boxX = cx - car * 0.6;
    drawCar(g, carX, ground, car, BOARD_FG);
    const wheel = car * 0.11;
    g.beginPath();
    g.moveTo(boxX + boxW / 2, ground - wheel - car * 0.08);
    g.lineTo(carX - car / 2, ground - wheel - car * 0.08);
    g.stroke();
    g.fillStyle = LOAD_COLOUR;
    g.fillRect(boxX - boxW * 0.35, ground - wheel - car * 0.45, boxW * 0.7, car * 0.3);
    g.strokeRect(boxX - boxW / 2, ground - wheel - car * 0.18, boxW, car * 0.14);
    g.fillStyle = BOARD_FG;
    g.beginPath();
    g.arc(boxX, ground - wheel, wheel, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'towing') {
    // The car ahead pulls the broken one on a bar.
    const gap = car * 0.25;
    drawCar(g, cx + (car + gap) / 2, ground, car, BOARD_FG);
    drawCar(g, cx - (car + gap) / 2, ground, car, LOAD_COLOUR);
    const barY = ground - car * 0.11 - car * 0.1;
    g.beginPath();
    g.moveTo(cx - gap / 2, barY);
    g.lineTo(cx + gap / 2, barY);
    g.stroke();
  } else {
    // One car to drive over, and its key.
    drawCar(g, cx - car * 0.15, ground, car * 1.2, LOAD_COLOUR);
    const kx = cx + car * 0.85;
    const ky = cy - size * 0.05;
    const ring = size * 0.14;
    g.beginPath();
    g.arc(kx, ky, ring, 0, Math.PI * 2);
    g.moveTo(kx + ring, ky);
    g.lineTo(kx + ring + size * 0.4, ky);
    g.moveTo(kx + ring + size * 0.28, ky);
    g.lineTo(kx + ring + size * 0.28, ky + size * 0.12);
    g.moveTo(kx + ring + size * 0.38, ky);
    g.lineTo(kx + ring + size * 0.38, ky + size * 0.1);
    g.stroke();
  }
}

/** The sign's fixture: nothing to aim at or press; it only repaints the board when the waiting load changes. */
class HaulSign implements WorldFixture {
  readonly id: string;
  private refreshIn = REFRESH_S;

  constructor(
    private readonly world: GameWorld,
    private readonly stop: PostStop,
    private readonly board: THREE.MeshStandardMaterial,
    /** The id of the haul the board shows, or null while it is blank. */
    private shownId: string | null,
  ) {
    this.id = `haul-sign:${stop.index}`;
  }

  aim(): number {
    return Infinity;
  }

  prompt(): string | null {
    return null;
  }

  press(): null {
    return null;
  }

  update(dt: number): void {
    this.refreshIn -= dt;
    if (this.refreshIn > 0) return;
    this.refreshIn = REFRESH_S;
    const haul = shownHaul(this.world, this.stop.index);
    const id = haul?.id ?? null;
    if (id === this.shownId) return;
    this.shownId = id;
    paintBoard(this.board, this.world, this.stop, haul);
  }
}
