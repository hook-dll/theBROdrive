import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { SurfaceType } from '../core/surfaces';
import type { GameWorld } from '../game/state';
import { contractThing, itemLabel, type Item } from '../items/items';
import type { BootFootprint } from '../items/things';
import {
  bootAnchorAt,
  bootFits,
  bootFootprint,
  bootFreeAnchor,
  bootOwner,
  trunkCellCount,
  type FixedGridView,
  type GridLayout,
  type TrunkGrid,
} from '../vehicle/trunk';
import type { ChunkContext } from './chunks';
import { rayBox, type FixtureContext, type FixtureFocus, type WorldFixture } from './fixturefield';
import { paintSign, registerAtlasSign, signMesh } from './market';
import { fillGameText } from '../ui/balls';
import { box, C, cylinder, mergeKitStatics, type V3 } from './poi/kit';
import { addStatic, yawRotation } from './props/scatter';

/**
 * THE CARD MACHINE: the one cabinet the POST (world/post.ts) and the SHOP
 * (world/vending.ts) are built as, worked by hand up close (player/machinefocus.ts).
 *
 * F on it frames it in the camera and frees the cursor; from then on nothing is written
 * on the screen, the machine itself is the text. Then:
 *  - the DIAL on the control pod's deck, right of the card window as the viewer stands,
 *    is dragged round about its axle (square to the deck, facing him), without end and
 *    without a stop. Every long tick, 45°, is one card: the card window is a split flap,
 *    so the top half of the card showing falls toward the viewer and the next card is
 *    there under it. Turned back, the cards come round the other way. The mouse wheel
 *    turns it a detent at a time too, and a click on the dial is one card on.
 *  - the BUTTON beside the dial on the deck takes what the card offers (the post's TAKE,
 *    the shop's BUY): it appears in the GRID.
 *  - the GRID is the machine's one opening, the boot's twin (vehicle/trunk.ts, drawn by
 *    render/trunkview.ts while the machine is framed, `grid`): `MACHINE_GRID` cells over
 *    a dark plate low on the front, each thing taking its boot footprint's cells
 *    (`machineFootprint`). What the machine gives lies there; a click on it takes it into
 *    the hands or the pack, as from a boot ("hands full" when they are). What it takes
 *    in (a post's cargo) is put in with a click on a free cell, where its footprint fits
 *    round it, as into a boot, and lies there a moment while the machine draws it in.
 *    With no room for what it would give, the button refuses and says so. What lies in
 *    the grid is saved (`WorldState.machineGrids`, by the fixture's id).
 *  - MONEY: what it sells is debited straight from the player's money; short, the
 *    button rattles and gives nothing.
 *
 * The cabinet is an arcade cabinet, the owner's pick of three trial designs (2026-10-26):
 * black cheeks with art stripes and a T-moulding, a hood overhanging the top with the
 * stripes across its face, a lit strip and a row of bulbs under it, the window in a black
 * bezel, and a control pod standing out under the wheel's side whose sloped deck carries
 * a knurled dial with a finger post over tick marks, and the button. No title board, no
 * coin door: the kind's colour, the button's name and the cards say what it is.
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

/** The card window, toward the viewer's left: centre, size, and the plane the cards stand in. */
const CARD_X = 0.22;
const CARD_Y = 1.47;
const CARD_W = 0.66;
const CARD_H = 0.46;
const CARD_Z = FRONT - 0.02;
/** Canvas pixels of one card, at the card's aspect. */
const CARD_PX_W = 660;
const CARD_PX_H = 460;

/** A plate or showcase under the window, on the flat front. */
export const PANEL_X = CARD_X;
export const PANEL_Y = 1.0;

/** The button cap's face at rest, out from the face it stands on. */
const BUTTON_REST = -0.03;

/** Timelines, seconds. */
const FLIP_S = 0.26;
const BUTTON_S = 0.3;
const REFUSE_S = 0.4;
/** How long a thing put into the grid lies there before the machine has drawn it in. */
const SWALLOW_S = 0.6;

/**
 * The camera's place to work the machine, local metres: in front, a little to the
 * dial's side and above; the grid low in the frame.
 */
const FOCUS_EYE: readonly [number, number, number] = [-0.3, 1.8, FRONT - 2.2];
const FOCUS_LOOK: readonly [number, number, number] = [-0.06, 1.18, FRONT];
const FOCUS_FOV = 50;

const CHROME = 0xd3d7d6;
const CABINET_BLACK = 0x18191c;
const GLASS_DARK = 0x111314;
/** The art stripes, bottom up: gold, orange, red. */
const STRIPES = [0xd9a52b, 0xd2622a, 0xb03a2e] as const;
const MOULDING = STRIPES[0];

/** The cheeks' thickness, each side of the body. */
const CHEEK = 0.04;
/** The hood over the top: its height, and how far it overhangs the front. */
const HOOD_H = 0.3;
const HOOD_OVER = 0.12;

/** The control pod: across the dial's side, its sloped deck rising back to the front. */
const POD_X = -0.38;
const POD_HALF_W = 0.26;
const POD_D = 0.24;
const POD_BOTTOM = 0.84;
/** The deck's front edge, and its slope up toward the cabinet. */
const POD_LOW = 0.98;
const POD_SLOPE = (35 * Math.PI) / 180;
const POD_HIGH = POD_LOW + POD_D * Math.tan(POD_SLOPE);
/** Halfway up the deck, where the dial and the button stand. */
const DECK_Y = (POD_LOW + POD_HIGH) / 2;
const DECK_Z = FRONT - POD_D / 2;
/** Lean of what stands on the deck: its face's normal is up the slope's perpendicular. */
const DECK_TILT = Math.PI / 2 - POD_SLOPE;

/** The dial's mount on the deck (its axle's foot), and out from the axle to the finger post: the hand's target. */
const WHEEL_AT: V3 = [POD_X - 0.11, DECK_Y, DECK_Z];
const WHEEL_REACH = 0.145;
/** One card's turn: a long tick. */
const DETENT = Math.PI / 4;
const BUTTON_AT: V3 = [POD_X + 0.16, DECK_Y, DECK_Z];
/** The button's name plate, on the pod's front under it. */
const BUTTON_LABEL_AT: V3 = [POD_X + 0.16, (POD_BOTTOM + POD_LOW) / 2, FRONT - POD_D - 0.003];

/**
 * THE GRID: `columns` across the opening by `rows` up, as the boot's (vehicle/trunk.ts
 * `TrunkGrid`). Four across lay the fishing rods and the sledge, two up the TV set and
 * the aquarium: every thing the boy sends fits it empty.
 */
export const MACHINE_GRID: TrunkGrid = { columns: 4, rows: 2 };
const GRID_CELLS = trunkCellCount(MACHINE_GRID);
/** A cell's width and height, the grid's middle height, and the plane its cells stand in. */
const CELL_W = 0.29;
const CELL_H = 0.26;
const GRID_Y = 0.42;
const GRID_Z = FRONT - 0.03;
/**
 * The dark plate the grid lies over, standing for the dispenser's opening. Its top
 * keeps under the pod's foot, which hides the front above 0.72 m from the framing camera.
 */
const PLATE_W = MACHINE_GRID.columns * CELL_W + 0.06;
const PLATE_H = MACHINE_GRID.rows * CELL_H + 0.06;

/** Cell `cell`'s centre across (local X) and up (local Y). */
function cellX(cell: number): number {
  const column = cell % MACHINE_GRID.columns;
  // Counted from the viewer's left (+X), as a boot's cells are from behind the car.
  return -(column - (MACHINE_GRID.columns - 1) / 2) * CELL_W;
}
function cellY(cell: number): number {
  const row = Math.floor(cell / MACHINE_GRID.columns);
  return GRID_Y + ((MACHINE_GRID.rows - 1) / 2 - row) * CELL_H;
}

/** The grid's cells in the machine's frame, for the renderer (render/trunkview.ts). */
export const MACHINE_GRID_LAYOUT: GridLayout = {
  count: GRID_CELLS,
  grid: MACHINE_GRID,
  cellBox(cell, centre, size) {
    if (cell < 0 || cell >= GRID_CELLS) return false;
    centre.set(cellX(cell), cellY(cell), GRID_Z);
    size.set(CELL_W, CELL_H, 0);
    return true;
  },
};

const ONE_CELL: BootFootprint = { columns: 1, rows: 1 };

/**
 * The cells `item` takes in the grid: its boot footprint (vehicle/trunk.ts
 * `bootFootprint`); the carpet, which no boot takes, lies rolled up in one, as
 * `bootOwner` already reads a thing with none.
 */
export function machineFootprint(item: Item): BootFootprint {
  return bootFootprint(item) ?? ONE_CELL;
}

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

/** The cheeks and stripes, the hood, the bezel, the opening's plate, and the pod under the dial's side. */
function dressCabinet(root: THREE.Group, look: CardMachineLook): void {
  box(root, [W - 2 * CHEEK, H - HOOD_H, D], [0, (H - HOOD_H) / 2, 0], look.body);
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - CHEEK / 2);
    box(root, [CHEEK, H, D], [x, H / 2, 0], CABINET_BLACK);
    // T-moulding up the cheek's front edge.
    box(root, [CHEEK + 0.008, H, 0.014], [x, H / 2, FRONT - 0.003], MOULDING);
    // Art stripes along the flank, leaning up toward the front.
    STRIPES.forEach((colour, k) => {
      box(root, [0.006, 0.07, 0.98], [sx * (W / 2 + 0.003), 0.62 + k * 0.13, 0], colour, [0.4, 0, 0]);
      box(root, [0.006, 0.05, 0.98], [sx * (W / 2 + 0.003), 1.42 + k * 0.1, 0], colour, [0.4, 0, 0]);
    });
  }
  box(root, [W - 2 * CHEEK, 0.1, 0.02], [0, 0.05, FRONT - 0.01], CABINET_BLACK);
  // The hood overhanging the top: the flank's stripes run across its face, top down, and
  // its underside is a lit strip with bulbs along its foot.
  box(root, [W - 2 * CHEEK, HOOD_H, D + HOOD_OVER], [0, H - HOOD_H / 2, -HOOD_OVER / 2], CABINET_BLACK);
  const hoodFace = FRONT - HOOD_OVER - 0.003;
  STRIPES.forEach((colour, k) => {
    box(root, [W - 2 * CHEEK - 0.12, 0.034, 0.006], [0, H - 0.07 - k * 0.055, hoodFace], colour);
  });
  box(root, [W - 2 * CHEEK - 0.06, 0.012, HOOD_OVER - 0.02], [0, H - HOOD_H - 0.006, FRONT - HOOD_OVER / 2], 0xfff1b8);
  for (let k = 0; k < 11; k++) {
    disc(root, 0.011, 0.014, 8, [-0.55 + k * 0.11, H - HOOD_H + 0.015, FRONT - HOOD_OVER - 0.007], 0xfff3c4);
  }
  // The window's black bezel.
  box(root, [CARD_W + 0.14, CARD_H + 0.16, 0.012], [CARD_X, CARD_Y, FRONT - 0.006], CABINET_BLACK);
  // The dispenser's opening: a dark plate in a dark metal frame, flat on the front, the
  // grid's cells over it.
  box(root, [PLATE_W + 0.04, PLATE_H + 0.04, 0.012], [0, GRID_Y, FRONT - 0.006], C.darkMetal);
  box(root, [PLATE_W, PLATE_H, 0.008], [0, GRID_Y, FRONT - 0.014], 0x0e1011);

  // The pod: a block standing out of the front, and its deck sloping up back to it.
  const podH = POD_LOW - POD_BOTTOM;
  box(root, [POD_HALF_W * 2, podH, POD_D], [POD_X, POD_BOTTOM + podH / 2, FRONT - POD_D / 2], CABINET_BLACK);
  const t = 0.16;
  const n = [Math.cos(POD_SLOPE), -Math.sin(POD_SLOPE)] as const;
  box(
    root,
    [POD_HALF_W * 2, t, POD_D / Math.cos(POD_SLOPE) + 0.01],
    [POD_X, DECK_Y - (n[0] * t) / 2, DECK_Z - (n[1] * t) / 2],
    look.body,
    [-POD_SLOPE, 0, 0],
  );
  box(root, [POD_HALF_W * 2 + 0.01, 0.02, 0.02], [POD_X, POD_LOW, FRONT - POD_D], MOULDING);
}

/** The dial: a knurled knob with a finger post, over tick marks on the deck. */
function dressDial(mount: THREE.Object3D, rotor: THREE.Object3D): void {
  disc(mount, 0.118, 0.012, 24, [0, 0, -0.006], 0x0e0f11);
  for (let k = 0; k < 16; k++) {
    const a = Math.PI / 2 + (k / 16) * Math.PI * 2;
    const long = k % 2 === 0;
    spoke(mount, 0.122, long ? 0.148 : 0.136, long ? 0.004 : 0.0025, a, -0.002, 0xeeeae0);
  }
  box(mount, [0.016, 0.02, 0.006], [0, 0.158, -0.003], 0xffd35a);
  disc(rotor, 0.105, 0.045, 24, [0, 0, -0.03], 0x2a2a2e);
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2;
    box(rotor, [0.008, 0.008, 0.04], [Math.cos(a) * 0.106, Math.sin(a) * 0.106, -0.03], 0x3c3d42, [0, 0, a]);
  }
  disc(rotor, 0.085, 0.006, 24, [0, 0, -0.055], CHROME);
  box(rotor, [0.008, 0.05, 0.004], [0, 0.055, -0.059], STRIPES[2]);
  disc(rotor, 0.018, 0.04, 12, [0, 0.068, -0.078], STRIPES[2]);
}

/**
 * Builds the cabinet at ABSOLUTE (`x`, `z`) on the sand, its front turned by `yaw`, on the
 * lowest ground under it. In the physics band it is solid, its pod too. `disposers` gets
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

  // The card window: a dark back, a frame standing proud of it, and the hinge across.
  box(root, [CARD_W + 0.02, CARD_H + 0.02, 0.01], [CARD_X, CARD_Y, FRONT - 0.005], GLASS_DARK);
  const frameZ = FRONT - 0.035;
  box(root, [CARD_W + 0.12, 0.05, 0.07], [CARD_X, CARD_Y + CARD_H / 2 + 0.025, frameZ], CABINET_BLACK);
  box(root, [CARD_W + 0.12, 0.05, 0.07], [CARD_X, CARD_Y - CARD_H / 2 - 0.025, frameZ], CABINET_BLACK);
  box(root, [0.05, CARD_H, 0.07], [CARD_X + CARD_W / 2 + 0.035, CARD_Y, frameZ], CABINET_BLACK);
  box(root, [0.05, CARD_H, 0.07], [CARD_X - CARD_W / 2 - 0.035, CARD_Y, frameZ], CABINET_BLACK);
  cylinder(root, 0.008, 0.008, CARD_W + 0.06, 8, [CARD_X, CARD_Y, CARD_Z - 0.006], C.metal, [0, 0, Math.PI / 2]);

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
    mesh.position.set(CARD_X, CARD_Y, CARD_Z);
    mesh.rotation.y = Math.PI;
    // The flips show and hide the window's halves one by one: never merged.
    mesh.userData.kitKeep = true;
    root.add(mesh);
  }
  // The flap, hinged across the middle: the card's top half facing the viewer, and on
  // its back the next card's bottom half, upside down until the flap has fallen.
  const flap = new THREE.Group();
  flap.position.set(CARD_X, CARD_Y, CARD_Z - 0.004);
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
  disc(buttonMount, 0.078, 0.024, 24, [0, 0, -0.012], CABINET_BLACK);
  const buttonCap = new THREE.Group();
  buttonCap.position.set(0, 0, BUTTON_REST);
  cylinder(buttonCap, 0.03, 0.03, 0.04, 12, [0, 0, -0.01], C.darkMetal, [Math.PI / 2, 0, 0]);
  cylinder(buttonCap, 0.062, 0.066, 0.035, 20, [0, 0, -0.045], look.buttonColour, [Math.PI / 2, 0, 0]);
  buttonMount.add(buttonCap);
  root.add(buttonMount);
  const buttonPlate = signMesh([look.buttonLabel], ...BUTTON_BOARD);
  buttonPlate.scale.set(0.17, 0.045, 1);
  buttonPlate.position.set(...BUTTON_LABEL_AT);
  buttonPlate.rotation.y = Math.PI;
  root.add(buttonPlate);

  // The cabinet's boxes in one draw per finish, each moving part's in one of its own.
  mergeKitStatics(root);
  group.add(root);

  if (ctx.hasPhysics) {
    addStatic(ctx, bodies, colliders, x, y + H / 2, z, RAPIER.ColliderDesc.cuboid(W / 2, H / 2, D / 2), SurfaceType.Concrete, yawRotation(yaw));
    const [px, pz] = local(POD_X, FRONT - POD_D / 2);
    addStatic(
      ctx,
      bodies,
      colliders,
      px,
      y + (POD_BOTTOM + POD_HIGH) / 2,
      pz,
      RAPIER.ColliderDesc.cuboid(POD_HALF_W, (POD_HIGH - POD_BOTTOM) / 2, POD_D / 2),
      SurfaceType.Concrete,
      yawRotation(yaw),
    );
  }

  return {
    root, wheel, flap, flapFront, flapBack, staticTop, staticBottom, cards: [cardA, cardB], buttonCap, x, y, z, yaw,
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
const BUTTON_AIM = mountBox(BUTTON_AT, DECK_TILT, 0.04, 0.09, 0.045);

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
  /** The grid's cell under the cursor when `part` is the grid, else -1. */
  private aimedCell = -1;
  protected focused = false;
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
  /** The hand holds the wheel. */
  private gripping = false;
  /** Radians the hand has turned it since it took hold: a click turns none. */
  private gripTravel = 0;
  private buttonT = -1;
  private refuseT = 0;
  private readonly focusPose: FixtureFocus;
  /**
   * What lies in the grid, by anchor cell (vehicle/trunk.ts occupancy over
   * `MACHINE_GRID`, footprints by `machineFootprint`): what the machine gave and the
   * player has not taken, and, for `SWALLOW_S`, what he put in.
   */
  protected readonly cells: (Item | null)[] = new Array<Item | null>(GRID_CELLS).fill(null);
  /** The anchor of what is being drawn in (-1: nothing), and the seconds it still lies there. */
  private swallowAt = -1;
  private swallowT = 0;
  private readonly gridView: GridViewState;

  constructor(
    readonly id: string,
    protected readonly parts: CardMachineParts,
    protected readonly world: GameWorld,
  ) {
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
    // What lay in it when it was last worked: anything that does not fit at its anchor
    // is dropped, earlier anchors first, as a boot read from a save (`normalizeBoot`).
    const saved = world.state.machineGrids[id] ?? [];
    for (let anchor = 0; anchor < Math.min(saved.length, GRID_CELLS); anchor++) {
      const item = saved[anchor];
      if (item && bootFits(this.cells, MACHINE_GRID, anchor, machineFootprint(item))) this.cells[anchor] = item;
    }
    this.gridView = { layout: MACHINE_GRID_LAYOUT, cells: this.cells, selectedCell: null, x: parts.x, y: parts.y, z: parts.z, yaw: parts.yaw };
  }

  /** Cards the wheel turns through now. */
  protected abstract cardCount(): number;
  /** Paints card `index` (-1: the machine has nothing to show) onto a card canvas. */
  protected abstract paintCard(g: CanvasRenderingContext2D, w: number, h: number, index: number): void;
  /** The button is pressed with card `index` selected: the sound (a `refuse` rattle, or what it did). */
  protected abstract pressButton(ctx: FixtureContext, index: number): FoleyEvent;
  /**
   * `held` is put to the free grid cell `cell`: the kind takes it in (`swallow`) or
   * refuses it. The default takes nothing in.
   */
  protected putIn(_ctx: FixtureContext, _held: Item, _cell: number): FoleyEvent | null {
    return 'refused';
  }
  /**
   * Something was taken out of the grid into the hands or the pack: the kind writes the
   * grid with whatever of its own goes with it. The default writes the grid alone.
   */
  protected gridTaken(): void {
    this.saveGrid();
  }
  /** The machine was framed. */
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

  /** The first anchor in the grid where `item` fits now, or -1: no room for it. */
  protected roomFor(item: Item): number {
    return bootFreeAnchor(this.cells, MACHINE_GRID, machineFootprint(item));
  }

  /**
   * Puts `item` into the grid where it fits (`roomFor`): what the machine gives. False,
   * and nothing given, with no room. The kind saves the grid with its own state (`saveGrid`).
   */
  protected give(item: Item): boolean {
    const anchor = this.roomFor(item);
    if (anchor < 0) return false;
    this.cells[anchor] = item;
    return true;
  }

  /**
   * Where `item` goes when put to the free cell `cell`: the anchor its footprint fits at
   * round it, as into a boot (`bootAnchorAt`). -1 when none does, and the HUD says why,
   * as a boot's prompt does (player/interaction.ts `bootRefusal`).
   */
  protected putAnchor(ctx: FixtureContext, item: Item, cell: number): number {
    const footprint = machineFootprint(item);
    const anchor = bootAnchorAt(this.cells, MACHINE_GRID, cell, footprint);
    if (anchor >= 0) return anchor;
    const name = item.type === 'contract_cargo' ? contractThing(item).name : itemLabel(item);
    const size = `${footprint.columns}×${footprint.rows} cells`;
    ctx.toast(bootFreeAnchor(this.cells, MACHINE_GRID, footprint) >= 0
      ? `the ${name} takes ${size} — aim where they are free`
      : `no room for the ${name}: it takes ${size} — take out what lies there`);
    return -1;
  }

  /**
   * Lays `item`, put in at `anchor`, in the grid for `SWALLOW_S` while the machine draws
   * it in. It is the machine's already: the save never holds it (`gridCells`), and a
   * click on it takes nothing.
   */
  protected swallow(item: Item, anchor: number): void {
    this.finishSwallow();
    this.cells[anchor] = item;
    this.swallowAt = anchor;
    this.swallowT = SWALLOW_S;
  }

  private finishSwallow(): void {
    if (this.swallowAt >= 0) this.cells[this.swallowAt] = null;
    this.swallowAt = -1;
    this.swallowT = 0;
  }

  /** The grid as the save holds it: what is being drawn in is gone already. */
  protected gridCells(): (Item | null)[] {
    const cells = this.cells.slice();
    if (this.swallowAt >= 0) cells[this.swallowAt] = null;
    return cells;
  }

  /** Writes the grid into the save (`machine_grid`). */
  protected saveGrid(): void {
    this.world.apply({ t: 'machine_grid', machineId: this.id, cells: this.gridCells() });
  }

  /**
   * A click on grid cell `cell`, as on a boot's (player/interaction.ts
   * `operateTrunkCell`): what covers it comes out into the hands or the pack, whole,
   * even with something held; a free cell takes what is held, if the kind takes it in.
   */
  private useCell(ctx: FixtureContext, cell: number): FoleyEvent | null {
    const at = bootOwner(this.cells, MACHINE_GRID, cell);
    if (at >= 0) {
      if (at === this.swallowAt) return null;
      const item = this.cells[at]!;
      if (!ctx.inventory.add(item)) {
        ctx.toast('hands full');
        return 'refused';
      }
      this.cells[at] = null;
      this.gridTaken();
      return 'pickup';
    }
    const held = ctx.held;
    return held ? this.putIn(ctx, held, cell) : null;
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
    this.focused = focused;
    if (!focused) this.release();
    else if (!was) this.onFocused(ctx);
  }

  grid(): FixedGridView | null {
    if (!this.focused) return null;
    this.gridView.selectedCell = this.part === 'grid' && this.aimedCell >= 0 ? this.aimedCell : null;
    return this.gridView;
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
    let aimedCell = -1;
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
    // The grid's cells, in the plane they are drawn in over the plate.
    for (let cell = 0; cell < GRID_CELLS; cell++) {
      const t = rayBox(ox, oy, oz, lx, dy, lz, cellX(cell), cellY(cell), GRID_Z, CELL_W / 2, CELL_H / 2, 0.02);
      if (t < best) {
        best = t;
        part = 'grid';
        aimedCell = cell;
      }
    }
    this.part = best > range ? null : part;
    this.aimedCell = this.part === 'grid' ? aimedCell : -1;
    return best > range ? Infinity : best;
  }

  prompt(_ctx: FixtureContext): string | null {
    // Worked up close it says nothing: the cards, the showcase and the grid are the text.
    if (this.focused || this.part === null) return null;
    return `[F] ${this.title}`;
  }

  press(ctx: FixtureContext): FoleyEvent | null {
    switch (this.part) {
      case 'button':
        this.buttonT = 0;
        return this.pressButton(ctx, this.selected);
      case 'wheel':
        // A click without a drag still turns it one card.
        return this.turnBy(1);
      case 'grid':
        return this.aimedCell >= 0 ? this.useCell(ctx, this.aimedCell) : null;
      default:
        return null;
    }
  }

  grab(originX: number, originZ: number, eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number): boolean {
    this.aim(originX, originZ, eyeX, eyeY, eyeZ, dx, dy, dz, Infinity);
    if (this.part !== 'wheel') return false;
    this.gripping = true;
    this.gripTravel = 0;
    return true;
  }

  pivot(): { x: number; y: number; z: number } {
    const c = Math.cos(this.parts.yaw);
    const s = Math.sin(this.parts.yaw);
    const [lx, ly, lz] = WHEEL_AT;
    return { x: this.parts.x + c * lx + s * lz, y: this.parts.y + ly, z: this.parts.z - s * lx + c * lz };
  }

  drag(turn: number): FoleyEvent | null {
    if (!this.gripping) return null;
    // The rotor follows the hand round its axle as the screen shows it: `turn` is
    // clockwise on the screen, and the framing camera looks at the dial's face along its
    // +Z, where a rising rotation.z turns clockwise too. The knob need not be under the
    // cursor to be turned, and nothing stops it.
    this.gripTravel += Math.abs(turn);
    this.wheelTarget += turn;
    this.wheelAngle = this.wheelTarget;
    return this.countDetents();
  }

  release(): FoleyEvent | null {
    if (!this.gripping) return null;
    this.gripping = false;
    // A click on the wheel with no turn in it is one card on.
    if (this.gripTravel < 0.05) return this.turnBy(1);
    // Let go, it settles into the nearest detent.
    this.wheelTarget = Math.round(this.wheelTarget / DETENT) * DETENT;
    return this.countDetents();
  }

  scroll(notches: number): FoleyEvent | null {
    return this.turnBy(notches);
  }

  /** Turns the wheel `steps` detents on its own (a click, the wheel). */
  private turnBy(steps: number): FoleyEvent | null {
    this.wheelTarget = (Math.round(this.wheelTarget / DETENT) + steps) * DETENT;
    return this.countDetents();
  }

  /** Cards for every detent the wheel's target has passed since the last count. */
  private countDetents(): FoleyEvent | null {
    // Forward is clockwise from the framing camera: the angle rising.
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

  /** The cursor over the machine: a hand for the wheel, a pointer for what clicks. */
  cursor(): 'grab' | 'grabbing' | 'pointer' | null {
    if (this.gripping) return 'grabbing';
    if (this.part === 'wheel') return 'grab';
    if (this.part === 'button' || this.part === 'grid') return 'pointer';
    return null;
  }

  update(dt: number): void {
    if (!this.gripping) this.wheelAngle += (this.wheelTarget - this.wheelAngle) * Math.min(1, dt * 14);
    this.parts.wheel.rotation.z = this.wheelAngle;

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
    this.parts.buttonCap.position.z = BUTTON_REST + push;

    if (this.swallowAt >= 0) {
      this.swallowT -= dt;
      if (this.swallowT <= 0) this.finishSwallow();
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
