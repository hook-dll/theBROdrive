import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { SurfaceType } from '../core/surfaces';
import type { Item } from '../items/items';
import type { ChunkContext } from './chunks';
import { rayBox, type FixtureContext, type FixtureFocus, type WorldFixture } from './fixturefield';
import { paintSign, registerAtlasSign, signMesh } from './market';
import { box, C, cylinder, mergeKitStatics } from './poi/kit';
import { addStatic, yawRotation } from './props/scatter';

/**
 * THE CARD MACHINE: the one cabinet the POST (world/post.ts), the SHOP
 * (world/vending.ts) and the TOY BOX (world/toybox.ts) are built as, worked by hand up close (player/machinefocus.ts).
 *
 * F on it frames it in the camera and frees the cursor; from then on nothing is written
 * on the screen, the machine itself is the text. Then:
 *  - the CRANK on the viewer's right flank is dragged round by its knob, without end and
 *    without a stop. Every quarter turn is one card: the card window is a split flap,
 *    so the top half of the card showing falls toward the viewer and the next card is
 *    there under it. Turned back, the cards come round the other way. The mouse wheel
 *    turns it a click at a time too, and a click on the crank is one card on.
 *  - the BUTTON under the window takes what the card offers (the post's TAKE, the
 *    shop's BUY): it drops out of the chute into the TRAY, and the machine lets go of
 *    the player (`stepBack`) so he sees it lying there and picks it up. Nothing a
 *    machine gives goes to the hand.
 *  - the TRAY is the machine's one opening: what it gives lies in it, and what it takes
 *    (a post's cargo) is put into it.
 *  - MONEY: what it sells is debited straight from the player's money; short, the
 *    button rattles and gives nothing.
 *
 * The cards are painted on two canvases in turn, so a machine owns two sign-shaped
 * materials (the program `marketProgramAnchor` links at boot) and repaints them in place;
 * everything else is POI kit boxes and cylinders. Local metres: base centre at the
 * origin, front facing -Z, so the viewer's left is local +X.
 */

export const MACHINE_W = 1.0;
export const MACHINE_H = 2.0;
export const MACHINE_D = 0.8;
const W = MACHINE_W;
const H = MACHINE_H;
const D = MACHINE_D;
const FRONT = -D / 2;

const BOARD_Y = 1.88;
/** The card window: centre, size, and the plane the cards stand in. */
const CARD_Y = 1.36;
const CARD_W = 0.66;
const CARD_H = 0.46;
const CARD_Z = FRONT - 0.02;
/** Canvas pixels of one card, at the card's aspect. */
const CARD_PX_W = 660;
const CARD_PX_H = 460;

/** The crank on the viewer's right flank (local -X): its axle and the knob's circle. */
const CRANK_Y = 1.3;
const CRANK_Z = FRONT + 0.24;
const CRANK_SIDE = -W / 2;
const CRANK_R = 0.16;
/** One card per quarter turn. Clockwise as the framing camera sees it (over the top toward the back) is forward. */
const DETENT = Math.PI / 2;

/** The button under the window, on the crank's side. */
const BUTTON_X = -0.24;
const BUTTON_Y = 0.98;
/** A plate or showcase on the other side of the window's foot. */
export const PANEL_X = 0.2;
export const PANEL_Y = 0.98;

/** The trough standing out of the front at the bottom, and the chute mouth above it. */
const TRAY_W = 0.72;
const TRAY_D = 0.36;
const TRAY_FLOOR = 0.4;
const TRAY_WALL = 0.18;
const TRAY_Z = FRONT - TRAY_D / 2;
const MOUTH_W = TRAY_W - 0.1;
const MOUTH_H = 0.3;
const MOUTH_Y = TRAY_FLOOR + 0.04 + MOUTH_H / 2;

/** The tray's painted label, over the chute mouth and under the button and the panel. */
const TRAY_LABEL_Y = 0.8;

/** Timelines, seconds. */
const FLIP_S = 0.26;
const BUTTON_S = 0.3;
const CHUTE_S = 0.6;
const REFUSE_S = 0.4;

/** The camera's place to work the machine, local metres: front right, a little above. */
const FOCUS_EYE: readonly [number, number, number] = [-1.3, 1.65, FRONT - 2.0];
const FOCUS_LOOK: readonly [number, number, number] = [-0.12, 1.1, FRONT];
const FOCUS_FOV = 50;

type Part = 'body' | 'cards' | 'crank' | 'button' | 'tray';

/** Half a card: a unit plane's top or bottom, its UVs the matching half of the canvas. */
function halfCard(top: boolean): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 0.5);
  geometry.translate(0, top ? 0.25 : -0.25, 0);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, top ? 0.5 + uv.getY(i) * 0.5 : uv.getY(i) * 0.5);
  uv.needsUpdate = true;
  return geometry;
}
const HALF_TOP = halfCard(true);
const HALF_BOTTOM = halfCard(false);

/** What a machine kind dresses the common cabinet with. */
export interface CardMachineLook {
  readonly title: string;
  readonly body: number;
  readonly buttonLabel: string;
  readonly buttonColour: number;
  /** Painted over the chute mouth, when the tray takes something in (the post's cargo). */
  readonly trayLabel?: string;
}

/** The moving and repainted parts the builder hands the machine. */
export interface CardMachineParts {
  readonly root: THREE.Group;
  readonly crank: THREE.Object3D;
  readonly flap: THREE.Object3D;
  readonly flapFront: THREE.Mesh;
  readonly flapBack: THREE.Mesh;
  readonly staticTop: THREE.Mesh;
  readonly staticBottom: THREE.Mesh;
  readonly cards: readonly [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  readonly buttonCap: THREE.Object3D;
  readonly chute: THREE.Object3D;
  /** ABSOLUTE metres of the cabinet's base centre, and its yaw. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/** The boards' paint and canvas size: title, button plate, tray label. */
const TITLE_BOARD = ['#f2ecd8', '#1f3f7a', 512, 128] as const;
const BUTTON_BOARD = ['#f2ecd8', '#26221c', 256, 64] as const;
const TRAY_BOARD = ['#f2ecd8', '#7a1f12', 512, 64] as const;

/**
 * Puts a machine kind's boards on the sign atlas (world/market.ts `registerAtlasSign`), so
 * they draw as one. Call at module load, beside the kind's look.
 */
export function registerCardMachineSigns(look: CardMachineLook): void {
  registerAtlasSign([look.title], ...TITLE_BOARD);
  registerAtlasSign([look.buttonLabel], ...BUTTON_BOARD);
  if (look.trayLabel) registerAtlasSign([look.trayLabel], ...TRAY_BOARD);
}

/**
 * Builds the cabinet at ABSOLUTE (`x`, `z`) on the sand, its front turned by `yaw`, on the
 * lowest ground under it and its tray. In the physics band it is solid and its tray holds
 * what falls into it. `disposers` gets the two card materials.
 */
export function buildCardMachine(
  ctx: ChunkContext,
  s: number,
  x: number,
  z: number,
  yaw: number,
  look: CardMachineLook,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  disposers: Array<() => void>,
): CardMachineParts {
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const local = (lx: number, lz: number): [number, number] => [x + c * lx + sn * lz, z - sn * lx + c * lz];
  let y = Infinity;
  for (const [lx, lz] of [[-W / 2, FRONT - TRAY_D], [W / 2, FRONT - TRAY_D], [-W / 2, -FRONT], [W / 2, -FRONT]] as const) {
    const [wx, wz] = local(lx, lz);
    y = Math.min(y, ctx.terrain.heightAt(wx, wz, s));
  }
  y -= 0.04;

  const root = new THREE.Group();
  root.name = 'card-machine';
  root.position.set(x - ctx.originX, y, z - ctx.originZ);
  root.rotation.y = yaw;
  box(root, [W, H, D], [0, H / 2, 0], look.body);
  box(root, [W + 0.04, 0.1, D + 0.04], [0, 0.05, 0], C.darkMetal);
  box(root, [W + 0.06, 0.06, D + 0.06], [0, H + 0.03, 0], C.darkMetal);
  // Corner posts, so the cabinet reads as a steel box rather than a block.
  for (const sx of [-1, 1]) {
    box(root, [0.04, H - 0.1, 0.04], [sx * (W / 2 - 0.01), H / 2 + 0.02, FRONT + 0.01], C.darkMetal);
  }
  const board = signMesh([look.title], ...TITLE_BOARD);
  board.scale.set(0.86, 0.2, 1);
  board.position.set(0, BOARD_Y, FRONT - 0.006);
  board.rotation.y = Math.PI;
  root.add(board);

  // The card window: a dark back, a frame standing proud of it, and the hinge across.
  box(root, [CARD_W + 0.02, CARD_H + 0.02, 0.01], [0, CARD_Y, FRONT - 0.005], 0x111314);
  const frameZ = FRONT - 0.035;
  box(root, [CARD_W + 0.12, 0.05, 0.07], [0, CARD_Y + CARD_H / 2 + 0.025, frameZ], C.darkMetal);
  box(root, [CARD_W + 0.12, 0.05, 0.07], [0, CARD_Y - CARD_H / 2 - 0.025, frameZ], C.darkMetal);
  box(root, [0.05, CARD_H, 0.07], [CARD_W / 2 + 0.035, CARD_Y, frameZ], C.darkMetal);
  box(root, [0.05, CARD_H, 0.07], [-CARD_W / 2 - 0.035, CARD_Y, frameZ], C.darkMetal);
  cylinder(root, 0.008, 0.008, CARD_W + 0.06, 8, [0, CARD_Y, CARD_Z - 0.006], C.metal, [0, 0, Math.PI / 2]);

  const cardA = paintSign([''], '#efe6cf', '#2a2620', CARD_PX_W, CARD_PX_H);
  const cardB = paintSign([''], '#efe6cf', '#2a2620', CARD_PX_W, CARD_PX_H);
  disposers.push(() => {
    for (const material of [cardA, cardB]) {
      material.map?.dispose();
      material.dispose();
    }
  });
  const half = (geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(CARD_W, CARD_H, 1);
    return mesh;
  };
  const staticTop = half(HALF_TOP, cardA);
  const staticBottom = half(HALF_BOTTOM, cardA);
  for (const mesh of [staticTop, staticBottom]) {
    mesh.position.set(0, CARD_Y, CARD_Z);
    mesh.rotation.y = Math.PI;
    // The flips show and hide the window's halves one by one: never merged.
    mesh.userData.kitKeep = true;
    root.add(mesh);
  }
  // The flap, hinged across the middle: the card's top half facing the viewer, and on
  // its back the next card's bottom half, upside down until the flap has fallen.
  const flap = new THREE.Group();
  flap.position.set(0, CARD_Y, CARD_Z - 0.004);
  const flapFront = half(HALF_TOP, cardA);
  flapFront.rotation.y = Math.PI;
  const flapBack = half(HALF_BOTTOM, cardB);
  flapBack.rotation.z = Math.PI;
  flapFront.userData.kitKeep = flapBack.userData.kitKeep = true;
  flap.add(flapFront, flapBack);
  root.add(flap);

  // The crank: a boss on the flank, and the rotor turning about local X with its arm and
  // the knob sticking out sideways for the hand.
  cylinder(root, 0.2, 0.2, 0.04, 24, [CRANK_SIDE - 0.02, CRANK_Y, CRANK_Z], C.darkMetal, [0, 0, Math.PI / 2]);
  const crank = new THREE.Group();
  crank.position.set(CRANK_SIDE - 0.045, CRANK_Y, CRANK_Z);
  cylinder(crank, 0.05, 0.05, 0.05, 16, [0, 0, 0], C.metal, [0, 0, Math.PI / 2]);
  box(crank, [0.03, CRANK_R + 0.03, 0.05], [-0.015, CRANK_R / 2, 0], C.metal);
  cylinder(crank, 0.03, 0.03, 0.13, 14, [-0.07, CRANK_R, 0], C.fadedRed, [0, 0, Math.PI / 2]);
  root.add(crank);

  // The button: a plate and a mushroom cap that goes in when pressed, and its name.
  box(root, [0.17, 0.17, 0.03], [BUTTON_X, BUTTON_Y, FRONT - 0.012], C.metal);
  const buttonCap = new THREE.Group();
  buttonCap.position.set(BUTTON_X, BUTTON_Y, FRONT - 0.03);
  cylinder(buttonCap, 0.03, 0.03, 0.04, 12, [0, 0, -0.01], C.darkMetal, [Math.PI / 2, 0, 0]);
  cylinder(buttonCap, 0.062, 0.066, 0.035, 20, [0, 0, -0.045], look.buttonColour, [Math.PI / 2, 0, 0]);
  root.add(buttonCap);
  const buttonPlate = signMesh([look.buttonLabel], ...BUTTON_BOARD);
  buttonPlate.scale.set(0.17, 0.045, 1);
  buttonPlate.position.set(BUTTON_X, BUTTON_Y - 0.12, FRONT - 0.003);
  buttonPlate.rotation.y = Math.PI;
  root.add(buttonPlate);

  // The chute's dark mouth and its flap hanging over it, and the trough before it.
  box(root, [MOUTH_W + 0.05, MOUTH_H + 0.05, 0.02], [0, MOUTH_Y, FRONT - 0.006], C.darkMetal);
  box(root, [MOUTH_W, MOUTH_H, 0.01], [0, MOUTH_Y, FRONT - 0.017], 0x0e1011);
  const chute = new THREE.Group();
  chute.position.set(0, MOUTH_Y + MOUTH_H / 2, FRONT - 0.026);
  box(chute, [MOUTH_W - 0.02, MOUTH_H - 0.01, 0.012], [0, -MOUTH_H / 2, 0], C.metal);
  box(chute, [0.14, 0.02, 0.025], [0, -MOUTH_H + 0.03, -0.012], C.darkMetal);
  root.add(chute);
  box(root, [TRAY_W, 0.03, TRAY_D], [0, TRAY_FLOOR - 0.015, TRAY_Z], C.darkMetal);
  box(root, [0.025, TRAY_WALL, TRAY_D], [TRAY_W / 2, TRAY_FLOOR + TRAY_WALL / 2, TRAY_Z], look.body);
  box(root, [0.025, TRAY_WALL, TRAY_D], [-TRAY_W / 2, TRAY_FLOOR + TRAY_WALL / 2, TRAY_Z], look.body);
  box(root, [TRAY_W + 0.025, 0.07, 0.025], [0, TRAY_FLOOR + 0.035, FRONT - TRAY_D], look.body);
  box(root, [TRAY_W + 0.04, TRAY_FLOOR - 0.03, TRAY_D], [0, (TRAY_FLOOR - 0.03) / 2, TRAY_Z], look.body);
  // The tray's label: what goes in, and where.
  if (look.trayLabel) {
    const label = signMesh([look.trayLabel], ...TRAY_BOARD);
    label.scale.set(0.5, 0.0625, 1);
    label.position.set(0, TRAY_LABEL_Y, FRONT - 0.003);
    label.rotation.y = Math.PI;
    root.add(label);
  }

  // The cabinet's boxes in one draw per finish, each moving part's in one of its own.
  mergeKitStatics(root);
  group.add(root);

  if (ctx.hasPhysics) {
    addStatic(ctx, bodies, colliders, x, y + H / 2, z, RAPIER.ColliderDesc.cuboid(W / 2, H / 2, D / 2), SurfaceType.Concrete, yawRotation(yaw));
    const solid = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number): void => {
      const [wx, wz] = local(lx, lz);
      addStatic(ctx, bodies, colliders, wx, y + ly, wz, RAPIER.ColliderDesc.cuboid(hx, hy, hz), SurfaceType.Concrete, yawRotation(yaw));
    };
    solid(0, (TRAY_FLOOR) / 2, TRAY_Z, TRAY_W / 2 + 0.02, TRAY_FLOOR / 2, TRAY_D / 2);
    solid(TRAY_W / 2, TRAY_FLOOR + TRAY_WALL / 2, TRAY_Z, 0.0125, TRAY_WALL / 2, TRAY_D / 2);
    solid(-TRAY_W / 2, TRAY_FLOOR + TRAY_WALL / 2, TRAY_Z, 0.0125, TRAY_WALL / 2, TRAY_D / 2);
    solid(0, TRAY_FLOOR + 0.035, FRONT - TRAY_D, TRAY_W / 2, 0.035, 0.0125);
  }

  return {
    root, crank, flap, flapFront, flapBack, staticTop, staticBottom, cards: [cardA, cardB], buttonCap, chute, x, y, z, yaw,
  };
}

/**
 * A card machine's mechanics; the kind decides what the cards are, what the button
 * does and what the tray takes.
 */
export abstract class CardMachine implements WorldFixture {
  private part: Part | null = null;
  protected focused = false;
  /** The card the crank has selected (-1 with no cards); the window catches up with it. */
  protected selected = -1;
  /** The canvas the window shows (0 or 1); the other is painted for the next flip. */
  private front = 0;
  /** Flips still to fall, each to a card index, and the one falling. */
  private readonly flips: number[] = [];
  private flipT = -1;
  /** The crank's angle, where it is easing to, and the detent it last counted. */
  private crankAngle = 0;
  private crankTarget = 0;
  private detent = 0;
  /** The hand holds the knob. */
  private gripping = false;
  /** Radians the hand has turned it since it took hold: a click turns none. */
  private gripTravel = 0;
  private buttonT = -1;
  private chuteT = -1;
  private chuteIn = false;
  private refuseT = 0;
  private readonly focusPose: FixtureFocus;

  constructor(readonly id: string, protected readonly parts: CardMachineParts) {
    const c = Math.cos(parts.yaw);
    const s = Math.sin(parts.yaw);
    const abs = (p: readonly [number, number, number]): [number, number, number] => [
      parts.x + c * p[0] + s * p[2],
      parts.y + p[1],
      parts.z - s * p[0] + c * p[2],
    ];
    const [eyeX, eyeY, eyeZ] = abs(FOCUS_EYE);
    const [lookX, lookY, lookZ] = abs(FOCUS_LOOK);
    this.focusPose = { eyeX, eyeY, eyeZ, lookX, lookY, lookZ, fov: FOCUS_FOV };
  }

  /** Cards the crank turns through now. */
  protected abstract cardCount(): number;
  /** Paints card `index` (-1: the machine has nothing to show) onto a card canvas. */
  protected abstract paintCard(g: CanvasRenderingContext2D, w: number, h: number, index: number): void;
  /** The button is pressed with card `index` selected: the sound (a `refuse` rattle, or what it did). */
  protected abstract pressButton(ctx: FixtureContext, index: number): FoleyEvent;
  /** A click on the tray. */
  protected useTray(_ctx: FixtureContext): FoleyEvent | null {
    return null;
  }
  /** The machine was framed: anything it holds for the player can come out now. */
  protected onFocused(_ctx: FixtureContext): void {}
  /** The window starts showing card `index` (as its flip begins). */
  protected onShown(_index: number): void {}
  /** The machine's name on the prompt that offers to work it. */
  protected abstract readonly title: string;

  /** Paints the window with the first card; the kind calls it once its stock is known. */
  protected start(): void {
    this.selected = this.cardCount() > 0 ? 0 : -1;
    this.paint(this.front, this.selected);
    this.onShown(this.selected);
  }

  /**
   * The cards changed under the crank (one was taken, one bought): the window flips to
   * whatever card stands at the selection now, even if it is the same index.
   */
  protected cardsChanged(): void {
    const count = this.cardCount();
    this.selected = count === 0 ? -1 : Math.min(Math.max(0, this.selected), count - 1);
    this.flips.push(this.selected);
  }

  /** The button springs back with a rattle: it will not do it now (the money is short). */
  protected refuse(): FoleyEvent {
    this.refuseT = REFUSE_S;
    return 'refused';
  }

  /**
   * Drops `items` out of the chute into the tray, spread across it, and lets go of the
   * player: the camera steps back so he sees them lying there and picks them up.
   */
  protected give(ctx: FixtureContext, items: readonly Item[]): void {
    if (items.length === 0) return;
    items.forEach((item, k) => {
      const at = this.trayPoint(k, items.length);
      ctx.drop(item, at.x, at.y, at.z);
    });
    this.swingChute(false);
    ctx.stepBack();
  }

  /** Swings the chute's flap: out for something given, in for something taken. */
  protected swingChute(inward: boolean): void {
    this.chuteT = 0;
    this.chuteIn = inward;
  }

  /** A point over the tray's floor, ABSOLUTE metres; `k` of `of` spreads several across. */
  protected trayPoint(k: number, of: number): { x: number; y: number; z: number } {
    const lx = of > 1 ? (k - (of - 1) / 2) * Math.min(0.2, (TRAY_W - 0.16) / (of - 1)) : 0;
    const c = Math.cos(this.parts.yaw);
    const s = Math.sin(this.parts.yaw);
    return {
      x: this.parts.x + c * lx + s * (TRAY_Z + 0.04),
      y: this.parts.y + TRAY_FLOOR + 0.14,
      z: this.parts.z - s * lx + c * (TRAY_Z + 0.04),
    };
  }

  private paint(canvasIndex: number, cardIndex: number): void {
    const map = this.parts.cards[canvasIndex]!.map;
    const canvas: unknown = map?.image;
    // The headless tools build stops with no DOM: their cards are a blank data texture.
    if (!map || typeof HTMLCanvasElement === 'undefined' || !(canvas instanceof HTMLCanvasElement)) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.save();
    this.paintCard(g, canvas.width, canvas.height, cardIndex);
    g.restore();
    map.needsUpdate = true;
  }

  focus(): FixtureFocus {
    return this.focusPose;
  }

  setFocused(focused: boolean, ctx: FixtureContext): void {
    const was = this.focused;
    // Set first: what `onFocused` gives may let go of the machine again at once.
    this.focused = focused;
    if (!focused) this.release();
    else if (!was) this.onFocused(ctx);
  }

  /** The cursor or eye ray in the machine's frame, or null when it misses the plane. */
  private toLocal(originX: number, originZ: number, eyeX: number, eyeY: number, eyeZ: number, dx: number, dz: number): [number, number, number, number, number] {
    const c = Math.cos(this.parts.yaw);
    const s = Math.sin(this.parts.yaw);
    const rx = eyeX - (this.parts.x - originX);
    const rz = eyeZ - (this.parts.z - originZ);
    return [c * rx - s * rz, eyeY - this.parts.y, s * rx + c * rz, c * dx - s * dz, s * dx + c * dz];
  }

  aim(originX: number, originZ: number, eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number, range: number): number {
    const [ox, oy, oz, lx, lz] = this.toLocal(originX, originZ, eyeX, eyeY, eyeZ, dx, dz);
    let best = rayBox(ox, oy, oz, lx, dy, lz, 0, H / 2, 0, W / 2, H / 2, D / 2);
    let part: Part = 'body';
    const test = (p: Part, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void => {
      const t = rayBox(ox, oy, oz, lx, dy, lz, cx, cy, cz, hx, hy, hz);
      if (t < best) {
        best = t;
        part = p;
      }
    };
    test('cards', 0, CARD_Y, FRONT - 0.04, CARD_W / 2 + 0.06, CARD_H / 2 + 0.05, 0.045);
    test('crank', CRANK_SIDE - 0.08, CRANK_Y, CRANK_Z, 0.08, CRANK_R + 0.06, CRANK_R + 0.06);
    test('button', BUTTON_X, BUTTON_Y, FRONT - 0.04, 0.09, 0.09, 0.045);
    // The trough's floor and the chute mouth, not the air over them: what lies in the
    // tray is aimed at before the tray itself.
    test('tray', 0, TRAY_FLOOR - 0.015, TRAY_Z, TRAY_W / 2, 0.03, TRAY_D / 2);
    test('tray', 0, MOUTH_Y, FRONT - 0.02, MOUTH_W / 2, MOUTH_H / 2, 0.02);
    this.part = best > range ? null : part;
    return best > range ? Infinity : best;
  }

  prompt(_ctx: FixtureContext): string | null {
    // Worked up close it says nothing: the cards, the showcase and the tray are the text.
    if (this.focused || this.part === null) return null;
    return `[F] ${this.title}`;
  }

  press(ctx: FixtureContext): FoleyEvent | null {
    switch (this.part) {
      case 'button':
        this.buttonT = 0;
        return this.pressButton(ctx, this.selected);
      case 'crank':
        // A click without a drag still turns it one card.
        return this.turnBy(1);
      case 'tray':
        return this.useTray(ctx);
      default:
        return null;
    }
  }

  grab(originX: number, originZ: number, eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number): boolean {
    this.aim(originX, originZ, eyeX, eyeY, eyeZ, dx, dy, dz, Infinity);
    if (this.part !== 'crank') return false;
    this.gripping = true;
    this.gripTravel = 0;
    return true;
  }

  pivot(): { x: number; y: number; z: number } {
    const c = Math.cos(this.parts.yaw);
    const s = Math.sin(this.parts.yaw);
    return {
      x: this.parts.x + c * CRANK_SIDE + s * CRANK_Z,
      y: this.parts.y + CRANK_Y,
      z: this.parts.z - s * CRANK_SIDE + c * CRANK_Z,
    };
  }

  drag(turn: number): FoleyEvent | null {
    if (!this.gripping) return null;
    // The rotor follows the hand round its axle as the screen shows it; the knob need
    // not be under the cursor to be turned, and nothing stops it.
    this.gripTravel += Math.abs(turn);
    this.crankTarget += turn;
    this.crankAngle = this.crankTarget;
    return this.countDetents();
  }

  release(): FoleyEvent | null {
    if (!this.gripping) return null;
    this.gripping = false;
    // A click on the crank with no turn in it is one card on.
    if (this.gripTravel < 0.05) return this.turnBy(1);
    // Let go, it settles into the nearest detent.
    this.crankTarget = Math.round(this.crankTarget / DETENT) * DETENT;
    return this.countDetents();
  }

  scroll(notches: number): FoleyEvent | null {
    return this.turnBy(notches);
  }

  /** Turns the crank `steps` detents on its own (a click, the wheel). */
  private turnBy(steps: number): FoleyEvent | null {
    this.crankTarget = (Math.round(this.crankTarget / DETENT) + steps) * DETENT;
    return this.countDetents();
  }

  /** Cards for every detent the crank's target has passed since the last count. */
  private countDetents(): FoleyEvent | null {
    // Forward is clockwise from the framing camera: the angle rising.
    const detent = Math.round(this.crankTarget / DETENT);
    const steps = detent - this.detent;
    if (steps === 0) return null;
    this.detent = detent;
    const count = this.cardCount();
    const direction = Math.sign(steps);
    for (let k = 0; k < Math.abs(steps); k++) {
      if (count === 0) break;
      this.selected = (((this.selected + direction) % count) + count) % count;
      this.flips.push(this.selected);
    }
    // A fast spin queues more than can be watched: keep the last few.
    if (this.flips.length > 3) this.flips.splice(0, this.flips.length - 3);
    return 'click';
  }

  /** The cursor over the machine: a hand for the knob, a pointer for what clicks. */
  cursor(): 'grab' | 'grabbing' | 'pointer' | null {
    if (this.gripping) return 'grabbing';
    if (this.part === 'crank') return 'grab';
    if (this.part === 'button' || this.part === 'tray') return 'pointer';
    return null;
  }

  update(dt: number): void {
    if (!this.gripping) this.crankAngle += (this.crankTarget - this.crankAngle) * Math.min(1, dt * 14);
    this.parts.crank.rotation.x = this.crankAngle;

    // The split flap: the top half falls toward the viewer and the next card is under it.
    if (this.flipT < 0 && this.flips.length > 0) {
      const next = this.flips.shift()!;
      this.onShown(next);
      const back = 1 - this.front;
      this.paint(back, next);
      const [current, coming] = [this.parts.cards[this.front]!, this.parts.cards[back]!];
      this.parts.staticTop.material = coming;
      this.parts.flapBack.material = coming;
      this.parts.flapFront.material = current;
      this.parts.staticBottom.material = current;
      this.flipT = 0;
    }
    if (this.flipT >= 0) {
      this.flipT += dt / (this.flips.length > 0 ? FLIP_S * 0.55 : FLIP_S);
      const t = Math.min(1, this.flipT);
      this.parts.flap.rotation.x = -Math.PI * t * t;
      if (t >= 1) {
        this.front = 1 - this.front;
        const current = this.parts.cards[this.front]!;
        this.parts.staticTop.material = current;
        this.parts.staticBottom.material = current;
        this.parts.flapFront.material = current;
        this.parts.flap.rotation.x = 0;
        this.flipT = -1;
      }
    }

    let push = 0;
    if (this.buttonT >= 0) {
      this.buttonT += dt;
      push = 0.022 * Math.sin(Math.PI * Math.min(1, this.buttonT / BUTTON_S));
      if (this.buttonT >= BUTTON_S) this.buttonT = -1;
    }
    if (this.refuseT > 0) {
      this.refuseT = Math.max(0, this.refuseT - dt);
      push += 0.006 * Math.sin(this.refuseT * 70) * (this.refuseT / REFUSE_S);
    }
    this.parts.buttonCap.position.z = FRONT - 0.03 + push;

    let chute = 0;
    if (this.chuteT >= 0) {
      this.chuteT += dt;
      chute = (this.chuteIn ? -1.1 : 0.9) * Math.sin(Math.PI * Math.min(1, this.chuteT / CHUTE_S));
      if (this.chuteT >= CHUTE_S) this.chuteT = -1;
    }
    this.parts.chute.rotation.x = chute;
    // The chunk froze every matrix when it was placed (world/chunks.ts
    // `freezeStaticSubtree`): the moving parts write their own.
    this.parts.crank.updateMatrix();
    this.parts.flap.updateMatrix();
    this.parts.buttonCap.updateMatrix();
    this.parts.chute.updateMatrix();
  }
}

/** Card paper and ink, shared by every kind's `paintCard`. */
export const CARD_PAPER = '#efe6cf';
export const CARD_INK = '#2a2620';

/**
 * The common card: a paper face, a coloured band with a corner label, a big headline and
 * up to three lines under it, and a small footer. Every kind paints through this, so the
 * cards of both machines read alike.
 */
export function paintCardFace(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  card: {
    readonly band: string;
    readonly bandText: string;
    readonly corner: string;
    readonly headline: string;
    readonly lines: readonly string[];
    readonly footer: string;
  },
): void {
  g.fillStyle = CARD_PAPER;
  g.fillRect(0, 0, w, h);
  g.fillStyle = card.band;
  g.fillRect(0, 0, w, h * 0.17);
  g.textBaseline = 'middle';
  g.fillStyle = '#f7f1e2';
  g.font = `bold ${Math.round(h * 0.09)}px sans-serif`;
  g.textAlign = 'left';
  g.fillText(card.bandText, w * 0.04, h * 0.085, w * 0.7);
  g.textAlign = 'right';
  g.fillText(card.corner, w * 0.96, h * 0.085, w * 0.25);
  g.fillStyle = CARD_INK;
  g.textAlign = 'left';
  g.font = `bold ${Math.round(h * 0.13)}px sans-serif`;
  g.fillText(card.headline, w * 0.04, h * 0.285, w * 0.92);
  // Clear of the hinge across the middle: one line over it, the rest under it.
  g.font = `${Math.round(h * 0.085)}px sans-serif`;
  card.lines.slice(0, 4).forEach((line, i) => g.fillText(line, w * 0.04, h * [0.41, 0.6, 0.72, 0.84][i]!, w * 0.92));
  g.fillStyle = '#7d7464';
  g.font = `${Math.round(h * 0.055)}px sans-serif`;
  g.textAlign = 'center';
  g.fillText(card.footer, w / 2, h * 0.945, w * 0.92);
  g.strokeStyle = '#b9ae95';
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
}
