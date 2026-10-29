import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SurfaceType } from '../core/surfaces';
import type { ChunkContext } from './chunks';
import type { ToyStand } from './devlook';
import { fitGround } from './footprint';
import type { ParkingSlot } from './haulbay';
import { paintSign, registerAtlasSign, signMesh } from './market';
import { box, C, cylinder, material, mergeKitStatics, type V3 } from './poi/kit';
import { addStatic, yawRotation } from './props/scatter';

/**
 * THE TOY BOX'S STAND: what the toy box (world/toybox.ts) is built as, in one of three
 * trial designs (`devLook.stand`, world/devlook.ts, 2026-10-26), and the marked bay
 * painted on the asphalt in front of it. Only shapes: the toy box works them.
 *
 *  - `dome`: a waist-high pedestal, maroon with brass trim, a brass turntable on its top
 *    under a bell of brass hoops (a cage, not glass: no see-through material is compiled
 *    at boot that a stand could share, .omp/rules/shader-variants.md). The controls are
 *    on the pedestal's front. The model is about 1:10.
 *  - `carousel`: a fairground carousel, a red drum with cream pilasters on a dark plinth,
 *    its floor, centre pole and coned roof turning as one, a scalloped valance and a ring
 *    of bulbs (bright paint: the kit has no emissive), the model riding round the pole at
 *    about 1:6. The controls are on a striped ticket booth at its front corner, under a
 *    TOY BOX board.
 *  - `podium`: a low showroom podium 1.44 m across, white on a graphite ring, its dark
 *    top turning with a model of about 1:3.5 on it; the controls on a graphite lectern at
 *    its front corner.
 *
 * Every variant stands inside one footprint (`STAND_HALF_W` by `STAND_HALF_D`, the toy
 * box's `SERVICE_HALF`), its back on the footprint's back, and carries the same CONTROL
 * FACE on a vertical front: the brass PLAQUE on top (a canvas the toy box repaints), the
 * HANDWHEEL under it on the viewer's right, turning about the axis that faces the viewer
 * (local Z), and the button on the left, named TAKE OUT or BUY under it as the
 * selection is a boxed car or a catalogue one. Local metres: base centre at the
 * origin, front facing -Z, the viewer's left local +X, as the card machines'.
 */

/** The footprint every variant stands inside: half its width (local X) and half its depth (local Z). */
export const STAND_HALF_W = 0.8;
export const STAND_HALF_D = 0.95;

/** The control face, from its centre on the front plane: the plaque above, the wheel and the button below. */
const PLAQUE_W = 0.44;
const PLAQUE_H = 0.3;
const PLAQUE_DY = 0.2;
/** Canvas pixels of the plaque, at its aspect. */
const PLAQUE_PX_W = 660;
const PLAQUE_PX_H = 450;
const WHEEL_DX = -0.11;
const WHEEL_DY = -0.2;
/** The wheel's rim, the reach of its handles, and how far it stands off the face. */
const WHEEL_R = 0.12;
const WHEEL_REACH = 0.155;
const WHEEL_PROUD = 0.06;
const BUTTON_DX = 0.15;
const BUTTON_DY = -0.2;
const BUTTON_Z = -0.03;

const BRASS = 0xb8923a;
const BUTTON_COLOUR = 0xc8902a;
const TITLE_BOARD = ['#f2ecd8', '#7a3a1a', 512, 128] as const;
const BUTTON_BOARD = ['#f2ecd8', '#26221c', 256, 64] as const;
registerAtlasSign(['TOY BOX'], ...TITLE_BOARD);
registerAtlasSign(['TAKE OUT'], ...BUTTON_BOARD);
registerAtlasSign(['BUY'], ...BUTTON_BOARD);

/** An axis-aligned box in the stand's frame: centre and half extents. */
export interface StandBox {
  readonly c: V3;
  readonly h: V3;
}

/** A variant's numbers the toy box works with, local metres. */
export interface StandLayout {
  /** The control face's centre, on its front plane. */
  readonly face: V3;
  /** The turntable's floor at its axle: the model stands on it. */
  readonly floor: V3;
  /** How the model fits: off the axle, inside `reach` of it, clear of `inner`, at most `maxScale`. */
  readonly ride: number;
  readonly reach: number;
  readonly inner: number;
  readonly maxScale: number;
  /** Turntable radians a second. */
  readonly spin: number;
  /** What the eye ray stops at, and what is solid. */
  readonly solids: readonly StandBox[];
}

/** The parts the toy box moves and repaints, and where the stand stands. */
export interface ToyStandParts {
  readonly root: THREE.Group;
  readonly layout: StandLayout;
  /** Turns about local Z; its origin on the axle. */
  readonly wheel: THREE.Object3D;
  readonly buttonCap: THREE.Object3D;
  /** The button's two names under it: one shown, as the selection is a boxed car or a catalogue one. */
  readonly takeOutLabel: THREE.Object3D;
  readonly buyLabel: THREE.Object3D;
  /** Turns about local Y; its origin on the floor at the axle, where the model is added. */
  readonly turntable: THREE.Object3D;
  readonly plaque: THREE.MeshStandardMaterial;
  /** ABSOLUTE metres of the base centre, and its yaw. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export function wheelCentre(face: V3): V3 {
  return [face[0] + WHEEL_DX, face[1] + WHEEL_DY, face[2] - WHEEL_PROUD];
}
export function buttonCentre(face: V3): V3 {
  return [face[0] + BUTTON_DX, face[1] + BUTTON_DY, face[2] + BUTTON_Z];
}
export function plaqueCentre(face: V3): V3 {
  return [face[0], face[1] + PLAQUE_DY, face[2] - 0.017];
}
/** Half extents of the parts the cursor picks: the wheel, the button, the plaque. */
export const WHEEL_HALF: V3 = [WHEEL_REACH + 0.01, WHEEL_REACH + 0.01, 0.05];
export const BUTTON_HALF: V3 = [0.08, 0.08, 0.05];
export const PLAQUE_HALF: V3 = [PLAQUE_W / 2 + 0.02, PLAQUE_H / 2 + 0.02, 0.02];

const torusCache = new Map<string, THREE.TorusGeometry>();
/** A kit-coloured torus in the XY plane (axis Z), its geometry shared. */
function torus(parent: THREE.Object3D, radius: number, tube: number, arc: number, at: V3, colour: number, rotation: V3 = [0, 0, 0]): THREE.Mesh {
  const key = `${radius}:${tube}:${arc}`;
  let geometry = torusCache.get(key);
  if (!geometry) {
    geometry = new THREE.TorusGeometry(radius, tube, 6, arc < Math.PI * 2 ? 16 : 28, arc);
    torusCache.set(key, geometry);
  }
  const mesh = new THREE.Mesh(geometry, material(colour));
  mesh.position.set(at[0], at[1], at[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * The control face at `face`: the plaque in a brass frame, the handwheel on its boss,
 * the button, its plate and its two names (TAKE OUT shown, BUY hidden). Returns the
 * moving parts and the plaque's material.
 */
function controlFace(
  root: THREE.Group,
  face: V3,
  disposers: Array<() => void>,
): { wheel: THREE.Object3D; buttonCap: THREE.Object3D; takeOutLabel: THREE.Object3D; buyLabel: THREE.Object3D; plaque: THREE.MeshStandardMaterial } {
  const [fx, fy, fz] = face;
  // The plaque: a brass frame standing proud, the canvas on it.
  box(root, [PLAQUE_W + 0.05, PLAQUE_H + 0.05, 0.014], [fx, fy + PLAQUE_DY, fz - 0.007], BRASS);
  const plaque = paintSign([''], '#d9b866', '#2a2014', PLAQUE_PX_W, PLAQUE_PX_H);
  disposers.push(() => {
    plaque.map?.dispose();
    plaque.dispose();
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(PLAQUE_W, PLAQUE_H), plaque);
  const [px, py, pz] = plaqueCentre(face);
  plate.position.set(px, py, pz);
  plate.rotation.y = Math.PI;
  // Repainted on its own: never merged.
  plate.userData.kitKeep = true;
  root.add(plate);
  disposers.push(() => plate.geometry.dispose());

  // The handwheel: a boss on the face, and the wheel on its axle facing the viewer, six
  // spokes and six handles, one of them red so a turn reads.
  const [wx, wy, wz] = wheelCentre(face);
  cylinder(root, 0.055, 0.055, WHEEL_PROUD, 16, [wx, wy, fz - WHEEL_PROUD / 2], C.darkMetal, [Math.PI / 2, 0, 0]);
  const wheel = new THREE.Group();
  wheel.position.set(wx, wy, wz);
  cylinder(wheel, 0.035, 0.035, 0.05, 14, [0, 0, 0], BRASS, [Math.PI / 2, 0, 0]);
  torus(wheel, WHEEL_R, 0.012, Math.PI * 2, [0, 0, 0], BRASS);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const sx = Math.sin(a);
    const cy = Math.cos(a);
    box(wheel, [0.016, WHEEL_R, 0.012], [sx * WHEEL_R * 0.5, cy * WHEEL_R * 0.5, 0], BRASS, [0, 0, -a]);
    const mid = (WHEEL_R + WHEEL_REACH) / 2;
    cylinder(wheel, 0.011, 0.013, WHEEL_REACH - WHEEL_R + 0.01, 8, [sx * mid, cy * mid, 0], k === 0 ? C.fadedRed : C.darkTimber, [0, 0, -a]);
  }
  root.add(wheel);

  // The button: a plate, a mushroom cap that goes in when pressed, and its name under it.
  const [bx, by, bz] = buttonCentre(face);
  box(root, [0.15, 0.15, 0.02], [bx, by, fz - 0.01], C.darkMetal);
  const buttonCap = new THREE.Group();
  buttonCap.position.set(bx, by, bz);
  cylinder(buttonCap, 0.03, 0.03, 0.04, 12, [0, 0, 0.0], C.darkMetal, [Math.PI / 2, 0, 0]);
  cylinder(buttonCap, 0.06, 0.064, 0.035, 20, [0, 0, -0.035], BUTTON_COLOUR, [Math.PI / 2, 0, 0]);
  root.add(buttonCap);
  const label = (text: string): THREE.Mesh => {
    const mesh = signMesh([text], ...BUTTON_BOARD);
    mesh.scale.set(0.16, 0.04, 1);
    mesh.position.set(bx, by - 0.11, fz - 0.003);
    mesh.rotation.y = Math.PI;
    // Shown and hidden on its own: never merged.
    mesh.userData.kitKeep = true;
    root.add(mesh);
    return mesh;
  };
  const takeOutLabel = label('TAKE OUT');
  const buyLabel = label('BUY');
  buyLabel.visible = false;
  return { wheel, buttonCap, takeOutLabel, buyLabel, plaque };
}

/** A turntable group at `floor`, for the model and whatever turns with it. */
function turntableAt(root: THREE.Group, floor: V3): THREE.Group {
  const group = new THREE.Group();
  group.name = 'toy-turntable';
  group.position.set(floor[0], floor[1], floor[2]);
  root.add(group);
  return group;
}

/** The lectern or booth at the front corner: its centre across, its front, its width. */
const LECTERN_X = -0.51;
const LECTERN_FRONT = -0.87;
const LECTERN_W = 0.56;
/** The dome's pedestal: its middle in depth, its back on the footprint's. */
const DOME_Z = STAND_HALF_D - 0.37;

/** Each variant's control face, local metres: the pedestal's front, or the lectern's. */
export const STAND_FACES: Readonly<Record<ToyStand, V3>> = {
  dome: [0, 0.55, DOME_Z - 0.33],
  carousel: [LECTERN_X, 0.62, LECTERN_FRONT],
  podium: [LECTERN_X, 0.62, LECTERN_FRONT],
};

/** The dome: pedestal, brass turntable, the bell of hoops over it. */
function buildDome(root: THREE.Group, disposers: Array<() => void>): Omit<ToyStandParts, 'root' | 'x' | 'y' | 'z' | 'yaw'> {
  const MAROON = 0x5a2626;
  const cz = DOME_Z;
  box(root, [0.74, 0.08, 0.74], [0, 0.04, cz], C.darkTimber);
  box(root, [0.66, 0.88, 0.66], [0, 0.52, cz], MAROON);
  box(root, [0.68, 0.025, 0.68], [0, 0.945, cz], BRASS);
  box(root, [0.68, 0.025, 0.68], [0, 0.11, cz], BRASS);
  box(root, [0.74, 0.06, 0.74], [0, 0.99, cz], C.darkTimber);
  const face = STAND_FACES.dome;
  const parts = controlFace(root, face, disposers);

  const floor: V3 = [0, 1.05, cz];
  const turntable = turntableAt(root, floor);
  cylinder(turntable, 0.27, 0.27, 0.03, 32, [0, -0.015, 0], BRASS);
  cylinder(turntable, 0.2, 0.2, 0.004, 32, [0, 0.001, 0], 0x3a1c1c);

  // The bell: a foot ring, four hoops over the top crossing at the crown, a ring halfway
  // up, and a finial.
  const R = 0.31;
  const base = 1.03;
  torus(root, R, 0.016, Math.PI * 2, [0, base, cz], BRASS, [Math.PI / 2, 0, 0]);
  for (let k = 0; k < 4; k++) torus(root, R, 0.008, Math.PI, [0, base, cz], BRASS, [0, (k * Math.PI) / 4, 0]);
  torus(root, R * Math.SQRT1_2, 0.007, Math.PI * 2, [0, base + R * Math.SQRT1_2, cz], BRASS, [Math.PI / 2, 0, 0]);
  cylinder(root, 0.018, 0.03, 0.05, 12, [0, base + R + 0.02, cz], BRASS);
  cylinder(root, 0.03, 0.03, 0.03, 12, [0, base + R + 0.055, cz], BRASS);

  return {
    layout: {
      face,
      floor,
      ride: 0,
      reach: 0.26,
      inner: 0,
      maxScale: 1 / 10,
      spin: 0.5,
      solids: [
        // The column's, a little proud of it: the plaque's pick box stands in front.
        { c: [0, 0.51, cz], h: [0.35, 0.51, 0.35] },
        { c: [0, base + 0.17, cz], h: [R, 0.17, R] },
      ],
    },
    turntable,
    ...parts,
  };
}

/** The carousel: plinth, drum, the turning floor, pole and roof; the ticket booth. */
function buildCarousel(root: THREE.Group, disposers: Array<() => void>): Omit<ToyStandParts, 'root' | 'x' | 'y' | 'z' | 'yaw'> {
  const RED = 0xa0352a;
  const CREAM = 0xe9dcb8;
  const BULB = 0xf7dc7a;
  const cz = 0.16;
  cylinder(root, 0.7, 0.7, 0.12, 32, [0, 0.06, cz], C.darkMetal);
  cylinder(root, 0.68, 0.68, 0.36, 32, [0, 0.3, cz], RED);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    box(root, [0.04, 0.34, 0.02], [Math.sin(a) * 0.685, 0.3, cz + Math.cos(a) * 0.685], CREAM, [0, a, 0]);
  }
  for (let k = 0; k < 16; k++) {
    const a = ((k + 0.5) / 16) * Math.PI * 2;
    cylinder(root, 0.018, 0.018, 0.03, 8, [Math.sin(a) * 0.69, 0.46, cz + Math.cos(a) * 0.69], BULB);
  }

  const floor: V3 = [0, 0.5, cz];
  const turntable = turntableAt(root, floor);
  cylinder(turntable, 0.66, 0.66, 0.04, 32, [0, -0.02, 0], CREAM);
  cylinder(turntable, 0.03, 0.03, 1.25, 10, [0, 0.625, 0], BRASS);
  // The roof: its underside, the cone, the scalloped valance round its eave, the bulbs
  // between the scallops, and a pennant on the crown.
  const eave = 1.22;
  cylinder(turntable, 0.74, 0.74, 0.02, 24, [0, eave, 0], 0x6a2a22);
  cylinder(turntable, 0.02, 0.74, 0.38, 16, [0, eave + 0.2, 0], RED);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    box(turntable, [0.27, 0.08, 0.015], [Math.sin(a) * 0.735, eave - 0.05, Math.cos(a) * 0.735], k % 2 === 0 ? RED : CREAM, [0, a, 0]);
    const b = a + Math.PI / 16;
    cylinder(turntable, 0.02, 0.02, 0.03, 8, [Math.sin(b) * 0.75, eave + 0.005, Math.cos(b) * 0.75], BULB);
  }
  cylinder(turntable, 0.03, 0.03, 0.1, 8, [0, eave + 0.44, 0], BRASS);
  box(turntable, [0.12, 0.07, 0.005], [0.06, eave + 0.46, 0], RED);

  // The ticket booth at the front corner: red with cream stripes, a cream cap, a board.
  const bz = LECTERN_FRONT + 0.17;
  box(root, [LECTERN_W, 0.98, 0.34], [LECTERN_X, 0.49, bz], RED);
  for (const sx of [-1, 1]) {
    for (const dz of [-0.09, 0.09]) box(root, [0.012, 0.96, 0.05], [LECTERN_X + sx * (LECTERN_W / 2 + 0.002), 0.49, bz + dz], CREAM);
  }
  box(root, [LECTERN_W + 0.04, 0.05, 0.4], [LECTERN_X, 1.005, bz], CREAM);
  for (const sx of [-1, 1]) box(root, [0.02, 0.16, 0.02], [LECTERN_X + sx * 0.22, 1.11, bz], BRASS);
  box(root, [0.54, 0.15, 0.02], [LECTERN_X, 1.17, bz], C.darkTimber);
  const board = signMesh(['TOY BOX'], ...TITLE_BOARD);
  board.scale.set(0.5, 0.125, 1);
  board.position.set(LECTERN_X, 1.17, bz - 0.012);
  board.rotation.y = Math.PI;
  root.add(board);
  const parts = controlFace(root, STAND_FACES.carousel, disposers);

  return {
    layout: {
      face: STAND_FACES.carousel,
      floor,
      ride: 0.36,
      reach: 0.63,
      inner: 0.08,
      maxScale: 1 / 6,
      spin: 0.7,
      solids: [
        { c: [0, 0.25, cz], h: [0.7, 0.25, 0.7] },
        { c: [0, 1.1, cz], h: [0.05, 0.6, 0.05] },
        { c: [0, eave + 0.5 + 0.2, cz], h: [0.76, 0.24, 0.76] },
        { c: [LECTERN_X, 0.62, bz], h: [LECTERN_W / 2 + 0.03, 0.62, 0.17] },
      ],
    },
    turntable,
    ...parts,
  };
}

/** The podium: graphite ring, white drum, the turning dark top; the lectern. */
function buildPodium(root: THREE.Group, disposers: Array<() => void>): Omit<ToyStandParts, 'root' | 'x' | 'y' | 'z' | 'yaw'> {
  const GRAPHITE = 0x2a2b2e;
  const cz = STAND_HALF_D - 0.72;
  cylinder(root, 0.72, 0.72, 0.1, 40, [0, 0.05, cz], GRAPHITE);
  cylinder(root, 0.68, 0.68, 0.18, 40, [0, 0.19, cz], 0xd9d4c8);
  torus(root, 0.68, 0.01, Math.PI * 2, [0, 0.275, cz], BRASS, [Math.PI / 2, 0, 0]);
  const floor: V3 = [0, 0.31, cz];
  const turntable = turntableAt(root, floor);
  cylinder(turntable, 0.66, 0.66, 0.03, 40, [0, -0.015, 0], 0x3a3d42);

  // The lectern: a base plate, a short post and the board the controls are on.
  const lz = LECTERN_FRONT + 0.025;
  box(root, [0.5, 0.03, 0.4], [LECTERN_X, 0.015, LECTERN_FRONT + 0.15], GRAPHITE);
  box(root, [0.08, 0.23, 0.08], [LECTERN_X, 0.145, LECTERN_FRONT + 0.07], C.darkMetal);
  box(root, [LECTERN_W, 0.72, 0.05], [LECTERN_X, 0.62, lz], GRAPHITE);
  box(root, [LECTERN_W + 0.02, 0.02, 0.06], [LECTERN_X, 0.99, lz], BRASS);
  const parts = controlFace(root, STAND_FACES.podium, disposers);

  return {
    layout: {
      face: STAND_FACES.podium,
      floor,
      ride: 0,
      reach: 0.64,
      inner: 0,
      maxScale: 1 / 3.5,
      spin: 0.35,
      solids: [
        { c: [0, 0.155, cz], h: [0.72, 0.155, 0.72] },
        { c: [LECTERN_X, 0.5, LECTERN_FRONT + 0.2], h: [LECTERN_W / 2, 0.5, 0.2] },
      ],
    },
    turntable,
    ...parts,
  };
}

const BUILDERS: Readonly<Record<ToyStand, typeof buildDome>> = { dome: buildDome, carousel: buildCarousel, podium: buildPodium };

/**
 * Builds the `stand` variant at ABSOLUTE (`x`, `z`), its front turned by `yaw`, on the
 * lowest ground under its footprint. In the physics band its solids are colliders.
 * `disposers` gets the plaque's material and plane.
 */
export function buildToyStand(
  ctx: ChunkContext,
  s: number,
  x: number,
  z: number,
  yaw: number,
  stand: ToyStand,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  disposers: Array<() => void>,
): ToyStandParts {
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const local = (lx: number, lz: number): [number, number] => [x + c * lx + sn * lz, z - sn * lx + c * lz];
  let y = Infinity;
  for (const [lx, lz] of [[-STAND_HALF_W, -STAND_HALF_D], [STAND_HALF_W, -STAND_HALF_D], [-STAND_HALF_W, STAND_HALF_D], [STAND_HALF_W, STAND_HALF_D]] as const) {
    const [wx, wz] = local(lx, lz);
    y = Math.min(y, ctx.terrain.heightAt(wx, wz, s));
  }
  y -= 0.04;

  const root = new THREE.Group();
  root.name = `toy-stand-${stand}`;
  root.position.set(x - ctx.originX, y, z - ctx.originZ);
  root.rotation.y = yaw;
  const built = BUILDERS[stand](root, disposers);
  // The stand's pieces in one draw per finish, each moving part's in one of its own.
  mergeKitStatics(root);
  group.add(root);

  if (ctx.hasPhysics) {
    for (const { c: [lx, ly, lz], h: [hx, hy, hz] } of built.layout.solids) {
      const [wx, wz] = local(lx, lz);
      addStatic(ctx, bodies, colliders, wx, y + ly, wz, RAPIER.ColliderDesc.cuboid(hx, hy, hz), SurfaceType.Concrete, yawRotation(yaw));
    }
  }
  return { root, ...built, x, y, z, yaw };
}

/** The bay's paint, metres: a line's width, its top over the fitted ground, and the end bars' inset. */
const PAINT_W = 0.12;
const PAINT_PROUD = 0.02;
const END_BAR_IN = 0.35;
const BAY_PAINT = 0xd6b04a;

/**
 * Paints the toy box's bay (world/toybox.ts `toyBay`) on the lay-by in the stands'
 * yellow, not the parking row's white: its outline, a second bar inside each end, and a
 * square in its middle, the box the cars go into. Only drawn: a car parks on the pad's
 * own collider.
 */
export function paintToyBay(ctx: ChunkContext, bay: ParkingSlot, group: THREE.Group): void {
  const w = bay.halfWidth;
  const d = bay.halfDepth;
  const plane = fitGround(ctx.terrain, bay.x, bay.z, bay.yaw, w + PAINT_W, d + PAINT_W, bay.s);
  const root = new THREE.Group();
  root.name = 'toy-bay';
  root.position.set(bay.x - ctx.originX, plane.centreY, bay.z - ctx.originZ);
  root.rotation.set(plane.pitch, bay.yaw, plane.roll, 'YXZ');
  // Deep enough to bridge what the fit misses, its top just proud of the asphalt.
  const thick = PAINT_PROUD + plane.residual;
  const py = PAINT_PROUD - thick / 2;
  const paint = (sx: number, sz: number, px: number, pz: number): void => {
    box(root, [sx, thick, sz], [px, py, pz], BAY_PAINT).castShadow = false;
  };
  for (const side of [-1, 1]) {
    paint(PAINT_W, 2 * d + PAINT_W, side * w, 0);
    paint(2 * w, PAINT_W, 0, side * d);
    paint(2 * w, PAINT_W, 0, side * (d - END_BAR_IN));
  }
  const mark = 0.45;
  for (const side of [-1, 1]) {
    paint(PAINT_W, 2 * mark + PAINT_W, side * mark, 0);
    paint(2 * mark, PAINT_W, 0, side * mark);
  }
  mergeKitStatics(root, { deep: true });
  group.add(root);
}
