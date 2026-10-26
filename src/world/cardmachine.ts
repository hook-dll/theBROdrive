import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { SurfaceType } from '../core/surfaces';
import type { GameWorld } from '../game/state';
import { contractThing, itemLabel, type Item } from '../items/items';
import type { FixedGridView, GridLayout, TrunkGrid } from '../vehicle/trunk';
import type { ChunkContext } from './chunks';
import { rayBox, type FixtureContext, type WorldFixture } from './fixturefield';
import { paintSign, registerAtlasSign, signMesh } from './market';
import { fillGameText } from '../ui/balls';
import { box, C, cylinder, material, mergeKitStatics, type V3 } from './poi/kit';
import { addStatic, yawRotation } from './props/scatter';

/**
 * THE CARD MACHINE: the one cabinet the POST (world/post.ts) and the SHOP
 * (world/vending.ts) are built as, worked by walking up to it.
 *
 * Within `ENGAGE_M` of the front of its control deck the machine is ENGAGED
 * (`WorldFixture.reach`, player/interaction.ts): its grid is drawn, and F on a part
 * under the crosshair works it. The camera stays the player's own. Then:
 *  - the DIAL on the sloped control deck, under the card window, turns one long tick,
 *    45°, per card: the card window is a split flap, so the top half of the card
 *    showing falls toward the viewer and the next card is there under it. F on the dial
 *    is one card on; the mouse wheel, aimed at the machine, turns it either way.
 *  - the BUTTON on the deck under the showcase takes what the card offers (the post's
 *    TAKE, the shop's BUY): it appears in the GRID.
 *  - the GRID is the machine's one opening, low on the front: ONE cell, the boot's twin
 *    (vehicle/trunk.ts, drawn by render/trunkview.ts while engaged, `grid`). One thing
 *    lies there at a time, whatever its size; F on it takes it into the hands or the
 *    pack, as from a boot ("hands full" when they are). What the machine takes in (a
 *    post's cargo) is put there with F on the empty cell and lies there a moment while
 *    the machine draws it in. With the cell taken, the button refuses and says so. What
 *    lies there is saved (`WorldState.machineGrids`, by the fixture's id), and so is
 *    what an older save left in the eight cells the grid had: those wait in the machine
 *    and drop into the cell one by one as it is emptied.
 *  - MONEY: what it sells is debited straight from the player's money; short, the
 *    button rattles and gives nothing.
 *
 * The cabinet is an arcade cabinet, the owner's pick of three trial designs (2026-10-26):
 * black cheeks with art stripes and a T-moulding, a hood overhanging the top with the
 * stripes across its face, a lit strip and a row of bulbs under it. Under the hood one
 * row: the card window in a black bezel on the viewer's left, a lit SHOWCASE niche on his
 * right that the kind dresses (the shop's ware on the card, the post's parcel). Under the
 * row a control deck across the whole front, sloping up to the cabinet and bevelled
 * back down under it, so the grid below is seen past it: the dial on the deck under the
 * cards it turns, the button under the showcase it gives from. No title board, no coin
 * door: the kind's colour, the button's name and the cards say what it is.
 *
 * Nothing on the front shares a plane with a face of another colour (the depth buffer
 * could not tell them apart and the faces flickered): a plate laid on a face stands at
 * least 5 mm proud of it, and two pieces that meet do so edge to edge.
 *
 * The cards are painted on two canvases in turn, so a machine owns two sign-shaped
 * materials (the program `marketProgramAnchor` links at boot) and repaints them in place.
 * Everything else is POI kit boxes and cylinders in the flat palette. Local metres: base
 * centre at the origin, front facing -Z, so the viewer's left is local +X.
 */

export const MACHINE_W = 1.36;
export const MACHINE_H = 2.1;
export const MACHINE_D = 1.0;
const W = MACHINE_W;
const H = MACHINE_H;
const D = MACHINE_D;
const FRONT = -D / 2;

/** The cheeks' thickness, each side of the body, and the width between them. */
const CHEEK = 0.04;
const INNER_W = W - 2 * CHEEK;
/** The hood over the top: its height, and how far it overhangs the front. */
const HOOD_H = 0.3;
const HOOD_OVER = 0.12;

/** The card window, toward the viewer's left: centre, size, and the plane the cards stand in. */
const CARD_X = 0.2;
const CARD_Y = 1.46;
const CARD_W = 0.66;
const CARD_H = 0.46;
const CARD_Z = FRONT - 0.03;
/** The flap hangs in front of the window's halves, far enough not to fight them. */
const FLAP_Z = CARD_Z - 0.008;
/** Canvas pixels of one card, at the card's aspect. */
const CARD_PX_W = 660;
const CARD_PX_H = 460;

/**
 * The SHOWCASE: a lit niche right of the window, at its height, standing out of the
 * front. `NICHE_X`/`NICHE_FLOOR_Y` are the middle of its floor, `NICHE_Z` the middle of
 * its depth: what the kind stands in it is centred there.
 */
export const NICHE_X = -0.42;
const NICHE_Y = CARD_Y;
export const NICHE_W = 0.28;
const NICHE_H = 0.3;
const NICHE_DEPTH = 0.12;
const NICHE_BAR = 0.025;
export const NICHE_FLOOR_Y = NICHE_Y - NICHE_H / 2;
/** The niche's back panel's face; its bars stand out to `NICHE_DEPTH` in front of the cabinet. */
const NICHE_BACK = FRONT - 0.006;
export const NICHE_Z = (NICHE_BACK + FRONT - NICHE_DEPTH) / 2;

/**
 * The CONTROL DECK across the front, in profile (local Y up, Z out): a lip at the front
 * edge, the deck sloping up from its top back to the cabinet, and a bevel from its foot
 * back down to the cabinet so the grid under it is seen past it.
 */
const POD_HALF_W = 0.6;
const POD_D = 0.27;
const POD_LOW = 0.95;
const POD_LIP = 0.035;
const POD_SLOPE = (30 * Math.PI) / 180;
const POD_HIGH = POD_LOW + POD_D * Math.tan(POD_SLOPE);
/** Where the bevel under the deck meets the cabinet. */
const POD_FOOT = 0.68;
/** The coloured plate laid on the deck, inset from the deck's sides and, less, from its edges. */
const DECK_PLATE_T = 0.01;
const DECK_PLATE_INSET = 0.03;
const DECK_PLATE_EDGE = 0.008;
/** Up the slope from its front edge, and out of the deck: unit (Y, Z). */
const DECK_ALONG: readonly [number, number] = [Math.sin(POD_SLOPE), Math.cos(POD_SLOPE)];
const DECK_NORMAL: readonly [number, number] = [Math.cos(POD_SLOPE), -Math.sin(POD_SLOPE)];
/** Halfway up the deck on the plate's face, where the dial and the button stand. */
const DECK_Y = (POD_LOW + POD_HIGH) / 2 + DECK_NORMAL[0] * DECK_PLATE_T;
const DECK_Z = FRONT - POD_D / 2 + DECK_NORMAL[1] * DECK_PLATE_T;
/** Lean of what stands on the deck: its face's normal is the deck's. */
const DECK_TILT = Math.PI / 2 - POD_SLOPE;

/** A point on the deck's face, `along` metres up the slope from the middle and `out` off it. */
function onDeck(x: number, along: number, out: number): V3 {
  return [x, DECK_Y + DECK_ALONG[0] * along + DECK_NORMAL[0] * out, DECK_Z + DECK_ALONG[1] * along + DECK_NORMAL[1] * out];
}

/** The dial's mount on the deck (its axle's foot) under the cards, and out from the axle to the finger post: the hand's target. */
const WHEEL_AT: V3 = onDeck(CARD_X, 0, 0);
const WHEEL_REACH = 0.125;
/** One card's turn: a long tick. */
const DETENT = Math.PI / 4;
/** The button, under the showcase; its name plate down the slope from it. */
const BUTTON_AT: V3 = onDeck(NICHE_X, 0, 0);
const BUTTON_LABEL_AT: V3 = onDeck(NICHE_X, -0.105, 0.006);
/** The button cap's face at rest, out from the face it stands on. */
const BUTTON_REST = -0.03;

/**
 * THE GRID: one cell, the opening under the deck. A cell's width and height, its middle
 * height, and the plane it stands in, in front of the opening's frame.
 */
export const MACHINE_GRID: TrunkGrid = { columns: 1, rows: 1 };
const CELL_W = 0.76;
const CELL_H = 0.4;
const GRID_Y = 0.41;
const GRID_Z = FRONT - 0.035;
/** The opening's frame: its bars' width, and how far they stand out of the front. */
const OPENING_BAR = 0.03;
const OPENING_DEPTH = 0.025;

/** The grid's cell in the machine's frame, for the renderer (render/trunkview.ts). */
export const MACHINE_GRID_LAYOUT: GridLayout = {
  count: 1,
  grid: MACHINE_GRID,
  cellBox(cell, centre, size) {
    if (cell !== 0) return false;
    centre.set(0, GRID_Y, GRID_Z);
    size.set(CELL_W, CELL_H, 0);
    return true;
  },
};

/** Timelines, seconds. */
const FLIP_S = 0.26;
const BUTTON_S = 0.3;
const REFUSE_S = 0.4;
/** How long a thing put into the grid lies there before the machine has drawn it in. */
const SWALLOW_S = 0.6;

/**
 * How near the player's feet must be to the front middle of the deck for the machine to
 * be engaged, metres: a step back from the deck's lip.
 */
const ENGAGE_M = 1.4;

const CHROME = 0xd3d7d6;
const CABINET_BLACK = 0x18191c;
/** The art stripes, bottom up: gold, orange, red. */
const STRIPES = [0xd9a52b, 0xd2622a, 0xb03a2e] as const;
const MOULDING = STRIPES[0];
const LAMP = 0xfff1b8;

type Part = 'body' | 'cards' | 'wheel' | 'button' | 'grid';

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

/**
 * The deck's body in one piece: its profile (local Z, Y) drawn round, extruded across
 * the deck's width. One mesh, so its sides are one face each and nothing fights them.
 */
function deckGeometry(): THREE.BufferGeometry {
  const back = FRONT + 0.01;
  const tan = Math.tan(POD_SLOPE);
  const shape = new THREE.Shape();
  shape.moveTo(back, POD_FOOT);
  shape.lineTo(FRONT - POD_D, POD_LOW - POD_LIP);
  shape.lineTo(FRONT - POD_D, POD_LOW);
  shape.lineTo(back, POD_HIGH + 0.01 * tan);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 2 * POD_HALF_W, bevelEnabled: false });
  // The shape's X is the cabinet's Z, its extrusion the cabinet's X.
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(POD_HALF_W, 0, 0);
  return geometry;
}
const DECK_GEOMETRY = deckGeometry();

/** What a machine kind dresses the common cabinet with. */
export interface CardMachineLook {
  readonly body: number;
  readonly buttonLabel: string;
  readonly buttonColour: number;
}

/** The moving and repainted parts the builder hands the machine. */
export interface CardMachineParts {
  readonly root: THREE.Group;
  /** The dial's rotor, turning about its own local Z. */
  readonly wheel: THREE.Object3D;
  readonly flap: THREE.Object3D;
  readonly flapFront: THREE.Mesh;
  readonly flapBack: THREE.Mesh;
  readonly staticTop: THREE.Mesh;
  readonly staticBottom: THREE.Mesh;
  readonly cards: readonly [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  /** The button's cap, pushed in along its own local Z. */
  readonly buttonCap: THREE.Object3D;
  /** The button's name, for the prompt. */
  readonly buttonLabel: string;
  /** ABSOLUTE metres of the cabinet's base centre, and its yaw. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/** The button plate's paint and canvas size. */
const BUTTON_BOARD = ['#f2ecd8', '#26221c', 256, 64] as const;

/**
 * Puts a machine kind's button plate on the sign atlas (world/market.ts
 * `registerAtlasSign`), so the plates draw as one. Call at module load, beside the kind's look.
 */
export function registerCardMachineSigns(look: CardMachineLook): void {
  registerAtlasSign([look.buttonLabel], ...BUTTON_BOARD);
}

/** A round bar in the XY plane from `r0` to `r1` out along angle `a` (from +X toward +Y), at `z`. */
function spoke(parent: THREE.Object3D, r0: number, r1: number, radius: number, a: number, z: number, colour: number): void {
  const mid = (r0 + r1) / 2;
  cylinder(parent, radius, radius, r1 - r0, 8, [Math.cos(a) * mid, Math.sin(a) * mid, z], colour, [0, 0, a - Math.PI / 2]);
}

/** A disc facing the viewer (its axis along Z), its centre at `at`. */
function disc(parent: THREE.Object3D, r: number, depth: number, segments: number, at: V3, colour: number): THREE.Mesh {
  return cylinder(parent, r, r, depth, segments, at, colour, [Math.PI / 2, 0, 0]);
}

/** Four bars round an opening (centre `x`, `y`, inner size `w` x `h`) standing out of the front by `depth`. */
function frameBars(root: THREE.Group, x: number, y: number, w: number, h: number, bar: number, depth: number, colour: number): void {
  // Their backs sunk 5 mm into the cabinet.
  const z = FRONT - depth / 2 + 0.0025;
  const d = depth + 0.005;
  // The sides run the full height; the top and bottom fit between them, edge to edge.
  box(root, [bar, h + 2 * bar, d], [x + w / 2 + bar / 2, y, z], colour);
  box(root, [bar, h + 2 * bar, d], [x - w / 2 - bar / 2, y, z], colour);
  box(root, [w, bar, d], [x, y + h / 2 + bar / 2, z], colour);
  box(root, [w, bar, d], [x, y - h / 2 - bar / 2, z], colour);
}

/** The cheeks and stripes, the hood, the window's bezel, the showcase, the deck and the opening. */
function dressCabinet(root: THREE.Group, look: CardMachineLook): void {
  box(root, [INNER_W, H - HOOD_H, D], [0, (H - HOOD_H) / 2, 0], look.body);
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - CHEEK / 2);
    box(root, [CHEEK, H, D], [x, H / 2, 0], CABINET_BLACK);
    // T-moulding up the cheek's front edge, short of its top and foot so it shares no
    // face with them.
    box(root, [CHEEK + 0.012, H - 0.02, 0.014], [x, H / 2, FRONT - 0.002], MOULDING);
    // Art stripes along the flank, leaning up toward the front, 6 mm proud of it.
    STRIPES.forEach((colour, k) => {
      box(root, [0.006, 0.07, 0.9], [sx * (W / 2 + 0.003), 0.62 + k * 0.13, 0], colour, [0.4, 0, 0]);
      box(root, [0.006, 0.05, 0.9], [sx * (W / 2 + 0.003), 1.42 + k * 0.1, 0], colour, [0.4, 0, 0]);
    });
  }
  // The kick plate along the foot.
  box(root, [INNER_W, 0.1, 0.02], [0, 0.05, FRONT - 0.01], CABINET_BLACK);
  // The hood overhanging the top: the flank's stripes run across its face, top down, and
  // its underside is a lit strip with bulbs along its foot.
  box(root, [INNER_W, HOOD_H, D + HOOD_OVER], [0, H - HOOD_H / 2, -HOOD_OVER / 2], CABINET_BLACK);
  const hoodFace = FRONT - HOOD_OVER;
  STRIPES.forEach((colour, k) => {
    box(root, [INNER_W - 0.12, 0.034, 0.012], [0, H - 0.07 - k * 0.055, hoodFace - 0.003], colour);
  });
  box(root, [INNER_W - 0.06, 0.012, HOOD_OVER - 0.02], [0, H - HOOD_H - 0.006, FRONT - HOOD_OVER / 2], LAMP);
  for (let k = 0; k < 11; k++) {
    disc(root, 0.011, 0.014, 8, [-0.55 + k * 0.11, H - HOOD_H + 0.015, hoodFace - 0.0065], 0xfff3c4);
  }

  // The window's black bezel; the window's frame stands out of it (`buildCardMachine`).
  box(root, [CARD_W + 0.14, CARD_H + 0.16, 0.012], [CARD_X, CARD_Y, FRONT - 0.006], CABINET_BLACK);

  // The showcase: a pale back, its frame standing out round it, a lamp under its top.
  box(root, [NICHE_W, NICHE_H, 0.012], [NICHE_X, NICHE_Y, NICHE_BACK + 0.006], 0xbcb8aa);
  frameBars(root, NICHE_X, NICHE_Y, NICHE_W, NICHE_H, NICHE_BAR, NICHE_DEPTH, CABINET_BLACK);
  box(root, [NICHE_W - 0.03, 0.01, 0.02], [NICHE_X, NICHE_Y + NICHE_H / 2 - 0.005, FRONT - NICHE_DEPTH + 0.025], LAMP);

  // The deck: its black body, the kind's colour on its face, a moulding along its lip.
  const deck = new THREE.Mesh(DECK_GEOMETRY, material(CABINET_BLACK));
  deck.castShadow = deck.receiveShadow = true;
  root.add(deck);
  const slope = POD_D / Math.cos(POD_SLOPE);
  box(
    root,
    [2 * (POD_HALF_W - DECK_PLATE_INSET), DECK_PLATE_T, slope - 2 * DECK_PLATE_EDGE],
    [0, (POD_LOW + POD_HIGH) / 2 + (DECK_NORMAL[0] * DECK_PLATE_T) / 2, FRONT - POD_D / 2 + (DECK_NORMAL[1] * DECK_PLATE_T) / 2],
    look.body,
    [-POD_SLOPE, 0, 0],
  );
  box(root, [2 * POD_HALF_W + 0.012, POD_LIP + 0.008, 0.012], [0, POD_LOW - POD_LIP / 2, FRONT - POD_D - 0.006], MOULDING);

  // The opening under the deck: a dark plate in a metal frame, the grid's cell over it.
  box(root, [CELL_W + 0.04, CELL_H + 0.04, 0.012], [0, GRID_Y, FRONT - 0.006], 0x0e1011);
  frameBars(root, 0, GRID_Y, CELL_W + 0.04, CELL_H + 0.04, OPENING_BAR, OPENING_DEPTH, C.darkMetal);
}

/** The dial: a knurled knob with a finger post, over tick marks on the deck. */
function dressDial(mount: THREE.Object3D, rotor: THREE.Object3D): void {
  disc(mount, 0.1, 0.012, 24, [0, 0, -0.006], 0x0e0f11);
  for (let k = 0; k < 16; k++) {
    const a = Math.PI / 2 + (k / 16) * Math.PI * 2;
    const long = k % 2 === 0;
    spoke(mount, 0.103, long ? 0.125 : 0.116, long ? 0.0035 : 0.0025, a, -0.002, 0xeeeae0);
  }
  box(mount, [0.014, 0.012, 0.008], [0, 0.133, -0.004], 0xffd35a);
  disc(rotor, 0.088, 0.045, 24, [0, 0, -0.03], 0x2a2a2e);
  // The knurls stand round the knob's rim, edge to edge with it, short of its faces.
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    box(rotor, [0.008, 0.008, 0.035], [Math.cos(a) * 0.092, Math.sin(a) * 0.092, -0.03], 0x3c3d42, [0, 0, a]);
  }
  disc(rotor, 0.07, 0.008, 24, [0, 0, -0.056], CHROME);
  box(rotor, [0.008, 0.04, 0.006], [0, 0.045, -0.063], STRIPES[2]);
  disc(rotor, 0.016, 0.04, 12, [0, 0.056, -0.08], STRIPES[2]);
}

/**
 * Builds the cabinet at ABSOLUTE (`x`, `z`) on the sand, its front turned by `yaw`, on the
 * lowest ground under it. In the physics band it is solid, its deck too. `disposers` gets
 * the two card materials.
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
  for (const [lx, lz] of [[-W / 2, FRONT], [W / 2, FRONT], [-W / 2, -FRONT], [W / 2, -FRONT]] as const) {
    const [wx, wz] = local(lx, lz);
    y = Math.min(y, ctx.terrain.heightAt(wx, wz, s));
  }
  y -= 0.04;

  const root = new THREE.Group();
  root.name = 'card-machine';
  root.position.set(x - ctx.originX, y, z - ctx.originZ);
  root.rotation.y = yaw;
  dressCabinet(root, look);

  // The card window: a frame standing out of the bezel round the cards, and the hinge across.
  const frameZ = FRONT - 0.035;
  box(root, [CARD_W + 0.12, 0.05, 0.07], [CARD_X, CARD_Y + CARD_H / 2 + 0.025, frameZ], CABINET_BLACK);
  box(root, [CARD_W + 0.12, 0.05, 0.07], [CARD_X, CARD_Y - CARD_H / 2 - 0.025, frameZ], CABINET_BLACK);
  box(root, [0.06, CARD_H, 0.07], [CARD_X + CARD_W / 2 + 0.03, CARD_Y, frameZ], CABINET_BLACK);
  box(root, [0.06, CARD_H, 0.07], [CARD_X - CARD_W / 2 - 0.03, CARD_Y, frameZ], CABINET_BLACK);
  cylinder(root, 0.006, 0.006, CARD_W + 0.06, 8, [CARD_X, CARD_Y, FLAP_Z - 0.006], C.metal, [0, 0, Math.PI / 2]);

  const cardA = paintSign([''], CARD_PAPER, CARD_INK, CARD_PX_W, CARD_PX_H);
  const cardB = paintSign([''], CARD_PAPER, CARD_INK, CARD_PX_W, CARD_PX_H);
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
    mesh.position.set(CARD_X, CARD_Y, CARD_Z);
    mesh.rotation.y = Math.PI;
    // The flips show and hide the window's halves one by one: never merged.
    mesh.userData.kitKeep = true;
    root.add(mesh);
  }
  // At rest the flap is the window's top half: the one under it shows only while it falls.
  staticTop.visible = false;
  // The flap, hinged across the middle: the card's top half facing the viewer, and on
  // its back the next card's bottom half, upside down until the flap has fallen.
  const flap = new THREE.Group();
  flap.position.set(CARD_X, CARD_Y, FLAP_Z);
  const flapFront = half(HALF_TOP, cardA);
  flapFront.rotation.y = Math.PI;
  const flapBack = half(HALF_BOTTOM, cardB);
  flapBack.rotation.z = Math.PI;
  flapFront.userData.kitKeep = flapBack.userData.kitKeep = true;
  flap.add(flapFront, flapBack);
  root.add(flap);

  // The dial: a mount on the deck (its -Z out of the deck), what is fixed there, and the
  // rotor turning about the mount's Z.
  const wheelMount = new THREE.Group();
  wheelMount.position.set(...WHEEL_AT);
  wheelMount.rotation.x = DECK_TILT;
  const wheel = new THREE.Group();
  dressDial(wheelMount, wheel);
  wheelMount.add(wheel);
  root.add(wheelMount);

  // The button: a bezel and a mushroom cap that goes in when pressed, and its name.
  const buttonMount = new THREE.Group();
  buttonMount.position.set(...BUTTON_AT);
  buttonMount.rotation.x = DECK_TILT;
  disc(buttonMount, 0.07, 0.024, 24, [0, 0, -0.012], CABINET_BLACK);
  const buttonCap = new THREE.Group();
  buttonCap.position.set(0, 0, BUTTON_REST);
  cylinder(buttonCap, 0.028, 0.028, 0.04, 12, [0, 0, -0.01], C.darkMetal, [Math.PI / 2, 0, 0]);
  cylinder(buttonCap, 0.054, 0.058, 0.035, 20, [0, 0, -0.045], look.buttonColour, [Math.PI / 2, 0, 0]);
  buttonMount.add(buttonCap);
  root.add(buttonMount);
  const buttonPlate = signMesh([look.buttonLabel], ...BUTTON_BOARD);
  buttonPlate.scale.set(0.15, 0.04, 1);
  buttonPlate.position.set(...BUTTON_LABEL_AT);
  // Facing up the deck's normal: turned to the viewer, then leaned back with the deck.
  buttonPlate.rotation.set(DECK_TILT, Math.PI, 0);
  root.add(buttonPlate);

  // The cabinet's boxes in one draw per finish, each moving part's in one of its own.
  mergeKitStatics(root);
  group.add(root);

  if (ctx.hasPhysics) {
    addStatic(ctx, bodies, colliders, x, y + H / 2, z, RAPIER.ColliderDesc.cuboid(W / 2, H / 2, D / 2), SurfaceType.Concrete, yawRotation(yaw));
    const [px, pz] = local(0, FRONT - POD_D / 2);
    addStatic(
      ctx,
      bodies,
      colliders,
      px,
      y + (POD_FOOT + POD_HIGH) / 2,
      pz,
      RAPIER.ColliderDesc.cuboid(POD_HALF_W, (POD_HIGH - POD_FOOT) / 2, POD_D / 2),
      SurfaceType.Concrete,
      yawRotation(yaw),
    );
  }

  return {
    root, wheel, flap, flapFront, flapBack, staticTop, staticBottom, cards: [cardA, cardB], buttonCap,
    buttonLabel: look.buttonLabel, x, y, z, yaw,
  };
}

/**
 * A ray box round a part on a mount leaning `tilt` back about local X: its centre `out`
 * metres off the face, half `reach` across and up the face and `depth` out of it.
 */
function mountBox(at: V3, tilt: number, out: number, reach: number, depth: number): [number, number, number, number, number, number] {
  const ny = Math.sin(tilt);
  const nz = -Math.cos(tilt);
  return [
    at[0],
    at[1] + ny * out,
    at[2] + nz * out,
    reach,
    reach * Math.abs(Math.cos(tilt)) + depth * Math.abs(Math.sin(tilt)),
    reach * Math.abs(Math.sin(tilt)) + depth * Math.abs(Math.cos(tilt)),
  ];
}
const WHEEL_AIM = mountBox(WHEEL_AT, DECK_TILT, 0.05, WHEEL_REACH, 0.06);
const BUTTON_AIM = mountBox(BUTTON_AT, DECK_TILT, 0.04, 0.08, 0.045);

/** What a thing is called on a prompt or a toast: a contract's thing by its own name. */
export function thingName(item: Item): string {
  return item.type === 'contract_cargo' ? contractThing(item).name : itemLabel(item);
}

/** The renderer's view of a machine's grid (`grid`), reused in place. */
interface GridViewState {
  readonly layout: GridLayout;
  readonly cells: readonly (Item | null)[];
  selectedCell: number | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/**
 * A card machine's mechanics; the kind decides what the cards are, what the button
 * gives and what the grid takes in.
 */
export abstract class CardMachine implements WorldFixture {
  private part: Part | null = null;
  /** The player stands within `ENGAGE_M` of it (`engage`/`disengage`). */
  protected engaged = false;
  /** The card the wheel has selected (-1 with no cards); the window catches up with it. */
  protected selected = -1;
  /** The canvas the window shows (0 or 1); the other is painted for the next flip. */
  private front = 0;
  /** Flips still to fall, each to a card index, and the one falling. */
  private readonly flips: number[] = [];
  private flipT = -1;
  /** The wheel's angle, where it is easing to, and the detent it last counted. */
  private wheelAngle = 0;
  private wheelTarget = 0;
  private detent = 0;
  private buttonT = -1;
  private refuseT = 0;
  /**
   * The grid's one cell: what the machine gave and the player has not taken, and, for
   * `SWALLOW_S`, what he put in. The renderer reads it as the grid's cells.
   */
  private readonly cell: (Item | null)[] = [null];
  /** What the machine gave that waits to drop into the cell, in order (an older save's eight cells). */
  private readonly waiting: Item[] = [];
  /** What is being drawn in lies in the cell for `swallowT` seconds more. */
  private swallowing = false;
  private swallowT = 0;
  private readonly gridView: GridViewState;

  constructor(
    readonly id: string,
    protected readonly parts: CardMachineParts,
    protected readonly world: GameWorld,
  ) {
    // What lay in it when it was last worked, in order: the first in the cell, the rest
    // waiting behind it.
    for (const item of world.state.machineGrids[id] ?? []) {
      if (!item) continue;
      if (this.cell[0]) this.waiting.push(item);
      else this.cell[0] = item;
    }
    this.gridView = { layout: MACHINE_GRID_LAYOUT, cells: this.cell, selectedCell: null, x: parts.x, y: parts.y, z: parts.z, yaw: parts.yaw };
  }

  /** Cards the wheel turns through now. */
  protected abstract cardCount(): number;
  /** Paints card `index` (-1: the machine has nothing to show) onto a card canvas. */
  protected abstract paintCard(g: CanvasRenderingContext2D, w: number, h: number, index: number): void;
  /** The button is pressed with card `index` selected: the sound (a `refuse` rattle, or what it did). */
  protected abstract pressButton(ctx: FixtureContext, index: number): FoleyEvent;
  /**
   * `held` is put to the empty cell: the kind takes it in (`swallow`) or refuses it. The
   * default takes nothing in.
   */
  protected putIn(_ctx: FixtureContext, _held: Item): FoleyEvent | null {
    return 'refused';
  }
  /** The prompt over the empty cell with `held` in hand, or null: the kind takes nothing in. */
  protected putPrompt(_ctx: FixtureContext, _held: Item): string | null {
    return null;
  }
  /**
   * Something was taken out of the grid into the hands or the pack: the kind writes the
   * grid with whatever of its own goes with it. The default writes the grid alone.
   */
  protected gridTaken(): void {
    this.saveGrid();
  }
  /** Every tick the machine is engaged; `first` on the tick the player walked up to it. */
  protected onEngaged(_ctx: FixtureContext, _first: boolean): void {}
  /** The player walked away from it. */
  protected onDisengaged(): void {}
  /** The window starts showing card `index` (as its flip begins). */
  protected onShown(_index: number): void {}

  /** Paints the window with the first card; the kind calls it once its stock is known. */
  protected start(): void {
    this.selected = this.cardCount() > 0 ? 0 : -1;
    this.paint(this.front, this.selected);
    this.onShown(this.selected);
  }

  /**
   * The cards changed under the wheel (one was taken, one bought): the window flips to
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

  /** Nothing lies in the cell and nothing waits for it: the machine can give. */
  protected cellFree(): boolean {
    return this.cell[0] === null && this.waiting.length === 0;
  }

  /**
   * Puts `item` into the cell (`cellFree`): what the machine gives. False, and nothing
   * given, when it is taken. The kind saves the grid with its own state (`saveGrid`).
   */
  protected give(item: Item): boolean {
    if (!this.cellFree()) return false;
    this.cell[0] = item;
    return true;
  }

  /**
   * Lays `item`, put in, in the cell for `SWALLOW_S` while the machine draws it in. It is
   * the machine's already: the save never holds it (`gridCells`), and F on it takes nothing.
   */
  protected swallow(item: Item): void {
    this.cell[0] = item;
    this.swallowing = true;
    this.swallowT = SWALLOW_S;
  }

  /** What waits drops into the empty cell. */
  private refill(): void {
    if (this.cell[0] === null) this.cell[0] = this.waiting.shift() ?? null;
  }

  /** The grid as the save holds it, in order: what is being drawn in is gone already. */
  protected gridCells(): (Item | null)[] {
    const first = this.swallowing ? null : this.cell[0]!;
    return first ? [first, ...this.waiting] : this.waiting.slice();
  }

  /** Writes the grid into the save (`machine_grid`). */
  protected saveGrid(): void {
    this.world.apply({ t: 'machine_grid', machineId: this.id, cells: this.gridCells() });
  }

  /**
   * F on the cell, as on a boot's (player/interaction.ts `operateTrunkCell`): what lies
   * there comes out into the hands or the pack, even with something held; the empty cell
   * takes what is held, if the kind takes it in.
   */
  private useCell(ctx: FixtureContext): FoleyEvent | null {
    const item = this.cell[0];
    if (item) {
      if (this.swallowing) return null;
      if (!ctx.inventory.add(item)) {
        ctx.toast('hands full');
        return 'refused';
      }
      this.cell[0] = null;
      this.refill();
      this.gridTaken();
      return 'pickup';
    }
    const held = ctx.held;
    return held ? this.putIn(ctx, held) : null;
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

  reach(x: number, z: number): number {
    const c = Math.cos(this.parts.yaw);
    const s = Math.sin(this.parts.yaw);
    const rx = x - this.parts.x;
    const rz = z - this.parts.z;
    const lx = c * rx - s * rz;
    const lz = s * rx + c * rz;
    // In front of it only: nobody works it from behind or through a cheek.
    if (lz > FRONT) return Infinity;
    const d = Math.hypot(lx, lz - (FRONT - POD_D));
    return d <= ENGAGE_M ? d : Infinity;
  }

  engage(ctx: FixtureContext, first: boolean): void {
    this.engaged = true;
    this.onEngaged(ctx, first);
  }

  disengage(): void {
    this.engaged = false;
    this.onDisengaged();
  }

  grid(): FixedGridView | null {
    if (!this.engaged) return null;
    this.gridView.selectedCell = this.part === 'grid' ? 0 : null;
    return this.gridView;
  }

  aim(originX: number, originZ: number, eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number, range: number): number {
    const c = Math.cos(this.parts.yaw);
    const s = Math.sin(this.parts.yaw);
    const rx = eyeX - (this.parts.x - originX);
    const rz = eyeZ - (this.parts.z - originZ);
    const ox = c * rx - s * rz;
    const oy = eyeY - this.parts.y;
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
    test('cards', CARD_X, CARD_Y, FRONT - 0.04, CARD_W / 2 + 0.06, CARD_H / 2 + 0.05, 0.045);
    test('wheel', ...WHEEL_AIM);
    test('button', ...BUTTON_AIM);
    test('grid', 0, GRID_Y, GRID_Z, CELL_W / 2, CELL_H / 2, 0.02);
    this.part = best > range ? null : part;
    return best > range ? Infinity : best;
  }

  prompt(ctx: FixtureContext): string | null {
    // Only what F does where the crosshair is: the cards and the showcase say the rest.
    if (!this.engaged) return null;
    switch (this.part) {
      case 'wheel':
        return '[F] next card · wheel: turn the dial';
      case 'button':
        return `[F] ${this.parts.buttonLabel}`;
      case 'grid': {
        const item = this.cell[0];
        if (item) return this.swallowing ? null : `[F] take ${thingName(item)}`;
        const held = ctx.held;
        return held ? this.putPrompt(ctx, held) : null;
      }
      default:
        return null;
    }
  }

  press(ctx: FixtureContext): FoleyEvent | null {
    // Walked up to first: from further off it is only looked at.
    if (!this.engaged) return null;
    switch (this.part) {
      case 'button':
        this.buttonT = 0;
        return this.pressButton(ctx, this.selected);
      case 'wheel':
        return this.turnBy(1);
      case 'grid':
        return this.useCell(ctx);
      default:
        return null;
    }
  }

  scroll(notches: number): FoleyEvent | null {
    return this.engaged ? this.turnBy(notches) : null;
  }

  /** Turns the wheel `steps` detents (F on it, the mouse wheel). */
  private turnBy(steps: number): FoleyEvent | null {
    this.wheelTarget = (Math.round(this.wheelTarget / DETENT) + steps) * DETENT;
    return this.countDetents();
  }

  /** Cards for every detent the wheel's target has passed since the last count. */
  private countDetents(): FoleyEvent | null {
    // Forward is clockwise as the player faces the dial: the angle rising.
    const detent = Math.round(this.wheelTarget / DETENT);
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

  update(dt: number): void {
    this.wheelAngle += (this.wheelTarget - this.wheelAngle) * Math.min(1, dt * 14);
    this.parts.wheel.rotation.z = this.wheelAngle;

    // The split flap: the top half falls toward the viewer and the next card is under it.
    if (this.flipT < 0 && this.flips.length > 0) {
      const next = this.flips.shift()!;
      this.onShown(next);
      const back = 1 - this.front;
      this.paint(back, next);
      const [current, coming] = [this.parts.cards[this.front]!, this.parts.cards[back]!];
      this.parts.staticTop.material = coming;
      this.parts.staticTop.visible = true;
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
        this.parts.staticTop.visible = false;
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
    this.parts.buttonCap.position.z = BUTTON_REST + push;

    if (this.swallowing) {
      this.swallowT -= dt;
      if (this.swallowT <= 0) {
        this.swallowing = false;
        this.cell[0] = null;
        this.refill();
      }
    }
    // The chunk froze every matrix when it was placed (world/chunks.ts
    // `freezeStaticSubtree`): the moving parts write their own.
    this.parts.wheel.updateMatrix();
    this.parts.flap.updateMatrix();
    this.parts.buttonCap.updateMatrix();
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
  fillGameText(g, card.headline, w * 0.04, h * 0.285, w * 0.92);
  // Clear of the hinge across the middle: one line over it, the rest under it.
  g.font = `${Math.round(h * 0.085)}px sans-serif`;
  card.lines.slice(0, 4).forEach((line, i) => fillGameText(g, line, w * 0.04, h * [0.41, 0.6, 0.72, 0.84][i]!, w * 0.92));
  g.fillStyle = '#7d7464';
  g.font = `${Math.round(h * 0.055)}px sans-serif`;
  g.textAlign = 'center';
  fillGameText(g, card.footer, w / 2, h * 0.945, w * 0.92);
  g.strokeStyle = '#b9ae95';
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
}
