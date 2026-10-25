/**
 * THE BOY'S THINGS, drawn (items/things.ts, game-design2.md §7.3): a low-poly model for
 * every thing in the catalogue, whole and broken, and the trailer loads on the bed.
 *
 * Built like every other carried item (render/meshbuilder.ts): unit boxes, cylinders and
 * spheres stretched by their transform, so a whole catalogue shares a handful of cached
 * geometries, on the shared flat materials (and the medicine bottle's glass for the
 * aquarium and the medal case). No new material shape, so no new shader program.
 *
 * Each model is laid out from its foot (y = 0) in metres, x across, z forward (its face:
 * the TV's screen, the radio's dial), and centred on its bounds afterwards: a loose thing's
 * collider is its bounds round the origin (parts/loose.ts), and the boot, the cabin and
 * the hand all fit the bounds. A broken one is the same thing with its own damage (a
 * cracked screen, a drained tank, snapped rods), every colour darkened.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ThingDef, ThingId } from '../items/things';
import {
  AXIS_X,
  AXIS_Z,
  MeshBuilder,
  ZERO,
  boundsOf,
  buildGroup,
  flat,
  glass,
  type MaterialSpec,
  type Vec3,
} from './meshbuilder';

// ---------------------------------------------------------------------------
// Primitives: unit shapes, one cached geometry each, sized by scale
// ---------------------------------------------------------------------------

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();

function box(b: MeshBuilder, m: MaterialSpec, size: Vec3, at: Vec3, rot: Vec3 = ZERO): void {
  b.box('thing_box', 1, 1, 1, m, at, rot, size);
}

/** A cylinder of radius `r` and height `h` along local y; `ratio` is its top radius over its bottom one. */
function cyl(b: MeshBuilder, m: MaterialSpec, r: number, h: number, at: Vec3, rot: Vec3 = ZERO, sides = 16, ratio = 1): void {
  b.push(`thing_cyl_${sides}_${ratio}`, () => new THREE.CylinderGeometry(ratio, 1, 1, sides), m, at, rot, [r, h, r]);
}

/** A rod from `from` to `to`, radius `r0` at `from` tapering to `r1`. */
function rod(b: MeshBuilder, m: MaterialSpec, from: Vec3, to: Vec3, r0: number, r1 = r0, sides = 8): void {
  _dir.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const length = _dir.length();
  _euler.setFromQuaternion(_quat.setFromUnitVectors(Y_AXIS, _dir.normalize()));
  const ratio = Math.round((r1 / r0) * 20) / 20;
  const mid: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  b.push(`thing_cyl_${sides}_${ratio}`, () => new THREE.CylinderGeometry(ratio, 1, 1, sides), m, mid, [_euler.x, _euler.y, _euler.z], [r0, length, r0]);
}

/** An ellipsoid of radii `r`. */
function ball(b: MeshBuilder, m: MaterialSpec, r: Vec3, at: Vec3, rot: Vec3 = ZERO, sides = 12): void {
  b.push(`thing_ball_${sides}`, () => new THREE.SphereGeometry(1, sides, Math.ceil(sides * 0.75)), m, at, rot, r);
}

function ring(b: MeshBuilder, m: MaterialSpec, radius: number, tube: number, at: Vec3, rot: Vec3 = ZERO, arc = Math.PI * 2): void {
  b.push(`thing_ring_${radius}_${tube}_${arc.toFixed(3)}`, () => new THREE.TorusGeometry(radius, tube, 6, Math.max(6, Math.round(arc * 4)), arc), m, at, rot);
}

/** A box with rounded edges: cushions and upholstery. */
function soft(b: MeshBuilder, m: MaterialSpec, size: Vec3, radius: number, at: Vec3, rot: Vec3 = ZERO, squash: Vec3 = [1, 1, 1]): void {
  b.push(`thing_soft_${size.join('_')}_${radius}`, () => new RoundedBoxGeometry(size[0], size[1], size[2], 2, radius), m, at, rot, squash);
}

/** A disc cut in half across its diameter (a snapped record, a cracked saucer). */
function halfDisc(b: MeshBuilder, m: MaterialSpec, r: number, h: number, at: Vec3, rot: Vec3, sides = 16): void {
  b.push(`thing_halfdisc_${sides}`, () => new THREE.CylinderGeometry(1, 1, 1, sides, 1, false, 0, Math.PI), m, at, rot, [r, h, r]);
}

/** Where `offset` from a hinge at `pivot` lands once the hinge turns `angle` about x. */
function hinged(pivot: Vec3, angle: number, offset: Vec3): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [pivot[0] + offset[0], pivot[1] + offset[1] * c - offset[2] * s, pivot[2] + offset[1] * s + offset[2] * c];
}

/** A small deterministic scatter: the same broken thing always lies the same way. */
function scatter(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// Shared colours
// ---------------------------------------------------------------------------

const BRASS = flat(0xb08d3c, 0.45);
const CHROME = flat(0xbfc2c4, 0.3);
const BLACK = flat(0x161514, 0.5);
const PAPER = flat(0xe9e0cb, 0.86);
const CRACK = flat(0x0b0908, 0.98);
const STRAP = flat(0xc9781c, 0.8);

/** Slope of each leg of a crack's zig-zag, radians. */
const CRACK_SLOPE = 0.6;

/**
 * A black crack zig-zagging across the thing's front (+z) and/or its top: what a box-like
 * thing shows when its own damage is a split. Its legs are sized to the face.
 */
function crack(b: MeshBuilder, front: boolean, top: boolean): void {
  const bounds = boundsOf(b.instructions);
  const size = bounds.getSize(new THREE.Vector3());
  const c = bounds.getCenter(new THREE.Vector3());
  const width = 0.008;
  for (const onTop of [false, true]) {
    if (onTop ? !top : !front) continue;
    const leg = Math.min(size.x, onTop ? size.z : size.y) * 0.4;
    const run = leg * Math.cos(CRACK_SLOPE);
    const legs = Math.max(2, Math.min(8, Math.floor((size.x * 0.7) / run)));
    for (let i = 0; i < legs; i++) {
      const x = c.x + run * (i + 0.5 - legs / 2);
      const slope = i % 2 === 0 ? CRACK_SLOPE : -CRACK_SLOPE;
      if (onTop) box(b, CRACK, [leg, 0.004, width], [x, bounds.max.y + 0.002, c.z], [0, slope, 0]);
      else box(b, CRACK, [leg, width, 0.004], [x, c.y, bounds.max.z + 0.002], [0, 0, slope]);
    }
  }
}

// ---------------------------------------------------------------------------
// The things
// ---------------------------------------------------------------------------

type Model = (b: MeshBuilder, broken: boolean) => void;

const PENCIL_COLOURS = [0xb3262a, 0xd9762a, 0xe0c03a, 0x3f8a3a, 0x2f5fa8, 0x6a3a8a, 0x2a2624, 0x7a4a26];

/** A tin of coloured pencils, lid off: two layers of pencils, sharpened ends to the right. */
function pencils(b: MeshBuilder, broken: boolean): void {
  const tin = flat(0x2c4a7a, 0.5);
  const wood = flat(0xe0c08a, 0.8);
  box(b, tin, [0.24, 0.012, 0.18], [0, 0.006, 0]);
  box(b, tin, [0.24, 0.03, 0.006], [0, 0.027, -0.087]);
  // A dropped tin's front wall is bent out.
  box(b, tin, [0.24, 0.03, 0.006], broken ? [0, 0.024, 0.094] : [0, 0.027, 0.087], broken ? [0.45, 0, 0] : ZERO);
  for (const x of [-0.117, 0.117]) box(b, tin, [0.006, 0.03, 0.168], [x, 0.027, 0]);
  box(b, flat(0xe8d27a, 0.7), [0.12, 0.016, 0.002], broken ? [0, 0.025, 0.1] : [0, 0.027, 0.0905], broken ? [0.45, 0, 0] : ZERO);
  for (let i = 0; i < 12; i++) {
    const upper = i >= 8;
    const z = upper ? -0.06 + (i - 8) * 0.04 : -0.07 + i * 0.02;
    const y = upper ? 0.026 : 0.017;
    const colour = flat(PENCIL_COLOURS[i % PENCIL_COLOURS.length]!, 0.55);
    if (broken) {
      // Snapped in two, the halves knocked askew.
      const a = (scatter(i, 1) - 0.5) * 0.5;
      cyl(b, colour, 0.0045, 0.085, [-0.055, y, z], [0, a, -Math.PI / 2], 6);
      cyl(b, colour, 0.0045, 0.075, [0.045, y + 0.004, z + (scatter(i, 2) - 0.5) * 0.02], [0, -a, -Math.PI / 2 + 0.15], 6);
      continue;
    }
    cyl(b, colour, 0.0045, 0.17, [-0.01, y, z], AXIS_X, 6);
    cyl(b, wood, 0.0045, 0.018, [0.084, y, z], AXIS_X, 6, 0.35);
    cyl(b, colour, 0.0016, 0.006, [0.096, y, z], AXIS_X, 6, 0);
  }
}

/** A school globe on a wooden foot, tilted on a brass half-meridian. */
function globe(b: MeshBuilder, broken: boolean): void {
  const wood = flat(0x5a3a22, 0.7);
  const tilt = 0.41;
  const r = 0.13;
  const arm = 0.145;
  cyl(b, wood, 0.09, 0.025, [0, 0.0125, 0], ZERO, 20);
  cyl(b, BRASS, 0.012, 0.05, [0, 0.05, 0], ZERO, 10);
  // The meridian's foot sits on the stem, so its centre (and the ball's) leans off it.
  const centre: Vec3 = [-arm * Math.sin(tilt), 0.075 + arm * Math.cos(tilt), 0];
  // A broken globe has come off its axis and lies against the foot; its meridian is bent.
  const ballAt: Vec3 = broken ? [0.19, r, 0.05] : centre;
  const ballTilt: Vec3 = broken ? [0.6, 0.3, 1.9] : [0, 0, tilt];
  ring(b, BRASS, arm, 0.006, centre, [0, 0, Math.PI / 2 + tilt + (broken ? 0.55 : 0)], Math.PI);
  if (!broken) rod(b, BRASS, [centre[0] - 0.15 * Math.sin(-tilt), centre[1] - 0.15 * Math.cos(tilt), 0], [centre[0] + 0.15 * Math.sin(-tilt), centre[1] + 0.15 * Math.cos(tilt), 0], 0.004);
  ball(b, flat(0x3f6f9c, 0.55), [r, r, r], ballAt, ballTilt, 24);
  // Land: patches of a sphere a hair larger than the sea, turned with it.
  const land = flat(0x6f8f4a, 0.7);
  const sand = flat(0xc2a66a, 0.75);
  const patches: readonly (readonly [number, number, number, number, MaterialSpec])[] = [
    [0.1, 1.8, 0.45, 0.4, land],
    [0.3, 0.7, 1.2, 0.8, sand],
    [3.5, 0.8, 0.45, 0.5, land],
    [3.9, 0.5, 1.35, 0.75, sand],
    [1.9, 0.5, 1.9, 0.35, land],
    [0, Math.PI * 2, 0, 0.22, flat(0xe8eef0, 0.6)],
  ];
  patches.forEach(([phi, phiLength, theta, thetaLength, m], i) => {
    b.push(`thing_globe_land_${i}`, () => new THREE.SphereGeometry(r * 1.012, 10, 6, phi, phiLength, theta, thetaLength), m, ballAt, ballTilt);
  });
  if (broken) ball(b, CRACK, [0.035, 0.035, 0.035], [ballAt[0] + 0.1, ballAt[1] + 0.06, ballAt[2] + 0.04], ZERO, 8);
}

/** Two sofa cushions, one on the other turned a little, a button and corner tassels on top. */
function cushions(b: MeshBuilder, broken: boolean): void {
  const mustard = flat(0xb98d2f, 0.95);
  const brick = flat(0x8e3a2c, 0.95);
  const tassel = flat(0xe0c060, 0.8);
  soft(b, mustard, [0.4, 0.1, 0.38], 0.04, [0, 0.05, 0]);
  if (broken) {
    // The top one split along its seam and slid off, its stuffing out.
    soft(b, brick, [0.4, 0.1, 0.38], 0.04, [0.06, 0.12, 0.03], [0.05, 0.3, 0.22], [1, 0.75, 1]);
    const stuffing = flat(0xe9e4d8, 0.98);
    for (let i = 0; i < 7; i++) {
      ball(b, stuffing, [0.035 + scatter(i, 3) * 0.02, 0.025, 0.03], [0.2 + scatter(i, 4) * 0.06, 0.09 + scatter(i, 5) * 0.06, -0.12 + i * 0.04], ZERO, 8);
    }
    return;
  }
  soft(b, brick, [0.4, 0.1, 0.38], 0.04, [0, 0.152, 0], [0, 0.18, 0]);
  ball(b, mustard, [0.012, 0.006, 0.012], [0, 0.203, 0], ZERO, 8);
  const c = Math.cos(0.18);
  const s = Math.sin(0.18);
  for (const [x, z] of [[0.19, 0.18], [-0.19, 0.18], [0.19, -0.18], [-0.19, -0.18]] as const) {
    ball(b, tassel, [0.014, 0.014, 0.014], [x * c + z * s, 0.15, -x * s + z * c], ZERO, 8);
  }
}

/** A table lamp: a brass foot and stem under a milk-glass shade, drawn opaque. */
function tableLamp(b: MeshBuilder, broken: boolean): void {
  const shade = flat(0xf1e8d4, 0.35);
  cyl(b, BRASS, 0.09, 0.03, [0, 0.015, 0], ZERO, 20, 0.89);
  if (!broken) {
    cyl(b, BRASS, 0.012, 0.22, [0, 0.14, 0], ZERO, 10);
    cyl(b, shade, 0.13, 0.15, [0, 0.29, 0], ZERO, 20, 0.54);
    ball(b, BRASS, [0.016, 0.016, 0.016], [0, 0.375, 0], ZERO, 10);
    return;
  }
  // Knocked over: the stem bent halfway, the shade off on its side and a piece out of it.
  rod(b, BRASS, [0, 0.03, 0], [0, 0.14, 0], 0.012);
  rod(b, BRASS, [0, 0.14, 0], [0.07, 0.22, 0.02], 0.012);
  cyl(b, shade, 0.13, 0.15, [0.2, 0.13, 0.04], [0.3, 0, 1.45], 20, 0.54);
  for (let i = 0; i < 3; i++) {
    box(b, shade, [0.05 - i * 0.01, 0.004, 0.03], [-0.08 - i * 0.04, 0.003, 0.09 - i * 0.05], [0, scatter(i, 6) * 3, 0]);
  }
}

/** A tea service on a wooden tray: a teapot with a blue band and four cups on saucers. */
function teaService(b: MeshBuilder, broken: boolean): void {
  const wood = flat(0x8a5a32, 0.7);
  const china = flat(0xf1ede2, 0.3);
  const blue = flat(0x2f4f9a, 0.4);
  const tea = flat(0x5a3015, 0.2);
  box(b, wood, [0.5, 0.012, 0.34], [0, 0.006, 0]);
  for (const z of [-0.165, 0.165]) box(b, wood, [0.5, 0.02, 0.01], [0, 0.022, z]);
  for (const x of [-0.245, 0.245]) box(b, wood, [0.01, 0.02, 0.33], [x, 0.022, 0]);
  // Teapot.
  const px = -0.12;
  ball(b, china, [0.075, 0.064, 0.075], [px, 0.076, 0], ZERO, 16);
  ring(b, blue, 0.072, 0.004, [px, 0.08, 0], [Math.PI / 2, 0, 0]);
  ring(b, china, 0.035, 0.007, [px - 0.08, 0.085, 0], ZERO);
  if (!broken) {
    cyl(b, china, 0.035, 0.015, [px, 0.145, 0], ZERO, 14);
    ball(b, china, [0.01, 0.01, 0.01], [px, 0.158, 0], ZERO, 8);
    rod(b, china, [px + 0.06, 0.07, 0], [px + 0.12, 0.13, 0], 0.014, 0.008);
  } else {
    // Lid off on the tray, spout snapped off beside it.
    cyl(b, china, 0.035, 0.015, [px + 0.02, 0.022, 0.12], [0.4, 0, 0.2], 14);
    rod(b, china, [px + 0.02, 0.02, -0.12], [px + 0.08, 0.024, -0.1], 0.012, 0.008);
  }
  const cups: readonly (readonly [number, number])[] = [[0.06, -0.08], [0.18, -0.08], [0.06, 0.08], [0.18, 0.08]];
  cups.forEach(([x, z], i) => {
    const toppled = broken && i % 2 === 1;
    if (broken && i === 2) {
      // A saucer in two halves.
      halfDisc(b, china, 0.045, 0.006, [x - 0.005, 0.015, z], [0, 0.2, 0]);
      halfDisc(b, china, 0.045, 0.006, [x + 0.012, 0.016, z + 0.006], [0.1, 0.2 + Math.PI, 0]);
    } else {
      cyl(b, china, 0.045, 0.006, [x, 0.015, z], ZERO, 18);
    }
    if (toppled) {
      cyl(b, china, 0.032, 0.045, [x + 0.01, 0.045, z], [0, 0.6 * i, Math.PI / 2], 14, 0.69);
      return;
    }
    cyl(b, china, 0.032, 0.045, [x, 0.04, z], ZERO, 14, 0.69);
    ring(b, blue, 0.032, 0.0025, [x, 0.0625, z], [Math.PI / 2, 0, 0]);
    cyl(b, tea, 0.029, 0.002, [x, 0.0626, z], ZERO, 14);
    ring(b, china, 0.014, 0.004, [x + 0.033, 0.042, z], ZERO);
  });
  if (broken) {
    for (let i = 0; i < 8; i++) {
      box(b, china, [0.012 + scatter(i, 7) * 0.02, 0.003, 0.01 + scatter(i, 8) * 0.012], [-0.05 + scatter(i, 9) * 0.28, 0.0135, -0.14 + scatter(i, 10) * 0.28], [0, scatter(i, 11) * 3, 0]);
    }
  }
}

/** A portable record player in a maroon case: a record on the platter, the tone arm on it. */
function recordPlayer(b: MeshBuilder, broken: boolean): void {
  const leatherette = flat(0x6e2a22, 0.85);
  const deck = flat(0xc9c4b8, 0.5);
  box(b, leatherette, [0.46, 0.1, 0.36], [0, 0.05, 0]);
  box(b, deck, [0.44, 0.008, 0.34], [0, 0.104, 0]);
  box(b, flat(0x3a3430, 0.9), [0.38, 0.06, 0.004], [0, 0.05, 0.181]);
  for (const z of [0.08, 0.13]) cyl(b, BLACK, 0.015, 0.015, [0.17, 0.115, z], ZERO, 12);
  const px = -0.06;
  cyl(b, flat(0x2a2a2a, 0.5), 0.135, 0.012, [px, 0.114, 0], ZERO, 32);
  const vinyl = flat(0x111111, 0.25);
  const label = flat(0xb02a2a, 0.6);
  const pivot: Vec3 = [0.15, 0.123, -0.11];
  cyl(b, CHROME, 0.015, 0.03, pivot, ZERO, 12);
  if (!broken) {
    cyl(b, vinyl, 0.13, 0.004, [px, 0.122, 0], ZERO, 32);
    cyl(b, label, 0.04, 0.005, [px, 0.1225, 0], ZERO, 16);
    cyl(b, CHROME, 0.004, 0.02, [px, 0.13, 0], ZERO, 8);
    const a = -0.35;
    const dir: Vec3 = [Math.sin(a), 0, Math.cos(a)];
    rod(b, CHROME, [pivot[0], 0.14, pivot[2]], [pivot[0] + dir[0] * 0.2, 0.135, pivot[2] + dir[2] * 0.2], 0.004);
    box(b, BLACK, [0.02, 0.012, 0.03], [pivot[0] + dir[0] * 0.2, 0.132, pivot[2] + dir[2] * 0.2], [0, a, 0]);
    return;
  }
  // The record snapped in two, one half fallen against the case; the tone arm torn off.
  halfDisc(b, vinyl, 0.13, 0.004, [px, 0.122, 0], ZERO, 24);
  halfDisc(b, label, 0.04, 0.005, [px, 0.1225, 0], ZERO, 12);
  halfDisc(b, vinyl, 0.13, 0.004, [px - 0.03, 0.13, 0.15], [1.1, Math.PI, 0], 24);
  rod(b, CHROME, [pivot[0], 0.14, pivot[2]], [0.21, 0.07, 0.2], 0.004);
  box(b, BLACK, [0.02, 0.012, 0.03], [0.2, 0.06, 0.205], [0.4, 0.3, 0.9]);
  crack(b, false, true);
}

/** Dad's tool box: red enamelled steel, a raised lid with a handle, two latches and a name plate. */
function toolBox(b: MeshBuilder, broken: boolean): void {
  const red = flat(0x8f2a1e, 0.55);
  const lid = flat(0xa33325, 0.55);
  const steel = flat(0x9a9a9a, 0.4);
  box(b, red, [0.46, 0.16, 0.2], [0, 0.08, 0]);
  box(b, flat(0xd9c8a5, 0.9), [0.1, 0.03, 0.002], [0, 0.09, 0.101]);
  if (!broken) {
    box(b, lid, [0.47, 0.05, 0.21], [0, 0.185, 0]);
    box(b, lid, [0.43, 0.02, 0.15], [0, 0.22, 0]);
    for (const x of [-0.1, 0.1]) box(b, steel, [0.012, 0.05, 0.012], [x, 0.245, 0]);
    cyl(b, BLACK, 0.012, 0.21, [0, 0.27, 0], AXIS_X, 10);
    for (const x of [-0.17, 0.17]) box(b, steel, [0.03, 0.04, 0.008], [x, 0.16, 0.105]);
    return;
  }
  // The lid sprung back on its hinge, the handle off, the tools out on the ground.
  box(b, flat(0x2a1a14, 0.95), [0.44, 0.005, 0.18], [0, 0.155, 0]);
  const hinge: Vec3 = [0, 0.16, -0.105];
  const angle = -1.95;
  box(b, lid, [0.47, 0.05, 0.21], hinged(hinge, angle, [0, 0.025, 0.105]), [angle, 0, 0]);
  box(b, lid, [0.43, 0.02, 0.15], hinged(hinge, angle, [0, 0.06, 0.105]), [angle, 0, 0]);
  for (const x of [-0.17, 0.17]) box(b, steel, [0.03, 0.04, 0.008], [x, 0.14, 0.105], [0.5, 0, 0]);
  cyl(b, BLACK, 0.012, 0.21, [0.05, 0.012, 0.16], [0, 0.4, -Math.PI / 2], 10);
  box(b, steel, [0.16, 0.012, 0.025], [-0.12, 0.006, 0.17], [0, -0.3, 0]);
  ring(b, steel, 0.018, 0.006, [-0.2, 0.006, 0.19], [Math.PI / 2, 0, 0]);
  cyl(b, flat(0xd8b02a, 0.6), 0.012, 0.09, [0.17, 0.012, 0.15], [0, 0.9, -Math.PI / 2], 8);
  rod(b, steel, [0.13, 0.012, 0.18], [0.07, 0.012, 0.23], 0.003);
}

/** Three fishing rods in a bundle, cork butts to the left, a reel on the middle one, tied twice. */
function fishingRods(b: MeshBuilder, broken: boolean): void {
  const cork = flat(0xc8a070, 0.9);
  const blanks = [flat(0x2c3e2a, 0.4), flat(0x5a2a20, 0.4), flat(0x22303e, 0.4)];
  const rods: readonly (readonly [number, number])[] = [[0.02, -0.03], [0.02, 0.03], [0.045, 0]];
  rods.forEach(([y, z], i) => {
    rod(b, cork, [-0.64, y, z], [-0.36, y, z], 0.013, 0.011);
    cyl(b, BLACK, 0.014, 0.015, [-0.645, y, z], AXIS_X, 8);
    const blank = blanks[i]!;
    if (!broken) {
      rod(b, blank, [-0.36, y, z], [0.64, y, z], 0.009, 0.0027);
      for (const x of [0.0, 0.3, 0.55]) ring(b, CHROME, 0.006, 0.0012, [x, y + 0.009, z], [0, Math.PI / 2, 0]);
      return;
    }
    // Snapped about halfway, the tip hanging off at an angle.
    const breakX = 0.12 - i * 0.08;
    rod(b, blank, [-0.36, y, z], [breakX, y, z], 0.009, 0.006);
    const droop = -0.25 - i * 0.1;
    const yaw = (i - 1) * 0.35;
    const length = 0.62 - breakX;
    const to: Vec3 = [breakX + Math.cos(droop) * Math.cos(yaw) * length, y + Math.sin(droop) * length * 0.5, z - Math.cos(droop) * Math.sin(yaw) * length];
    rod(b, blank, [breakX + 0.01, y, z], to, 0.006, 0.0027);
  });
  // The reel hangs under the middle rod.
  box(b, CHROME, [0.03, 0.012, 0.008], [-0.42, 0.005, 0.03]);
  cyl(b, flat(0x4a4f52, 0.4), 0.03, 0.02, [-0.42, -0.025, 0.03], AXIS_Z, 14);
  for (const x of [-0.2, 0.35]) {
    if (broken && x > 0) continue;
    box(b, flat(0xd9c8a5, 0.9), [0.02, 0.05, 0.09], [x, 0.028, 0]);
  }
}

/** A child's sledge: slatted wooden seat on bent steel runners curling up at the front, a rope. */
function sledge(b: MeshBuilder, broken: boolean): void {
  const steel = flat(0x5a5f63, 0.4);
  const slat = flat(0xc08a4a, 0.8);
  const rail = flat(0x9c6a38, 0.8);
  const rope = flat(0xb8a27a, 0.95);
  for (const z of [-0.16, 0.16]) {
    if (broken && z < 0) {
      // This runner snapped behind its front leg: the front half bent down and out.
      box(b, steel, [0.45, 0.02, 0.02], [-0.215, 0.01, z]);
      box(b, steel, [0.4, 0.02, 0.02], [0.23, 0.04, z - 0.05], [0, 0.35, 0.18]);
      continue;
    }
    box(b, steel, [0.86, 0.02, 0.02], [-0.02, 0.01, z]);
    ring(b, steel, 0.06, 0.01, [0.41, 0.07, z], [0, 0, -Math.PI / 2], Math.PI / 2);
    rod(b, steel, [0.47, 0.07, z], [0.4, 0.14, z], 0.01);
  }
  for (const x of [-0.3, 0.25]) {
    for (const z of [-0.16, 0.16]) {
      if (broken && x > 0 && z < 0) continue;
      box(b, steel, [0.02, 0.11, 0.02], [x, 0.065, z]);
    }
  }
  for (const z of [-0.15, 0.15]) box(b, rail, [0.86, 0.025, 0.03], [-0.02, 0.125, z]);
  for (let i = 0; i < 7; i++) {
    const x = -0.4 + i * 0.12;
    if (broken && (i === 2 || i === 5)) continue;
    if (broken && i === 4) {
      box(b, slat, [0.06, 0.02, 0.38], [x + 0.03, 0.16, 0.04], [0.15, 0.45, 0.2]);
      continue;
    }
    box(b, slat, [0.06, 0.02, 0.38], [x, 0.147, 0]);
  }
  if (!broken) {
    for (const z of [-0.12, 0.12]) rod(b, rope, [0.47, 0.1, z], [0.52, 0.07, 0], 0.006);
  }
}

/** A rug rolled up and tied: a red roll across x, its rolled ends darker, two string ties. */
function carpet(b: MeshBuilder, broken: boolean): void {
  const pile = flat(0x8c2b24, 0.95);
  const end = flat(0x5a1d19, 0.95);
  const tie = flat(0xd9c8a5, 0.9);
  if (!broken) {
    cyl(b, pile, 0.1, 0.84, [0, 0.1, 0], AXIS_X, 14);
    cyl(b, end, 0.094, 0.844, [0, 0.1, 0], AXIS_X, 14);
    for (const x of [-0.26, 0.26]) cyl(b, tie, 0.104, 0.018, [x, 0.1, 0], AXIS_X, 14);
    return;
  }
  // A tie gone, half of it unrolled, frayed and stained.
  cyl(b, pile, 0.075, 0.84, [0, 0.075, -0.25], AXIS_X, 14);
  cyl(b, end, 0.07, 0.844, [0, 0.075, -0.25], AXIS_X, 14);
  cyl(b, tie, 0.079, 0.018, [-0.26, 0.075, -0.25], AXIS_X, 14);
  box(b, pile, [0.84, 0.012, 0.5], [0, 0.006, 0.0]);
  box(b, flat(0x3a1210, 0.98), [0.22, 0.013, 0.16], [0.18, 0.006, 0.04], [0, 0.5, 0]);
  for (let i = 0; i < 14; i++) box(b, tie, [0.012, 0.004, 0.04 + scatter(i, 12) * 0.02], [-0.4 + i * 0.062, 0.003, 0.27]);
}

/** An old valve TV: a wooden cabinet on short legs, a bulging screen in a cream surround, controls right. */
function tvSet(b: MeshBuilder, broken: boolean): void {
  const wood = flat(0x5e3f26, 0.7);
  const dark = flat(0x3a2a1c, 0.8);
  const knob = flat(0x1e1e1e, 0.5);
  box(b, wood, [0.56, 0.42, 0.4], [0, 0.25, 0.02]);
  box(b, dark, [0.34, 0.28, 0.05], [0, 0.25, -0.205]);
  for (const x of [-0.24, 0.24]) {
    for (const z of [-0.15, 0.18]) {
      if (broken && x > 0 && z > 0) continue;
      cyl(b, dark, 0.015, 0.04, [x, 0.02, z], ZERO, 8, 1.4);
    }
  }
  box(b, flat(0xc9c0ae, 0.6), [0.38, 0.31, 0.012], [-0.07, 0.27, 0.222]);
  box(b, flat(0x3b2f26, 0.95), [0.1, 0.18, 0.008], [0.2, 0.3, 0.223]);
  for (let i = 0; i < 4; i++) box(b, wood, [0.1, 0.008, 0.004], [0.2, 0.23 + i * 0.045, 0.228]);
  const knobs: readonly (readonly [number, number])[] = [[0.2, 0.16], [0.2, 0.1]];
  knobs.forEach(([x, y], i) => {
    if (broken && i === 1) return;
    cyl(b, knob, i === 0 ? 0.028 : 0.02, 0.02, [x, y, 0.235], AXIS_Z, 14);
    box(b, PAPER, [0.003, 0.012, 0.002], [x, y + 0.008, 0.246]);
  });
  if (!broken) {
    box(b, flat(0x33403c, 0.25), [0.33, 0.26, 0.02], [-0.07, 0.27, 0.225]);
    ball(b, flat(0x33403c, 0.25), [0.165, 0.13, 0.016], [-0.07, 0.27, 0.234], ZERO, 16);
    return;
  }
  // The screen stove in: black glass, a hole, cracks running out from it.
  box(b, flat(0x0c0e0e, 0.2), [0.33, 0.26, 0.02], [-0.07, 0.27, 0.225]);
  const hit: Vec3 = [-0.12, 0.3, 0.2365];
  cyl(b, CRACK, 0.03, 0.003, hit, AXIS_Z, 9);
  const pale = flat(0xd8e0e0, 0.3);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + scatter(i, 13) * 0.5;
    const length = 0.05 + scatter(i, 14) * 0.07;
    const reach = 0.03 + length / 2;
    box(b, pale, [length, 0.003, 0.002], [hit[0] + Math.cos(a) * reach, hit[1] + Math.sin(a) * reach, hit[2] + 0.001], [0, 0, a]);
  }
  crack(b, false, true);
}

/** An aquarium: a steel frame, glass, water, sand with pebbles, weed and two goldfish. */
function aquarium(b: MeshBuilder, broken: boolean): void {
  const frame = flat(0x2b2f2c, 0.5);
  const sand = flat(0xd2b87e, 0.95);
  const pane = glass(broken ? 0x3a4a48 : 0xbfe3e0);
  box(b, frame, [0.6, 0.03, 0.34], [0, 0.015, 0]);
  box(b, sand, [0.57, 0.04, 0.31], [0, 0.05, 0]);
  ball(b, flat(0x8a8278, 0.9), [0.025, 0.012, 0.02], [0.15, 0.07, 0.05], ZERO, 8);
  ball(b, flat(0x6f6a62, 0.9), [0.018, 0.01, 0.016], [0.19, 0.07, -0.02], ZERO, 8);
  for (const x of [-0.293, 0.293]) {
    for (const z of [-0.163, 0.163]) box(b, frame, [0.014, 0.36, 0.014], [x, 0.2, z]);
  }
  for (const z of [-0.163, 0.163]) box(b, frame, [0.6, 0.02, 0.02], [0, 0.38, z]);
  for (const x of [-0.29, 0.29]) box(b, frame, [0.02, 0.02, 0.34], [x, 0.38, 0]);
  box(b, frame, [0.6, 0.03, 0.1], [0, 0.405, -0.12]);
  box(b, pane, [0.58, 0.34, 0.006], [0, 0.2, -0.162]);
  for (const x of [-0.287, 0.287]) box(b, pane, [0.006, 0.34, 0.32], [x, 0.2, 0]);
  const weed = flat(0x3f7a3a, 0.8);
  const weeds: readonly (readonly [number, number])[] = [[-0.2, 0.15], [-0.15, -0.12], [0.22, -0.2]];
  if (!broken) {
    box(b, pane, [0.58, 0.34, 0.006], [0, 0.2, 0.162]);
    box(b, glass(0x2f8fb0), [0.57, 0.27, 0.31], [0, 0.205, 0]);
    box(b, flat(0x5fa8bf, 0.15), [0.57, 0.004, 0.31], [0, 0.34, 0]);
    for (const [x, tilt] of weeds) box(b, weed, [0.012, 0.18, 0.004], [x, 0.16, -0.08], [0, 0, tilt]);
    const fish = flat(0xe8742a, 0.5);
    for (const [x, y, z, s] of [[-0.08, 0.22, 0.03, 1], [0.12, 0.15, -0.05, -1]] as const) {
      ball(b, fish, [0.035, 0.018, 0.008], [x, y, z], ZERO, 10);
      cyl(b, fish, 0.014, 0.02, [x - s * 0.043, y, z], [0, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2], 6, 0);
      ball(b, BLACK, [0.003, 0.003, 0.003], [x + s * 0.022, y + 0.005, z + 0.007], ZERO, 6);
    }
    return;
  }
  // Drained: the front pane smashed out, its shards on the ground with spilled sand,
  // the weed collapsed on the sand.
  box(b, pane, [0.58, 0.07, 0.006], [0, 0.07, 0.162]);
  box(b, pane, [0.08, 0.18, 0.006], [-0.25, 0.17, 0.162], [0, 0, -0.35]);
  box(b, pane, [0.06, 0.14, 0.006], [0.26, 0.15, 0.162], [0, 0, 0.4]);
  for (let i = 0; i < 7; i++) {
    box(b, pane, [0.04 + scatter(i, 15) * 0.06, 0.004, 0.03 + scatter(i, 16) * 0.04], [-0.25 + scatter(i, 17) * 0.5, 0.002, 0.2 + scatter(i, 18) * 0.08], [0, scatter(i, 19) * 3, 0]);
  }
  ball(b, sand, [0.16, 0.015, 0.06], [0.05, 0.004, 0.21], ZERO, 10);
  for (const [x, tilt] of weeds) box(b, weed, [0.012, 0.18, 0.004], [x + tilt * 0.3, 0.075, -0.06], [0, 0, tilt > 0 ? 1.3 : -1.3]);
}

/** Grandpa's valve radio: a wooden cabinet, cloth grille behind wooden bars, a lit dial, two knobs. */
function grandpaRadio(b: MeshBuilder, broken: boolean): void {
  const wood = flat(0x6b4423, 0.6);
  const bar = flat(0x4e3018, 0.6);
  box(b, wood, [0.44, 0.24, 0.2], [0, 0.13, 0]);
  box(b, flat(0x5a381c, 0.6), [0.42, 0.02, 0.18], [0, 0.26, 0]);
  for (const x of [-0.17, 0.17]) box(b, bar, [0.04, 0.01, 0.16], [x, 0.005, 0]);
  box(b, flat(0xc7b48a, 0.95), [0.22, 0.15, 0.004], [-0.08, 0.15, 0.102]);
  for (const x of [-0.14, -0.08, -0.02]) {
    if (broken && x === -0.08) continue;
    box(b, bar, [0.012, 0.15, 0.006], [x, 0.15, 0.104]);
  }
  box(b, BRASS, [0.14, 0.07, 0.003], [0.12, 0.19, 0.1015]);
  box(b, flat(0xe6d9a2, 0.4), [0.13, 0.06, 0.004], [0.12, 0.19, 0.1025]);
  box(b, flat(0xb3262a, 0.6), [0.003, 0.05, 0.002], [0.1, 0.19, 0.105]);
  const knob = flat(0x2a1a10, 0.5);
  for (const x of [0.09, 0.155]) {
    const fallen = broken && x > 0.1;
    const at: Vec3 = fallen ? [0.2, 0.01, 0.16] : [x, 0.09, 0.11];
    const rot = fallen ? [0.3, 0, 0] as Vec3 : AXIS_Z;
    cyl(b, knob, 0.018, 0.02, at, rot, 12);
  }
  if (!broken) return;
  // The cloth torn through to the dark inside, the dial glass split.
  box(b, CRACK, [0.1, 0.07, 0.003], [-0.06, 0.16, 0.1045], [0, 0, 0.2]);
  box(b, flat(0xf4f0e0, 0.3), [0.12, 0.003, 0.002], [0.12, 0.19, 0.1055], [0, 0, 0.35]);
  crack(b, false, true);
}

/** A stamp album lying shut: green boards, a gilt title, a stamp on the cover, stamps peeking out. */
function stampAlbum(b: MeshBuilder, broken: boolean): void {
  const cover = flat(0x2e4f3c, 0.8);
  const gilt = flat(0xc9a24a, 0.4);
  const pages = flat(0xeee6cf, 0.9);
  const stampColours = [0xb3262a, 0x2f5fa8, 0x3f8a3a, 0xd9762a, 0x6a3a8a, 0x2a8a8a];
  box(b, cover, [0.32, 0.008, 0.24], [0, 0.004, 0]);
  box(b, flat(0x24402f, 0.8), [0.016, 0.06, 0.24], [-0.158, 0.03, 0]);
  box(b, pages, [0.305, 0.044, 0.23], [0.006, 0.03, 0], ZERO);
  for (const z of [-0.06, 0.07]) box(b, flat(stampColours[z > 0 ? 0 : 1]!, 0.7), [0.03, 0.002, 0.03], [0.16, 0.03, z], [0, 0.3, 0]);
  if (!broken) {
    box(b, cover, [0.32, 0.008, 0.24], [0, 0.056, 0]);
    for (const z of [-0.07, 0.07]) box(b, gilt, [0.2, 0.002, 0.006], [0.01, 0.0605, z]);
    box(b, gilt, [0.12, 0.002, 0.04], [0.01, 0.0605, -0.02]);
    box(b, PAPER, [0.046, 0.002, 0.056], [0.06, 0.061, 0.03]);
    box(b, flat(0xb3262a, 0.7), [0.036, 0.003, 0.046], [0.06, 0.061, 0.03]);
    return;
  }
  // The front board torn off and thrown down beside it, the stamps spilled.
  box(b, cover, [0.32, 0.008, 0.24], [0.26, 0.004, 0.1], [0, 0.5, 0.0]);
  for (let i = 0; i < 9; i++) {
    const onPages = i < 4;
    box(b, flat(stampColours[i % stampColours.length]!, 0.7), [0.03, 0.002, 0.035], onPages
      ? [-0.08 + i * 0.06, 0.0525, -0.06 + scatter(i, 20) * 0.12]
      : [-0.2 + scatter(i, 21) * 0.1, 0.001, -0.18 + scatter(i, 22) * 0.36], [0, scatter(i, 23) * 3, 0]);
  }
  box(b, CRACK, [0.003, 0.045, 0.2], [-0.149, 0.03, 0]);
}

/** Mum's music box: a lacquered box, its lid open on a mirror, a tiny dancer, a winding key. */
function musicBox(b: MeshBuilder, broken: boolean): void {
  const lacquer = flat(0x6e2430, 0.3);
  const gilt = flat(0xc9a24a, 0.4);
  const pink = flat(0xe9b2c0, 0.7);
  box(b, lacquer, [0.2, 0.07, 0.14], [0, 0.035, 0]);
  box(b, gilt, [0.204, 0.008, 0.144], [0, 0.06, 0]);
  box(b, flat(0x2a3a6a, 0.98), [0.18, 0.004, 0.12], [0, 0.0705, 0]);
  if (!broken) {
    const hinge: Vec3 = [0, 0.07, -0.07];
    const angle = -1.75;
    box(b, lacquer, [0.2, 0.012, 0.14], hinged(hinge, angle, [0, 0.006, 0.07]), [angle, 0, 0]);
    box(b, flat(0xc8d0d4, 0.1), [0.17, 0.002, 0.11], hinged(hinge, angle, [0, -0.001, 0.07]), [angle, 0, 0]);
    cyl(b, gilt, 0.012, 0.004, [0, 0.074, 0.01], ZERO, 12);
    cyl(b, pink, 0.018, 0.015, [0, 0.083, 0.01], ZERO, 10, 0.2);
    cyl(b, pink, 0.004, 0.02, [0, 0.1, 0.01], ZERO, 6);
    ball(b, flat(0xf0d8c8, 0.7), [0.006, 0.006, 0.006], [0, 0.114, 0.01], ZERO, 8);
    box(b, pink, [0.03, 0.003, 0.003], [0, 0.106, 0.01]);
    cyl(b, gilt, 0.004, 0.02, [0.11, 0.035, 0], AXIS_X, 8);
    box(b, gilt, [0.004, 0.025, 0.012], [0.12, 0.035, 0]);
    return;
  }
  // The lid torn off its hinge and lying beside it, the mirror cracked, the dancer down.
  box(b, lacquer, [0.2, 0.012, 0.14], [0.05, 0.006, 0.17], [0, 0.45, 0.06]);
  box(b, CRACK, [0.12, 0.004, 0.004], [0.05, 0.0125, 0.17], [0, 1.0, 0]);
  cyl(b, pink, 0.018, 0.015, [0.03, 0.08, 0.02], [0, 0.6, Math.PI / 2], 10, 0.2);
  cyl(b, pink, 0.004, 0.02, [0.012, 0.076, 0.02], [0, 0.6, Math.PI / 2], 6);
  ball(b, flat(0xf0d8c8, 0.7), [0.006, 0.006, 0.006], [-0.005, 0.077, 0.02], ZERO, 8);
}

/** An old rangefinder camera: black leatherette, a chrome top plate, the lens forward (+z). */
function oldCamera(b: MeshBuilder, broken: boolean): void {
  const leather = flat(0x1f1d1b, 0.9);
  box(b, leather, [0.12, 0.07, 0.05], [0, 0.035, 0]);
  for (const x of [-0.06, 0.06]) {
    cyl(b, leather, 0.025, 0.07, [x, 0.035, 0], ZERO, 12);
    cyl(b, CHROME, 0.025, 0.02, [x, 0.08, 0], ZERO, 12);
  }
  box(b, CHROME, [0.12, 0.02, 0.05], [0, 0.08, 0], broken ? [0, 0, 0.08] : ZERO);
  for (const x of [-0.045, 0.045]) box(b, flat(0x5a6a70, 0.2), [0.014, 0.01, 0.002], [x, 0.08, 0.026]);
  cyl(b, CHROME, 0.005, 0.008, [0.05, 0.094, 0], ZERO, 8);
  cyl(b, CHROME, 0.01, 0.008, [-0.05, 0.094, 0], ZERO, 10);
  cyl(b, CHROME, 0.012, 0.006, [0.025, 0.093, -0.008], ZERO, 10);
  for (const x of [-0.087, 0.087]) ring(b, CHROME, 0.006, 0.0015, [x, 0.065, 0], [0, Math.PI / 2, 0]);
  const lensGlass = flat(0x203746, 0.1);
  if (!broken) {
    cyl(b, CHROME, 0.022, 0.03, [0, 0.04, 0.04], AXIS_Z, 16);
    cyl(b, BLACK, 0.018, 0.02, [0, 0.04, 0.065], AXIS_Z, 16);
    cyl(b, lensGlass, 0.014, 0.002, [0, 0.04, 0.076], AXIS_Z, 16);
    return;
  }
  // The lens knocked out of its mount and lying in front, its glass starred.
  cyl(b, CRACK, 0.016, 0.003, [0, 0.04, 0.026], AXIS_Z, 12);
  cyl(b, CHROME, 0.022, 0.03, [0.04, 0.022, 0.1], [0, 0.7, Math.PI / 2], 16);
  cyl(b, BLACK, 0.018, 0.02, [0.04 + Math.cos(0.7) * 0.025, 0.018, 0.1 - Math.sin(0.7) * 0.025], [0, 0.7, Math.PI / 2], 16);
  box(b, flat(0xe0e8f0, 0.3), [0.003, 0.02, 0.002], [0.04, 0.04, 0.1], [0, 0.7, 0.6]);
}

/** A folding chess board shut, squares on its lid, a brass clasp, a king and a pawn stood on top. */
function chessSet(b: MeshBuilder, broken: boolean): void {
  const light = flat(0xd8b77a, 0.6);
  const dark = flat(0x5a3518, 0.6);
  const white = flat(0xefe6d2, 0.5);
  const black = flat(0x1e1814, 0.5);
  box(b, light, [0.4, 0.025, 0.2], [0, 0.0125, 0]);
  const hinge: Vec3 = [0, 0.025, -0.1];
  const angle = broken ? -0.55 : 0;
  box(b, light, [0.4, 0.025, 0.2], hinged(hinge, angle, [0, 0.0125, 0.1]), [angle, 0, 0]);
  box(b, dark, [0.402, 0.003, 0.202], [0, 0.025, 0]);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 0) continue;
      box(b, dark, [0.05, 0.002, 0.05], hinged(hinge, angle, [-0.175 + col * 0.05, 0.026, 0.025 + row * 0.05]), [angle, 0, 0]);
    }
  }
  for (const x of [-0.12, 0.12]) box(b, BRASS, [0.03, 0.02, 0.006], [x, 0.025, -0.103]);
  box(b, BRASS, [0.03, 0.02, 0.006], [0, 0.025, 0.103], broken ? [0, 0, 0.5] : ZERO);
  if (!broken) {
    cyl(b, white, 0.012, 0.006, [0.08, 0.054, 0], ZERO, 12);
    cyl(b, white, 0.009, 0.02, [0.08, 0.067, 0], ZERO, 12, 0.45);
    ball(b, white, [0.007, 0.007, 0.007], [0.08, 0.081, 0], ZERO, 8);
    cyl(b, black, 0.014, 0.006, [-0.08, 0.054, 0], ZERO, 12);
    cyl(b, black, 0.011, 0.035, [-0.08, 0.075, 0], ZERO, 12, 0.45);
    ball(b, black, [0.009, 0.007, 0.009], [-0.08, 0.095, 0], ZERO, 8);
    box(b, black, [0.004, 0.018, 0.004], [-0.08, 0.106, 0]);
    box(b, black, [0.012, 0.004, 0.004], [-0.08, 0.108, 0]);
    return;
  }
  // Burst open in the fall, the men spilled round it on their sides.
  for (let i = 0; i < 9; i++) {
    const a = scatter(i, 24) * Math.PI * 2;
    const d = 0.16 + scatter(i, 25) * 0.08;
    cyl(b, i % 2 === 0 ? white : black, 0.009, 0.034, [Math.cos(a) * d, 0.009, Math.sin(a) * d * 0.7 + 0.04], [0, a, Math.PI / 2], 10, 0.45);
  }
}

/** A model plane: a silver fuselage nose to +x, red tips and fin, a propeller, wheels, red roundels. */
function modelPlane(b: MeshBuilder, broken: boolean): void {
  const silver = flat(0xbfc3c6, 0.35);
  const red = flat(0xb3262a, 0.5);
  const prop = flat(0x5a3a22, 0.6);
  rod(b, silver, [-0.27, 0.07, 0], [0.22, 0.07, 0], 0.012, 0.03, 12);
  cyl(b, flat(0x3a3a3a, 0.5), 0.032, 0.04, [0.24, 0.07, 0], AXIS_X, 14);
  cyl(b, red, 0.015, 0.03, [0.275, 0.07, 0], AXIS_X, 10, 0);
  box(b, prop, [0.004, broken ? 0.08 : 0.16, 0.012], [0.262, broken ? 0.11 : 0.07, 0], [0.3, 0, 0]);
  ball(b, flat(0x5a7a90, 0.15), [0.04, 0.02, 0.018], [0.08, 0.1, 0]);
  box(b, silver, [0.07, 0.006, 0.18], [-0.24, 0.075, 0]);
  box(b, red, [0.07, 0.07, 0.006], [-0.25, 0.11, 0], broken ? [0.5, 0, 0] : ZERO);
  for (const z of [-0.06, 0.06]) {
    rod(b, BLACK, [0.08, 0.055, z], [0.08, 0.015, z * 1.2], 0.003);
    cyl(b, BLACK, 0.015, 0.01, [0.08, 0.015, z * 1.25], AXIS_Z, 12);
  }
  const wing = (side: number, at: Vec3, rot: Vec3): void => {
    // A half wing from the root at `at` outward along ±z, a red tip and roundel on it.
    const c = Math.cos(rot[1]);
    const s = Math.sin(rot[1]);
    const along = (d: number): Vec3 => [at[0] + side * d * s, at[1], at[2] + side * d * c];
    box(b, silver, [0.13, 0.008, 0.25], along(0.125), rot);
    box(b, red, [0.13, 0.009, 0.04], along(0.23), rot);
    cyl(b, red, 0.025, 0.002, [along(0.15)[0], at[1] + 0.005, along(0.15)[2]], ZERO, 14);
  };
  wing(-1, [0.05, 0.06, 0], ZERO);
  // A broken plane's right wing is snapped at the root and lies on the ground beside it.
  if (broken) wing(1, [-0.02, 0.004, 0.06], [0, 0.6, 0]);
  else wing(1, [0.05, 0.06, 0], ZERO);
}

/** Grandpa's medals in a glazed case on red velvet: two medals on their ribbons and a red star. */
function grandpaMedals(b: MeshBuilder, broken: boolean): void {
  const wood = flat(0x3d2416, 0.6);
  const velvet = flat(0x7a1a24, 0.98);
  const gold = flat(0xc9a24a, 0.35);
  const silver = flat(0xc0c4c6, 0.3);
  const enamel = flat(0xa01818, 0.35);
  box(b, wood, [0.26, 0.03, 0.2], [0, 0.015, 0]);
  box(b, velvet, [0.23, 0.004, 0.17], [0, 0.031, 0]);
  for (const z of [-0.096, 0.096]) box(b, wood, [0.26, 0.02, 0.008], [0, 0.04, z]);
  for (const x of [-0.126, 0.126]) box(b, wood, [0.008, 0.02, 0.2], [x, 0.04, 0]);
  const medal = (at: Vec3, ribbon: number, stripe: number, metal: MaterialSpec, rot: Vec3): void => {
    // Ribbon block towards the back (−z), the disc under it.
    const c = Math.cos(rot[1]);
    const s = Math.sin(rot[1]);
    const off = (dz: number): Vec3 => [at[0] + dz * s, at[1], at[2] + dz * c];
    box(b, flat(ribbon, 0.9), [0.03, 0.003, 0.035], off(-0.03), rot);
    box(b, flat(stripe, 0.9), [0.008, 0.0035, 0.035], off(-0.03), rot);
    cyl(b, metal, 0.016, 0.004, off(0.012), rot, 16);
  };
  medal([-0.07, 0.034, 0.0], 0xd8801c, 0x1a1a1a, gold, ZERO);
  // The red star in the middle: five arms round a silver boss.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    box(b, enamel, [0.009, 0.003, 0.022], [Math.sin(a) * 0.011, 0.035, Math.cos(a) * 0.011], [0, a, 0]);
  }
  cyl(b, silver, 0.008, 0.005, [0, 0.036, 0], ZERO, 12);
  if (!broken) {
    medal([0.07, 0.034, 0.0], 0x8a1c1c, 0x9a9a9a, silver, ZERO);
    box(b, glass(0xd0e0e0), [0.26, 0.004, 0.2], [0, 0.05, 0]);
    return;
  }
  // The glass gone to shards, one medal thrown out of the case on its ribbon.
  medal([0.2, 0.002, 0.12], 0x8a1c1c, 0x9a9a9a, silver, [0, 0.9, 0]);
  const shard = glass(0x9fb0b0);
  for (let i = 0; i < 6; i++) {
    box(b, shard, [0.03 + scatter(i, 26) * 0.04, 0.003, 0.02 + scatter(i, 27) * 0.03], [-0.1 + scatter(i, 28) * 0.2, 0.034, -0.07 + scatter(i, 29) * 0.14], [0, scatter(i, 30) * 3, 0]);
  }
  box(b, wood, [0.26, 0.02, 0.008], [0, 0.03, 0.115], [0.9, 0, 0]);
}

/** The family photo album: brown leather boards, gilt corners, a photograph set in the cover, a ribbon. */
function photoAlbum(b: MeshBuilder, broken: boolean): void {
  const leather = flat(0x5a3622, 0.8);
  const gilt = flat(0xc9a24a, 0.4);
  const sepia = flat(0x6b5a48, 0.8);
  const cream = flat(0xe8dfc8, 0.9);
  box(b, leather, [0.34, 0.01, 0.28], [0, 0.005, 0]);
  box(b, cream, [0.325, 0.06, 0.27], [0.006, 0.04, 0]);
  box(b, flat(0x4a2c1a, 0.8), [0.02, 0.08, 0.28], [-0.165, 0.04, 0], broken ? [0, 0, 0.12] : ZERO);
  box(b, flat(0xa01818, 0.8), [0.006, 0.002, 0.06], [0.05, 0.02, 0.165]);
  const coverHinge: Vec3 = [-0.16, 0.07, 0];
  const lift = broken ? 0.35 : 0;
  // The front board, opened on its spine by `lift` (radians about z).
  const onCover = (dx: number, dy: number, dz: number): Vec3 => [coverHinge[0] + dx * Math.cos(lift) - dy * Math.sin(lift), coverHinge[1] + dx * Math.sin(lift) + dy * Math.cos(lift), dz];
  box(b, leather, [0.34, 0.01, 0.28], onCover(0.17, 0.005, 0), [0, 0, lift]);
  for (const z of [-0.125, 0.125]) {
    if (broken && z > 0) continue;
    box(b, gilt, [0.03, 0.012, 0.03], onCover(0.325, 0.005, z), [0, 0, lift]);
  }
  box(b, cream, [0.12, 0.002, 0.09], onCover(0.2, 0.0105, 0), [0, 0, lift]);
  box(b, sepia, [0.1, 0.002, 0.07], onCover(0.2, 0.0115, 0), [0, 0, lift]);
  box(b, gilt, [0.1, 0.002, 0.008], onCover(0.2, 0.0105, 0.08), [0, 0, lift]);
  if (!broken) return;
  // Photographs slipped out round it.
  for (let i = 0; i < 6; i++) {
    const at: Vec3 = [-0.22 + scatter(i, 31) * 0.5, 0.001 + i * 0.0004, i % 2 === 0 ? 0.19 + scatter(i, 32) * 0.05 : -0.19 - scatter(i, 32) * 0.05];
    const yaw = scatter(i, 33) * 3;
    box(b, cream, [0.09, 0.002, 0.065], at, [0, yaw, 0]);
    box(b, sepia, [0.075, 0.002, 0.05], [at[0], at[1] + 0.001, at[2]], [0, yaw, 0]);
  }
}

/** His first toy car: a red tin saloon, white stripe, chrome bumpers and hubs, front to +x. */
function firstToyCar(b: MeshBuilder, broken: boolean): void {
  const red = flat(0xb52a22, 0.4);
  box(b, red, [0.17, 0.035, 0.08], [0, 0.03, 0]);
  box(b, flat(0xeeeeee, 0.5), [0.171, 0.004, 0.081], [0, 0.038, 0]);
  const roof: Vec3 = broken ? [0.08, 0.018, 0.07] : [0.08, 0.03, 0.07];
  const roofAt: Vec3 = broken ? [-0.01, 0.056, 0] : [-0.01, 0.0625, 0];
  const roofRot: Vec3 = broken ? [0, 0, 0.12] : ZERO;
  box(b, red, roof, roofAt, roofRot);
  box(b, flat(0x9fc3d6, 0.2), [0.082, broken ? 0.008 : 0.014, 0.072], [roofAt[0], roofAt[1] + 0.0005, 0], roofRot);
  for (const z of [-0.026, 0.026]) ball(b, flat(0xf0e6b0, 0.3), [0.006, 0.006, 0.006], [0.086, 0.035, z], ZERO, 8);
  box(b, CHROME, [0.006, 0.008, 0.08], [0.088, 0.022, 0]);
  box(b, CHROME, [0.006, 0.008, 0.08], [-0.088, 0.022, broken ? 0.01 : 0], broken ? [0, 0.4, 0] : ZERO);
  for (const x of [-0.055, 0.055]) {
    for (const z of [-0.04, 0.04]) {
      // A broken one has lost its front right wheel; it lies beside the car.
      const lost = broken && x > 0 && z > 0;
      const at: Vec3 = lost ? [0.03, 0.006, 0.085] : [x, 0.014, z];
      const rot = lost ? ZERO : AXIS_Z;
      cyl(b, flat(0x161616, 0.8), 0.014, 0.012, at, rot, 12);
      cyl(b, CHROME, 0.007, 0.013, at, rot, 10);
    }
  }
}

/** A teddy sitting up: a round body and head, a pale belly and muzzle, round ears, paws, a red bow. */
function teddy(b: MeshBuilder): void {
  const fur = flat(0x8a5a32, 0.97);
  const pale = flat(0xc9a27a, 0.97);
  const dark = flat(0x1c1410, 0.5);
  ball(b, fur, [0.1, 0.115, 0.09], [0, 0, 0], ZERO, 16);
  ball(b, pale, [0.06, 0.072, 0.03], [0, -0.01, 0.058]);
  ball(b, fur, [0.075, 0.075, 0.075], [0, 0.17, 0.01], ZERO, 16);
  ball(b, pale, [0.032, 0.032, 0.032], [0, 0.155, 0.075]);
  ball(b, dark, [0.011, 0.011, 0.011], [0, 0.165, 0.105], ZERO, 8);
  for (const sx of [-1, 1]) {
    ball(b, dark, [0.01, 0.01, 0.01], [sx * 0.028, 0.19, 0.068], ZERO, 8);
    ball(b, fur, [0.028, 0.028, 0.017], [sx * 0.055, 0.235, 0], ZERO, 10);
    ball(b, fur, [0.028, 0.056, 0.028], [sx * 0.1, 0.03, 0.03], ZERO, 10);
    ball(b, fur, [0.038, 0.038, 0.059], [sx * 0.055, -0.1, 0.07], ZERO, 10);
  }
  box(b, flat(0xb3262a, 0.8), [0.06, 0.03, 0.02], [0, 0.105, 0.075]);
}

/**
 * Every thing's model in the hand, the boot, the cabin and on the ground. A haul is no
 * item and has none here: its load is drawn on its trailer (`createTrailerLoadMesh`) or is
 * a car.
 */
const MODELS: Readonly<Partial<Record<ThingId, Model>>> = {
  pencils,
  globe,
  cushions,
  table_lamp: tableLamp,
  tea_service: teaService,
  record_player: recordPlayer,
  tool_box: toolBox,
  fishing_rods: fishingRods,
  sledge,
  carpet,
  tv_set: tvSet,
  aquarium,
  teddies: teddy,
  grandpa_radio: grandpaRadio,
  stamp_album: stampAlbum,
  music_box: musicBox,
  old_camera: oldCamera,
  chess_set: chessSet,
  model_plane: modelPlane,
  grandpa_medals: grandpaMedals,
  photo_album: photoAlbum,
  first_toy_car: firstToyCar,
};

/** A broken thing's colours are this share of the whole thing's: soot and dust. */
const BROKEN_SHADE = 0.6;

function brokenColour(colour: number): number {
  const r = Math.round(((colour >> 16) & 0xff) * BROKEN_SHADE);
  const g = Math.round(((colour >> 8) & 0xff) * BROKEN_SHADE);
  const b = Math.round((colour & 0xff) * BROKEN_SHADE);
  return (r << 16) | (g << 8) | b;
}

/** The item blueprint key of a thing's model (render/partmesh.ts `itemBlueprint`). */
export function thingModelKey(thing: ThingDef, broken: boolean): string {
  return `thing_${thing.id}${broken ? '_broken' : ''}`;
}

/** Builds the thing's model, whole or broken, centred on its bounds. */
export function buildThingInto(b: MeshBuilder, thing: ThingDef, broken: boolean): void {
  const model = MODELS[thing.id];
  if (!model) throw new Error(`buildThingInto: "${thing.id}" is a haul, never an item`);
  model(b, broken);
  const centre = boundsOf(b.instructions).getCenter(new THREE.Vector3());
  for (let i = 0; i < b.instructions.length; i++) {
    const ins = b.instructions[i]!;
    const material = broken ? { ...ins.material, color: brokenColour(ins.material.color), roughness: 0.97 } : ins.material;
    b.instructions[i] = { ...ins, material, position: [ins.position[0] - centre.x, ins.position[1] - centre.y, ins.position[2] - centre.z] };
  }
}

// ---------------------------------------------------------------------------
// Trailer loads: on the bed, foot at y = 0, centred across and along it
// ---------------------------------------------------------------------------

/** Ratchet straps across a load `width` wide and `height` tall at each z. */
function straps(b: MeshBuilder, width: number, height: number, zs: readonly number[]): void {
  for (const z of zs) {
    box(b, STRAP, [width + 0.02, 0.012, 0.05], [0, height + 0.006, z]);
    for (const x of [-1, 1]) box(b, STRAP, [0.012, height, 0.05], [x * (width / 2 + 0.006), height / 2, z]);
  }
}

/**
 * A wardrobe lying on its back, doors up, cornice to the front, strapped down: 1.79 m
 * over the cornice, inside the KMZ's 1.85 m box with its tailboard up. At 1.99 m it
 * stood through both end boards.
 */
function wardrobe(b: MeshBuilder): void {
  const wood = flat(0x7b5130, 0.7);
  const door = flat(0x8a5c36, 0.7);
  const panel = flat(0x9a6a40, 0.7);
  box(b, wood, [0.95, 0.55, 1.72], [0, 0.275, 0]);
  box(b, flat(0x5e3b22, 0.7), [1.0, 0.6, 0.06], [0, 0.3, 0.87]);
  box(b, flat(0x5e3b22, 0.7), [0.97, 0.57, 0.05], [0, 0.285, -0.865]);
  for (const x of [-0.24, 0.24]) {
    box(b, door, [0.46, 0.02, 1.54], [x, 0.56, 0]);
    box(b, x < 0 ? flat(0xb8c4c8, 0.1) : panel, [0.34, 0.01, 0.55], [x, 0.575, 0.38]);
    box(b, panel, [0.34, 0.01, 0.55], [x, 0.575, -0.38]);
    cyl(b, BRASS, 0.012, 0.03, [x * 0.12, 0.585, 0], ZERO, 8);
  }
  straps(b, 0.95, 0.58, [-0.5, 0.5]);
}

/**
 * An upright piano, keyboard (lid shut) to -Z, strapped round. Its 1.45 m case does not
 * go across a KMZ's 1.2 m box, so `createTrailerLoadMesh` stands it along the box.
 */
function piano(b: MeshBuilder): void {
  const case_ = flat(0x3a2216, 0.35);
  box(b, case_, [1.45, 1.2, 0.42], [0, 0.6, 0.04]);
  box(b, case_, [1.47, 0.03, 0.44], [0, 1.215, 0.04]);
  box(b, case_, [1.3, 0.08, 0.2], [0, 0.72, -0.27]);
  box(b, case_, [1.26, 0.12, 0.05], [0, 0.82, -0.345], [-0.25, 0, 0]);
  box(b, flat(0xc9a24a, 0.4), [0.16, 0.02, 0.003], [0, 0.83, -0.374], [-0.25, 0, 0]);
  for (const x of [-0.69, 0.69]) box(b, case_, [0.06, 0.7, 0.14], [x, 0.35, -0.22]);
  for (const x of [-0.05, 0.05]) box(b, BRASS, [0.03, 0.012, 0.07], [x, 0.06, -0.2]);
  for (const x of [-0.45, 0.45]) {
    box(b, STRAP, [0.05, 0.012, 0.44], [x, 1.236, 0.04]);
    box(b, STRAP, [0.05, 1.22, 0.012], [x, 0.61, 0.256]);
  }
}

/**
 * A three-seat sofa along the bed, back to the left, olive upholstery on short legs:
 * 1.78 m over the arms, inside the box (it was 1.9 m, through both end boards).
 */
function sofa(b: MeshBuilder): void {
  const cloth = flat(0x6b7d52, 0.95);
  const seat = flat(0x5c6f4a, 0.95);
  soft(b, cloth, [0.85, 0.25, 1.78], 0.05, [0, 0.195, 0]);
  for (const z of [-0.56, 0, 0.56]) soft(b, seat, [0.62, 0.16, 0.54], 0.06, [0.08, 0.38, z]);
  soft(b, cloth, [0.22, 0.45, 1.78], 0.07, [-0.315, 0.525, 0]);
  for (const z of [-0.81, 0.81]) soft(b, cloth, [0.85, 0.38, 0.16], 0.06, [0, 0.45, z]);
  for (const x of [-0.37, 0.37]) {
    for (const z of [-0.82, 0.82]) cyl(b, flat(0x3a2a1c, 0.6), 0.025, 0.07, [x, 0.035, z], ZERO, 8);
  }
}

/**
 * The long load: a one-and-a-half bed, 2.0 x 1.14 m over its head- and footboard, a
 * ticking mattress and two pillows. Narrower than the box's inside, so it stands on the
 * deck between the sides; longer than it, so it goes in with its headboard to the
 * trailer's and out over the back with the tailboard off (vehicle/trailer.ts). It used
 * to be a 3.2 x 1.6 m double lying across the tops of the sides, centred, through both
 * end boards.
 */
function bed(b: MeshBuilder): void {
  const wood = flat(0x6b4528, 0.6);
  for (const x of [-0.545, 0.545]) box(b, wood, [0.05, 0.2, 1.9], [x, 0.2, 0]);
  box(b, wood, [1.14, 0.56, 0.06], [0, 0.28, 0.97]);
  box(b, wood, [1.14, 0.36, 0.06], [0, 0.18, -0.97]);
  box(b, flat(0xd9cfb8, 0.95), [1.04, 0.18, 1.88], [0, 0.29, 0]);
  for (let i = 0; i < 5; i++) box(b, flat(0x7d93a8, 0.95), [0.03, 0.004, 1.86], [-0.4 + i * 0.2, 0.382, 0]);
  for (const x of [-0.25, 0.25]) soft(b, flat(0xeeeae0, 0.95), [0.44, 0.1, 0.35], 0.04, [x, 0.43, 0.7]);
  straps(b, 1.04, 0.38, [-0.5, 0.3]);
}

const TRAILER_LOADS: Partial<Readonly<Record<ThingId, (b: MeshBuilder) => void>>> = { wardrobe, piano, sofa, bed };
/** A load turned on the box, radians about the vertical: the piano goes in lengthwise. */
const TRAILER_LOAD_YAW: Partial<Readonly<Record<ThingId, number>>> = { piano: Math.PI / 2 };

/**
 * The thing a contract trailer carries, drawn on its bed (vehicle/trailer.ts): its foot at
 * the origin, centred across and along. Null for a thing that is not a trailer load.
 * The trailer reads its bounds as the payload's box, so they are the thing's own.
 */
export function createTrailerLoadMesh(id: ThingId): THREE.Group | null {
  const build = TRAILER_LOADS[id];
  if (!build) return null;
  const b = new MeshBuilder();
  build(b);
  const group = buildGroup(b.instructions);
  group.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) node.castShadow = true;
  });
  group.rotation.y = TRAILER_LOAD_YAW[id] ?? 0;
  return group;
}
