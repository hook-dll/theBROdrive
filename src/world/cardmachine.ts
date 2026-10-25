import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { SurfaceType } from '../core/surfaces';
import type { Item } from '../items/items';
import type { ChunkContext } from './chunks';
import { devLook, type MachineStyle } from './devlook';
import { rayBox, type FixtureContext, type FixtureFocus, type WorldFixture } from './fixturefield';
import { paintSign, registerAtlasSign, SIGN_PLANE, signMesh } from './market';
import { fillGameText } from '../ui/balls';
import { box, C, cylinder, mergeKitStatics, type V3 } from './poi/kit';
import { addStatic, yawRotation } from './props/scatter';

/**
 * THE CARD MACHINE: the one cabinet the POST (world/post.ts) and the SHOP
 * (world/vending.ts) are built as, worked by hand up close (player/machinefocus.ts).
 *
 * F on it frames it in the camera and frees the cursor; from then on nothing is written
 * on the screen, the machine itself is the text. Then:
 *  - the WHEEL on the front, right of the card window as the viewer stands, is dragged
 *    round about its axle (local Z, facing him), without end and without a stop. Every
 *    detent is one card (a spoke's step on the handwheels, a tick pair on the dial):
 *    the card window is a split flap, so the top half of the card showing falls toward
 *    the viewer and the next card is there under it. Turned back, the cards come round
 *    the other way. The mouse wheel turns it a detent at a time too, and a click on the
 *    wheel is one card on.
 *  - the BUTTON under the wheel takes what the card offers (the post's TAKE, the shop's
 *    BUY): it drops out of the chute into the TRAY, and the machine lets go of the
 *    player (`stepBack`) so he sees it lying there and picks it up. Nothing a machine
 *    gives goes to the hand.
 *  - the TRAY is the machine's one opening: what it gives lies in it, and what it takes
 *    (a post's cargo) is put into it.
 *  - MONEY: what it sells is debited straight from the player's money; short, the
 *    button rattles and gives nothing.
 *
 * The cabinet is one of three trial designs the owner picks between (world/devlook.ts
 * `devLook.machine`, 2026-10-26), all on the same front layout and the same mechanics:
 *  - `soda`: a Soviet soda fountain (АГВ): an enamelled cabinet with chamfered edges in
 *    the look's colour, chrome mouldings, a visor over the title, a coin plate, and a
 *    chrome ship's wheel of six spokes with black knobs. A card per spoke, 60°.
 *  - `arcade`: an arcade cabinet: black cheeks with art stripes, a marquee overhanging
 *    the top with its title lit and a row of bulbs, the window in a black bezel, and a
 *    control pod under the wheel's side whose sloped deck carries a knurled dial with
 *    a finger knob and tick marks, and the button. A card per long tick, 45°.
 *  - `safe`: a riveted post-office safe: the steel door framed in rivet rows and hung on
 *    two hinges, brass trim, a brass title plate, a keyhole, and a safe's handwheel of
 *    four spoke handles over a numbered dial ring. A card per quarter turn.
 *
 * The cards are painted on two canvases in turn, so a machine owns two sign-shaped
 * materials (the program `marketProgramAnchor` links at boot) and repaints them in place;
 * the safe's dial ring is one more of that shape, painted once and shared by every safe.
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

/** The wheel's column, right of the window as the viewer stands: the wheel at hand height, the button under it. */
const WHEEL_X = -0.41;
const WHEEL_Y = 1.24;
const BUTTON_Y = 0.9;
/** A plate or showcase under the window, on the flat front. */
export const PANEL_X = CARD_X;
export const PANEL_Y = 1.0;

/** The trough standing out of the front at the bottom, and the chute mouth above it. */
const TRAY_W = 0.9;
const TRAY_D = 0.38;
const TRAY_FLOOR = 0.4;
const TRAY_WALL = 0.18;
const TRAY_Z = FRONT - TRAY_D / 2;
const MOUTH_W = TRAY_W - 0.1;
const MOUTH_H = 0.3;
const MOUTH_Y = TRAY_FLOOR + 0.04 + MOUTH_H / 2;

/** The tray's painted label, over the chute mouth and under the panel. */
const TRAY_LABEL_Y = 0.8;

/** The button cap's face at rest, out from the face it stands on. */
const BUTTON_REST = -0.03;

/** Timelines, seconds. */
const FLIP_S = 0.26;
const BUTTON_S = 0.3;
const CHUTE_S = 0.6;
const REFUSE_S = 0.4;

/** The camera's place to work the machine, local metres: in front, a little to the wheel's side and above. */
const FOCUS_EYE: readonly [number, number, number] = [-0.3, 1.8, FRONT - 2.2];
const FOCUS_LOOK: readonly [number, number, number] = [-0.06, 1.18, FRONT];
const FOCUS_FOV = 50;

/** Finishes the designs share. */
const CHROME = 0xd3d7d6;
const BRASS = 0xb8913f;
const BRASS_DARK = 0x7d6128;
const BAKELITE = 0x1c1a18;
const STEEL = 0x434847;
const CABINET_BLACK = 0x18191c;
const GLASS_DARK = 0x111314;

/** The arcade's control pod: across the wheel's column, its sloped deck rising back to the front. */
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

/** The safe's dial ring behind its handwheel: its radius and its painted face's square, inside it. */
const DIAL_R = 0.19;
const DIAL_FACE = (DIAL_R - 0.056) * Math.SQRT2;

type Part = 'body' | 'cards' | 'wheel' | 'button' | 'tray';

/** A title board's paint and canvas size, as `registerAtlasSign` takes them. */
type Board = readonly [bg: string, fg: string, width: number, height: number];

/** What tells the three designs apart on the shared front. */
interface Design {
  /** The wheel's mount: its axle's foot on the face it stands on, and its lean back off upright (rad about local X). */
  readonly wheel: V3;
  readonly wheelTilt: number;
  /** Out from the axle to the farthest knob or rim: the hand's target. */
  readonly wheelReach: number;
  /** One card's turn. */
  readonly detent: number;
  readonly button: V3;
  readonly buttonTilt: number;
  /** The button's name plate's centre. */
  readonly buttonLabel: V3;
  readonly trayLabelX: number;
  readonly frame: number;
  readonly title: Board;
  /** The title board's size and centre. */
  readonly titleSize: readonly [number, number];
  readonly titleAt: V3;
}

const DESIGNS: Readonly<Record<MachineStyle, Design>> = {
  soda: {
    wheel: [WHEEL_X, WHEEL_Y, FRONT],
    wheelTilt: 0,
    wheelReach: 0.21,
    detent: Math.PI / 3,
    button: [WHEEL_X, BUTTON_Y, FRONT],
    buttonTilt: 0,
    buttonLabel: [WHEEL_X, BUTTON_Y - 0.11, FRONT - 0.003],
    trayLabelX: 0,
    frame: CHROME,
    title: ['#f4ecd6', '#a3271b', 512, 128],
    titleSize: [0.84, 0.19],
    titleAt: [0, 1.97, FRONT - 0.016],
  },
  arcade: {
    wheel: [POD_X - 0.11, DECK_Y, DECK_Z],
    wheelTilt: DECK_TILT,
    wheelReach: 0.145,
    detent: Math.PI / 4,
    button: [POD_X + 0.16, DECK_Y, DECK_Z],
    buttonTilt: DECK_TILT,
    buttonLabel: [POD_X + 0.16, (POD_BOTTOM + POD_LOW) / 2, FRONT - POD_D - 0.003],
    // Clear of the pod, which would hide it from the framing camera.
    trayLabelX: 0.2,
    frame: CABINET_BLACK,
    title: ['#ffd35a', '#1b1420', 512, 128],
    titleSize: [1.0, 0.24],
    titleAt: [0, 1.95, FRONT - 0.124],
  },
  safe: {
    wheel: [WHEEL_X, WHEEL_Y, FRONT],
    wheelTilt: 0,
    wheelReach: 0.235,
    detent: Math.PI / 2,
    button: [WHEEL_X, BUTTON_Y, FRONT],
    buttonTilt: 0,
    buttonLabel: [WHEEL_X, BUTTON_Y - 0.11, FRONT - 0.003],
    trayLabelX: 0,
    frame: BRASS,
    title: ['#c9a44e', '#2b1d08', 512, 128],
    titleSize: [0.6, 0.12],
    titleAt: [0, 1.91, FRONT - 0.01],
  },
};

/** This session's design (read once at load: the stops are built as their chunks stream in). */
const STYLE = devLook.machine;
const DESIGN = DESIGNS[STYLE];
const DETENT = DESIGN.detent;

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
  /** The wheel's rotor, turning about its own local Z. */
  readonly wheel: THREE.Object3D;
  readonly flap: THREE.Object3D;
  readonly flapFront: THREE.Mesh;
  readonly flapBack: THREE.Mesh;
  readonly staticTop: THREE.Mesh;
  readonly staticBottom: THREE.Mesh;
  readonly cards: readonly [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  /** The button's cap, pushed in along its own local Z. */
  readonly buttonCap: THREE.Object3D;
  readonly chute: THREE.Object3D;
  /** ABSOLUTE metres of the cabinet's base centre, and its yaw. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/** The boards' paint and canvas size: button plate, tray label (the title's is the design's). */
const BUTTON_BOARD = ['#f2ecd8', '#26221c', 256, 64] as const;
const TRAY_BOARD = ['#f2ecd8', '#7a1f12', 512, 64] as const;

/**
 * Puts a machine kind's boards on the sign atlas (world/market.ts `registerAtlasSign`), so
 * they draw as one. Call at module load, beside the kind's look.
 */
export function registerCardMachineSigns(look: CardMachineLook): void {
  registerAtlasSign([look.title], ...DESIGN.title);
  registerAtlasSign([look.buttonLabel], ...BUTTON_BOARD);
  if (look.trayLabel) registerAtlasSign([look.trayLabel], ...TRAY_BOARD);
}

/** A ring of `segments` boxes in the XY plane round (0, 0, `z`): a rim, a bezel. */
function ring(parent: THREE.Object3D, r: number, band: number, depth: number, segments: number, z: number, colour: number): void {
  const chord = 2 * r * Math.tan(Math.PI / segments) + band * 0.3;
  for (let k = 0; k < segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    box(parent, [chord, band, depth], [Math.cos(a) * r, Math.sin(a) * r, z], colour, [0, 0, a + Math.PI / 2]);
  }
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

/**
 * A box with its four vertical edges chamfered by `c`: two crossed boxes and a diamond
 * filling each notch. The soda fountain's cabinet reads rounded from these.
 */
function chamferBox(parent: THREE.Object3D, size: V3, at: V3, c: number, colour: number): void {
  const [w, h, d] = size;
  box(parent, [w, h, d - 2 * c], at, colour);
  box(parent, [w - 2 * c, h, d], at, colour);
  const s = c * Math.SQRT2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(parent, [s, h, s], [at[0] + sx * (w / 2 - c), at[1], at[2] + sz * (d / 2 - c)], colour, [0, Math.PI / 4, 0]);
  }
}

/** The safe's dial ring's face: numbers 0-90 and ticks, light on dark steel. Shared by every safe, kept for the session. */
let dialFace: THREE.MeshStandardMaterial | null = null;
function safeDialFace(): THREE.MeshStandardMaterial {
  if (dialFace) return dialFace;
  dialFace = paintSign([''], '#24272a', '#e9dfc4', 256, 256);
  const canvas: unknown = dialFace.map?.image;
  // Headless (the tools' builds), the face is a blank data texture.
  if (typeof HTMLCanvasElement === 'undefined' || !(canvas instanceof HTMLCanvasElement)) return dialFace;
  const g = canvas.getContext('2d');
  if (!g) return dialFace;
  const half = canvas.width / 2;
  g.fillStyle = '#24272a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = '#e9dfc4';
  g.fillStyle = '#e9dfc4';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(half * 0.2)}px sans-serif`;
  for (let k = 0; k < 50; k++) {
    // Clockwise from the top, as a safe's numbers run.
    const a = -Math.PI / 2 + (k / 50) * Math.PI * 2;
    const major = k % 5 === 0;
    g.lineWidth = major ? 5 : 2;
    g.beginPath();
    g.moveTo(half + Math.cos(a) * half * (major ? 0.8 : 0.88), half + Math.sin(a) * half * (major ? 0.8 : 0.88));
    g.lineTo(half + Math.cos(a) * half * 0.97, half + Math.sin(a) * half * 0.97);
    g.stroke();
    if (major) g.fillText(String(k * 2), half + Math.cos(a) * half * 0.6, half + Math.sin(a) * half * 0.6);
  }
  dialFace.map!.needsUpdate = true;
  return dialFace;
}

/** The soda fountain's cabinet, visor and coin plate. */
function dressSoda(root: THREE.Group, look: CardMachineLook): void {
  const c = 0.06;
  chamferBox(root, [W + 0.04, 0.1, D + 0.04], [0, 0.05, 0], c + 0.02, C.darkMetal);
  chamferBox(root, [W, 1.76, D], [0, 0.1 + 0.88, 0], c, look.body);
  // The head over the chrome band, a little proud, with the title under the visor.
  chamferBox(root, [W + 0.03, 0.03, D + 0.03], [0, 1.875, 0], c, CHROME);
  chamferBox(root, [W + 0.02, 0.21, D + 0.02], [0, 1.995, 0], c, look.body);
  chamferBox(root, [W - 0.06, 0.04, D - 0.06], [0, H + 0.02, 0], c, look.body);
  // The visor: a slab leaning down toward the viewer, a chrome lip along its edge.
  const visorD = 0.26;
  const lean = 0.18;
  box(root, [W + 0.1, 0.035, visorD], [0, H - 0.01, FRONT - visorD / 2 + 0.03], look.body, [-lean, 0, 0]);
  cylinder(root, 0.02, 0.02, W + 0.12, 12, [0, H - 0.01 - (visorD / 2) * Math.sin(lean), FRONT - visorD + 0.03], CHROME, [0, 0, Math.PI / 2]);
  // Chrome strips down the front chamfers, and along the plinth.
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - c / 2 + 0.004);
    cylinder(root, 0.013, 0.013, 1.76, 8, [x, 0.1 + 0.88, FRONT + c / 2 - 0.004], CHROME);
  }
  box(root, [W - 2 * c, 0.02, 0.02], [0, 0.1, FRONT - 0.01], CHROME);
  // The coin plate over the wheel: a chrome escutcheon and its slot.
  box(root, [0.09, 0.13, 0.015], [WHEEL_X, 1.6, FRONT - 0.007], CHROME);
  box(root, [0.012, 0.06, 0.006], [WHEEL_X, 1.61, FRONT - 0.016], BAKELITE);
}

/** The ship's wheel: a chrome hub, rim and six spokes running on to black knobs. */
function sodaWheel(mount: THREE.Object3D, rotor: THREE.Object3D): void {
  disc(mount, 0.08, 0.03, 20, [0, 0, -0.015], C.darkMetal);
  disc(rotor, 0.045, 0.05, 16, [0, 0, -0.05], CHROME);
  disc(rotor, 0.03, 0.02, 12, [0, 0, -0.085], CHROME);
  ring(rotor, 0.14, 0.02, 0.03, 18, -0.07, CHROME);
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 + (k / 6) * Math.PI * 2;
    spoke(rotor, 0.035, 0.165, 0.011, a, -0.07, CHROME);
    spoke(rotor, 0.162, 0.21, 0.018, a, -0.07, BAKELITE);
  }
}

/** The arcade's cheeks and stripes, marquee, bezel and coin door, and the pod under the wheel's column. */
function dressArcade(root: THREE.Group, look: CardMachineLook): void {
  const cheek = 0.04;
  box(root, [W - 2 * cheek, H - 0.3, D], [0, (H - 0.3) / 2, 0], look.body);
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - cheek / 2);
    box(root, [cheek, H, D], [x, H / 2, 0], CABINET_BLACK);
    // T-moulding up the cheek's front edge.
    box(root, [cheek + 0.008, H, 0.014], [x, H / 2, FRONT - 0.003], 0xd9a52b);
    // Art stripes along the flank, leaning up toward the front.
    const stripes = [0xd9a52b, 0xd2622a, 0xb03a2e];
    stripes.forEach((colour, k) => {
      box(root, [0.006, 0.07, 0.98], [sx * (W / 2 + 0.003), 0.62 + k * 0.13, 0], colour, [0.4, 0, 0]);
      box(root, [0.006, 0.05, 0.98], [sx * (W / 2 + 0.003), 1.42 + k * 0.1, 0], colour, [0.4, 0, 0]);
    });
  }
  box(root, [W - 2 * cheek, 0.1, 0.02], [0, 0.05, FRONT - 0.01], CABINET_BLACK);
  // The marquee overhanging the top, its underside a lit strip and bulbs along its foot.
  const over = 0.12;
  box(root, [W - 2 * cheek, 0.3, D + over], [0, H - 0.15, -over / 2], CABINET_BLACK);
  box(root, [W - 2 * cheek - 0.06, 0.012, over - 0.02], [0, H - 0.3 - 0.006, FRONT - over / 2], 0xfff1b8);
  for (let k = 0; k < 11; k++) {
    disc(root, 0.011, 0.014, 8, [-0.55 + k * 0.11, H - 0.285, FRONT - over - 0.007], 0xfff3c4);
  }
  // The window's black bezel.
  box(root, [CARD_W + 0.14, CARD_H + 0.16, 0.012], [CARD_X, CARD_Y, FRONT - 0.006], CABINET_BLACK);
  // The coin door over the pod: a red-lit plate with two slots.
  box(root, [0.11, 0.17, 0.016], [WHEEL_X, 1.45, FRONT - 0.008], 0x2a2a2e);
  for (const dx of [-0.025, 0.025]) box(root, [0.035, 0.06, 0.006], [WHEEL_X + dx, 1.47, FRONT - 0.018], 0xc0392b);

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
  box(root, [POD_HALF_W * 2 + 0.01, 0.02, 0.02], [POD_X, POD_LOW, FRONT - POD_D], 0xd9a52b);
}

/** The arcade dial: a knurled knob with a finger post, over tick marks on the deck. */
function arcadeWheel(mount: THREE.Object3D, rotor: THREE.Object3D): void {
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
  box(rotor, [0.008, 0.05, 0.004], [0, 0.055, -0.059], 0xb03a2e);
  disc(rotor, 0.018, 0.04, 12, [0, 0.068, -0.078], 0xb03a2e);
}

/** The safe's steel, rivet rows, hinges, cornice, title plate and keyhole. */
function dressSafe(root: THREE.Group, look: CardMachineLook): void {
  box(root, [W + 0.06, 0.08, D + 0.06], [0, 0.04, 0], C.darkMetal);
  box(root, [W, H - 0.2, D], [0, 0.08 + (H - 0.2) / 2, 0], look.body);
  // The cornice, with a brass edge.
  box(root, [W + 0.08, 0.12, D + 0.08], [0, H - 0.06, 0], STEEL);
  box(root, [W + 0.08, 0.018, 0.008], [0, H - 0.11, FRONT - 0.044], BRASS);
  // The door's frame: four heavy bars proud of the front, and rivets along each.
  const bar = 0.05;
  const doorTop = 1.82;
  const doorBottom = 0.1;
  const proud = 0.025;
  const frameZ = FRONT - proud / 2;
  for (const sx of [-1, 1]) box(root, [bar, doorTop - doorBottom, proud], [sx * (W / 2 - bar / 2), (doorTop + doorBottom) / 2, frameZ], STEEL);
  box(root, [W, bar, proud], [0, doorTop, frameZ], STEEL);
  box(root, [W, bar, proud], [0, doorBottom, frameZ], STEEL);
  const rivet = (at: V3, axis: 'z' | 'x'): void => {
    cylinder(root, 0.011, 0.011, 0.012, 6, at, 0x6a6f6d, axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2]);
  };
  for (let y = 0.2; y < doorTop - 0.05; y += 0.115) {
    for (const sx of [-1, 1]) rivet([sx * (W / 2 - bar / 2), y, FRONT - proud - 0.004], 'z');
  }
  for (let x = -0.55; x <= 0.551; x += 0.1375) rivet([x, doorTop, FRONT - proud - 0.004], 'z');
  // The flanks: a rivet row down each edge.
  for (const sx of [-1, 1]) {
    for (let y = 0.2; y < H - 0.15; y += 0.14) {
      for (const z of [FRONT + 0.04, -FRONT - 0.04]) rivet([sx * (W / 2 + 0.004), y, z], 'x');
    }
  }
  // Two hinges on the viewer's left, where the door would swing.
  for (const y of [0.45, 1.5]) cylinder(root, 0.035, 0.035, 0.2, 12, [W / 2 + 0.012, y, FRONT + 0.03], C.darkMetal);
  // The title plate's dark brass frame, and the keyhole over the wheel.
  box(root, [DESIGN.titleSize[0] + 0.04, DESIGN.titleSize[1] + 0.04, 0.012], [0, DESIGN.titleAt[1], FRONT - 0.004], BRASS_DARK);
  box(root, [0.07, 0.11, 0.012], [WHEEL_X, 1.6, FRONT - 0.006], BRASS);
  disc(root, 0.012, 0.004, 10, [WHEEL_X, 1.615, FRONT - 0.014], BAKELITE);
  box(root, [0.008, 0.03, 0.004], [WHEEL_X, 1.595, FRONT - 0.014], BAKELITE);
}

/** The safe's handwheel: a brass hub and four steel spokes with brass knobs, over the numbered ring. */
function safeWheel(mount: THREE.Object3D, rotor: THREE.Object3D): void {
  disc(mount, DIAL_R, 0.012, 32, [0, 0, -0.006], 0x24272a);
  const face = new THREE.Mesh(SIGN_PLANE, safeDialFace());
  face.scale.set(DIAL_FACE, DIAL_FACE, 1);
  face.position.set(0, 0, -0.0125);
  face.rotation.y = Math.PI;
  mount.add(face);
  ring(mount, DIAL_R, 0.016, 0.022, 24, -0.011, BRASS);
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 - (k / 10) * Math.PI * 2;
    spoke(mount, DIAL_FACE / 2 + 0.008, DIAL_R - 0.012, 0.004, a, -0.013, BRASS);
  }
  box(mount, [0.018, 0.022, 0.008], [0, DIAL_R + 0.02, -0.004], BRASS);
  disc(rotor, 0.055, 0.06, 16, [0, 0, -0.045], BRASS);
  disc(rotor, 0.035, 0.02, 12, [0, 0, -0.082], BRASS_DARK);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k / 4) * Math.PI * 2;
    spoke(rotor, 0.04, 0.205, 0.016, a, -0.065, STEEL);
    disc(rotor, 0.03, 0.045, 14, [Math.cos(a) * 0.205, Math.sin(a) * 0.205, -0.065], BRASS);
  }
}

const DRESS: Readonly<Record<MachineStyle, (root: THREE.Group, look: CardMachineLook) => void>> = {
  soda: dressSoda,
  arcade: dressArcade,
  safe: dressSafe,
};
const WHEELS: Readonly<Record<MachineStyle, (mount: THREE.Object3D, rotor: THREE.Object3D) => void>> = {
  soda: sodaWheel,
  arcade: arcadeWheel,
  safe: safeWheel,
};

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
  DRESS[STYLE](root, look);
  const board = signMesh([look.title], ...DESIGN.title);
  board.scale.set(DESIGN.titleSize[0], DESIGN.titleSize[1], 1);
  board.position.set(...DESIGN.titleAt);
  board.rotation.y = Math.PI;
  root.add(board);

  // The card window: a dark back, a frame standing proud of it, and the hinge across.
  box(root, [CARD_W + 0.02, CARD_H + 0.02, 0.01], [CARD_X, CARD_Y, FRONT - 0.005], GLASS_DARK);
  const frameZ = FRONT - 0.035;
  box(root, [CARD_W + 0.12, 0.05, 0.07], [CARD_X, CARD_Y + CARD_H / 2 + 0.025, frameZ], DESIGN.frame);
  box(root, [CARD_W + 0.12, 0.05, 0.07], [CARD_X, CARD_Y - CARD_H / 2 - 0.025, frameZ], DESIGN.frame);
  box(root, [0.05, CARD_H, 0.07], [CARD_X + CARD_W / 2 + 0.035, CARD_Y, frameZ], DESIGN.frame);
  box(root, [0.05, CARD_H, 0.07], [CARD_X - CARD_W / 2 - 0.035, CARD_Y, frameZ], DESIGN.frame);
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

  // The wheel: a mount on the face it stands on (its -Z out of that face), what is fixed
  // there, and the rotor turning about the mount's Z.
  const wheelMount = new THREE.Group();
  wheelMount.position.set(...DESIGN.wheel);
  wheelMount.rotation.x = DESIGN.wheelTilt;
  const wheel = new THREE.Group();
  WHEELS[STYLE](wheelMount, wheel);
  wheelMount.add(wheel);
  root.add(wheelMount);

  // The button: a bezel and a mushroom cap that goes in when pressed, and its name.
  const buttonMount = new THREE.Group();
  buttonMount.position.set(...DESIGN.button);
  buttonMount.rotation.x = DESIGN.buttonTilt;
  if (STYLE === 'safe') box(buttonMount, [0.17, 0.17, 0.03], [0, 0, -0.012], BRASS);
  else disc(buttonMount, STYLE === 'arcade' ? 0.078 : 0.088, 0.024, 24, [0, 0, -0.012], STYLE === 'arcade' ? CABINET_BLACK : CHROME);
  const buttonCap = new THREE.Group();
  buttonCap.position.set(0, 0, BUTTON_REST);
  cylinder(buttonCap, 0.03, 0.03, 0.04, 12, [0, 0, -0.01], C.darkMetal, [Math.PI / 2, 0, 0]);
  cylinder(buttonCap, 0.062, 0.066, 0.035, 20, [0, 0, -0.045], look.buttonColour, [Math.PI / 2, 0, 0]);
  buttonMount.add(buttonCap);
  root.add(buttonMount);
  const buttonPlate = signMesh([look.buttonLabel], ...BUTTON_BOARD);
  buttonPlate.scale.set(0.17, 0.045, 1);
  buttonPlate.position.set(...DESIGN.buttonLabel);
  buttonPlate.rotation.y = Math.PI;
  root.add(buttonPlate);

  // The chute's dark mouth and its flap hanging over it, and the trough before it.
  const trim = STYLE === 'soda' ? CHROME : STYLE === 'safe' ? STEEL : C.darkMetal;
  box(root, [MOUTH_W + 0.05, MOUTH_H + 0.05, 0.02], [0, MOUTH_Y, FRONT - 0.006], trim);
  box(root, [MOUTH_W, MOUTH_H, 0.01], [0, MOUTH_Y, FRONT - 0.017], 0x0e1011);
  const chute = new THREE.Group();
  chute.position.set(0, MOUTH_Y + MOUTH_H / 2, FRONT - 0.026);
  box(chute, [MOUTH_W - 0.02, MOUTH_H - 0.01, 0.012], [0, -MOUTH_H / 2, 0], C.metal);
  box(chute, [0.14, 0.02, 0.025], [0, -MOUTH_H + 0.03, -0.012], C.darkMetal);
  root.add(chute);
  const trayBody = STYLE === 'arcade' ? CABINET_BLACK : look.body;
  box(root, [TRAY_W, 0.03, TRAY_D], [0, TRAY_FLOOR - 0.015, TRAY_Z], C.darkMetal);
  box(root, [0.025, TRAY_WALL, TRAY_D], [TRAY_W / 2, TRAY_FLOOR + TRAY_WALL / 2, TRAY_Z], trayBody);
  box(root, [0.025, TRAY_WALL, TRAY_D], [-TRAY_W / 2, TRAY_FLOOR + TRAY_WALL / 2, TRAY_Z], trayBody);
  box(root, [TRAY_W + 0.025, 0.07, 0.025], [0, TRAY_FLOOR + 0.035, FRONT - TRAY_D], trayBody);
  box(root, [TRAY_W + 0.04, TRAY_FLOOR - 0.03, TRAY_D], [0, (TRAY_FLOOR - 0.03) / 2, TRAY_Z], trayBody);
  // The trough's lip in the design's trim.
  box(root, [TRAY_W + 0.045, 0.012, 0.03], [0, TRAY_FLOOR + 0.076, FRONT - TRAY_D], trim);
  // The tray's label: what goes in, and where.
  if (look.trayLabel) {
    const label = signMesh([look.trayLabel], ...TRAY_BOARD);
    label.scale.set(0.5, 0.0625, 1);
    label.position.set(DESIGN.trayLabelX, TRAY_LABEL_Y, FRONT - 0.003);
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
    if (STYLE === 'arcade') {
      solid(POD_X, (POD_BOTTOM + POD_HIGH) / 2, FRONT - POD_D / 2, POD_HALF_W, (POD_HIGH - POD_BOTTOM) / 2, POD_D / 2);
    }
  }

  return {
    root, wheel, flap, flapFront, flapBack, staticTop, staticBottom, cards: [cardA, cardB], buttonCap, chute, x, y, z, yaw,
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
const WHEEL_AIM = mountBox(DESIGN.wheel, DESIGN.wheelTilt, 0.05, DESIGN.wheelReach, 0.06);
const BUTTON_AIM = mountBox(DESIGN.button, DESIGN.buttonTilt, 0.04, 0.09, 0.045);

/**
 * A card machine's mechanics; the kind decides what the cards are, what the button
 * does and what the tray takes.
 */
export abstract class CardMachine implements WorldFixture {
  private part: Part | null = null;
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

  /** Cards the wheel turns through now. */
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
    test('cards', CARD_X, CARD_Y, FRONT - 0.04, CARD_W / 2 + 0.06, CARD_H / 2 + 0.05, 0.045);
    test('wheel', ...WHEEL_AIM);
    test('button', ...BUTTON_AIM);
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
      case 'wheel':
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
    if (this.part !== 'wheel') return false;
    this.gripping = true;
    this.gripTravel = 0;
    return true;
  }

  pivot(): { x: number; y: number; z: number } {
    const c = Math.cos(this.parts.yaw);
    const s = Math.sin(this.parts.yaw);
    const [lx, ly, lz] = DESIGN.wheel;
    return { x: this.parts.x + c * lx + s * lz, y: this.parts.y + ly, z: this.parts.z - s * lx + c * lz };
  }

  drag(turn: number): FoleyEvent | null {
    if (!this.gripping) return null;
    // The rotor follows the hand round its axle as the screen shows it: `turn` is
    // clockwise on the screen, and the framing camera looks at the wheel's face along its
    // +Z, where a rising rotation.z turns clockwise too. The spokes need not be under the
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
    if (this.part === 'button' || this.part === 'tray') return 'pointer';
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

    let chute = 0;
    if (this.chuteT >= 0) {
      this.chuteT += dt;
      chute = (this.chuteIn ? -1.1 : 0.9) * Math.sin(Math.PI * Math.min(1, this.chuteT / CHUTE_S));
      if (this.chuteT >= CHUTE_S) this.chuteT = -1;
    }
    this.parts.chute.rotation.x = chute;
    // The chunk froze every matrix when it was placed (world/chunks.ts
    // `freezeStaticSubtree`): the moving parts write their own.
    this.parts.wheel.updateMatrix();
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
