/**
 * Everything bolted to the outside of the shell: bumpers, grille and lamps on the nose
 * and the tail, mirrors, door handles, the wipers and the filler behind the flap.
 *
 * Lamp lenses go in their lamp slots (materials.ts), which is what names their meshes
 * for the def's `lights`: a lens is one mesh per role, so the vehicle (or the lab's rig)
 * lights the whole role at once. The wipers are pivots on `wiper_sweep`.
 */

import * as THREE from 'three';
import { PartBuilder, type KitSlot, type Vec3 } from './builder';
import { addBuilt, pivotGroup, type KitContext } from './context';
import type { BodyFrame } from './body';

const CHROME_TRIM = 0xb8bec3;
const BLACK = 0x161718;
const GRILLE_DARK = 0x0d0e0f;
const RUBBER = 0x202122;

/** A lamp lens: a shallow bevelled block on a face, in the given slot. */
function lens(b: PartBuilder, slot: KitSlot, centre: Vec3, half: Vec3): void {
  b.bevelBox(slot, centre, half, Math.min(half[0], half[1]) * 0.35);
}

/** A round lens facing +z: an octagonal disc with a chrome ring behind it. */
function roundLamp(b: PartBuilder, slot: KitSlot, centre: Vec3, radius: number, facing: 1 | -1): void {
  const [x, y, z] = centre;
  b.color(CHROME_TRIM).cylinderZ('chrome', [x, y, z], radius * 1.18, 0.012, 12);
  b.cylinderZ(slot, [x, y, z + facing * 0.012], radius, 0.01, 12);
}

/** Front and rear faces of the tub: the first and last stations. */
function ends(frame: BodyFrame): { front: number; tail: number } {
  const st = frame.spec.stations;
  return { front: st[0]!.s, tail: st[st.length - 1]!.s };
}

/**
 * Height band of a bumper. The classic's chrome blade is a slim bar low on the face;
 * the Samara's moulded bumper is a deep band whose top the lamps sit on.
 */
function bumperBand(frame: BodyFrame, end: 1 | -1): { y0: number; y1: number } {
  const { front, tail } = ends(frame);
  const sec = frame.section(end > 0 ? front : tail);
  if (frame.spec.look.bumpers === 'chrome') {
    const y = sec.r1[1] + 0.045;
    return { y0: y - 0.045, y1: y + 0.045 };
  }
  const y0 = sec.r1[1] - 0.03;
  return { y0, y1: y0 + (end > 0 ? 0.26 : 0.22) };
}

interface SweepPoint {
  readonly x: number;
  readonly z: number;
  /** Outward direction in plan. */
  readonly nx: number;
  readonly nz: number;
  /** How far the section reaches outward here, metres. */
  readonly depth: number;
}

/**
 * Sweeps a section — (outward fraction 0..1, height) pairs — along a path in plan,
 * capping both ends: a bumper that turns round the corners in one piece.
 */
function sweep(b: PartBuilder, slot: KitSlot, path: readonly SweepPoint[], section: readonly (readonly [number, number])[]): void {
  const rings: Vec3[][] = path.map((p) => section.map(([o, y]) => [p.x + p.nx * o * p.depth, y, p.z + p.nz * o * p.depth] as Vec3));
  for (let i = 0; i + 1 < rings.length; i++) b.bridge(slot, rings[i]!, rings[i + 1]!, true);
  b.poly(slot, rings[0]!);
  b.poly(slot, [...rings[rings.length - 1]!].reverse());
}

/**
 * Plan path of a bumper across one end of the car: back along each flank by `wrap`,
 * round the corner and across the face, standing `standoff` off the face.
 */
function bumperPath(half: number, zFace: number, end: 1 | -1, depth: number, standoff: number, wrap: number): SweepPoint[] {
  const z = zFace + end * standoff;
  const r = 0.09;
  const side = (sx: number): SweepPoint[] => [
    { x: sx * half, z: z - end * wrap, nx: sx, nz: 0, depth: depth * 0.3 },
    { x: sx * half, z: z - end * r * 0.4, nx: sx, nz: 0, depth: depth * 0.4 },
    { x: sx * (half - r * 0.3), z: z - end * r * 0.1, nx: sx * 0.7071, nz: end * 0.7071, depth: depth * 0.75 },
    { x: sx * (half - r), z, nx: 0, nz: end, depth: depth * 0.95 },
  ];
  const left = side(1);
  const right = side(-1).reverse();
  // Wound so the swept faces face out at both ends of the car.
  const path = [...left, { x: 0, z, nx: 0, nz: end, depth }, ...right];
  return end > 0 ? path.reverse() : path;
}

function buildNose(ctx: KitContext, b: PartBuilder): void {
  const { frame } = ctx;
  const spec = frame.spec;
  const { front } = ends(frame);
  const sec = frame.section(front);
  const z = frame.z(front);
  const top = frame.deckY(front, sec.r4[0]);
  const half = sec.r2[0];
  const bumper = bumperBand(frame, 1);
  if (spec.look.headlamps === 'twin-round') {
    // 2106: two round lamps a side in a black surround, the grille between them.
    const y = (bumper.y1 + top) / 2 + 0.01;
    const r = 0.068;
    b.color(BLACK).boxFrom('trim', [-half + 0.06, y - 0.1, z - 0.01], [half - 0.06, y + 0.1, z + 0.008]);
    for (const side of [1, -1]) {
      roundLamp(b, 'lamp_head', [side * (half - 0.15), y, z + 0.012], r, 1);
      roundLamp(b, 'lamp_head', [side * (half - 0.32), y, z + 0.012], r * 0.92, 1);
      // Indicators under the bumper.
      lens(b, side > 0 ? 'lamp_blinker_l' : 'lamp_blinker_r', [side * (half - 0.18), bumper.y0 - 0.03, z + 0.008], [0.055, 0.022, 0.012]);
    }
    // Grille: chrome frame, dark slats.
    const gw = half - 0.43;
    b.color(CHROME_TRIM).boxFrom('chrome', [-gw - 0.015, y - 0.085, z], [gw + 0.015, y + 0.085, z + 0.02]);
    b.color(GRILLE_DARK).boxFrom('trim', [-gw, y - 0.07, z + 0.006], [gw, y + 0.07, z + 0.024]);
    b.color(CHROME_TRIM);
    for (let i = -3; i <= 3; i++) b.boxFrom('chrome', [i * (gw / 3.5) - 0.006, y - 0.07, z + 0.016], [i * (gw / 3.5) + 0.006, y + 0.07, z + 0.03]);
  } else {
    // 2108: tall rectangular lamps standing on the bumper, indicators at their outer
    // ends, a slotted black panel between them under the bonnet's lip.
    const y0 = bumper.y1 + 0.015;
    const y1 = top - 0.025;
    b.color(BLACK).boxFrom('trim', [-half + 0.03, y0 - 0.012, z - 0.01], [half - 0.03, y1 + 0.012, z + 0.006]);
    for (const side of [1, -1]) {
      const inner = 0.26;
      const outer = half - 0.1;
      lens(b, 'lamp_head', [side * (inner + outer) / 2, (y0 + y1) / 2, z + 0.012], [(outer - inner) / 2, (y1 - y0) / 2, 0.01]);
      lens(b, side > 0 ? 'lamp_blinker_l' : 'lamp_blinker_r', [side * (half - 0.065), (y0 + y1) / 2, z + 0.01], [0.032, (y1 - y0) / 2, 0.01]);
    }
    b.color(GRILLE_DARK);
    for (let i = 0; i < 3; i++) {
      const y = y0 + 0.02 + i * ((y1 - y0 - 0.04) / 2);
      b.boxFrom('trim', [-0.22, y - 0.007, z + 0.006], [0.22, y + 0.007, z + 0.016]);
    }
  }
}

function buildTail(ctx: KitContext, b: PartBuilder): void {
  const { frame } = ctx;
  const spec = frame.spec;
  const { tail } = ends(frame);
  const sec = frame.section(tail);
  const z = frame.z(tail);
  const half = sec.r2[0];
  const top = sec.r3[1];
  const facing = -1;
  const bumper = bumperBand(frame, -1);
  const classic = spec.look.taillamps === 'classic';
  // Classic: wide horizontal clusters over the blade. Samara: tall units on the bumper.
  const y0 = classic ? bumper.y1 + 0.06 : bumper.y1 + 0.015;
  const y1 = top - (classic ? 0.035 : 0.02);
  for (const side of [1, -1]) {
    const outer = half - 0.035;
    const inner = half - (classic ? 0.46 : 0.42);
    const w = (outer - inner) / 3;
    // Housing, then three sections outer to inner: indicator, tail + stop, reverse.
    b.color(BLACK).boxFrom('trim', [side > 0 ? inner - 0.012 : -outer - 0.012, y0 - 0.012, z - 0.006], [side > 0 ? outer + 0.012 : -inner + 0.012, y1 + 0.012, z + 0.002]);
    const cell = (k: number, slot: KitSlot, ya: number, yb: number): void => {
      const xa = outer - k * w;
      const xb = outer - (k + 1) * w;
      lens(b, slot, [side * (xa + xb) / 2, (ya + yb) / 2, z + facing * 0.01], [w / 2 - 0.004, (yb - ya) / 2 - 0.004, 0.01]);
    };
    const mid = (y0 + y1) / 2;
    cell(0, side > 0 ? 'lamp_blinker_l' : 'lamp_blinker_r', y0, y1);
    cell(1, 'lamp_tail', mid, y1);
    cell(1, 'lamp_brake', y0, mid);
    cell(2, 'lamp_reverse', mid, y1);
    cell(2, 'lamp_inert', y0, mid);
  }
}

function buildBumpers(ctx: KitContext, b: PartBuilder): void {
  const { frame } = ctx;
  const spec = frame.spec;
  const { front, tail } = ends(frame);
  const chrome = spec.look.bumpers === 'chrome';
  const widest = spec.stations.reduce((m, st) => Math.max(m, st.wCrease), 0);
  for (const end of [1, -1] as const) {
    const sEnd = end > 0 ? front : tail;
    const reach = end > 0 ? sEnd : spec.length - sEnd;
    const sec = frame.section(sEnd);
    const zFace = frame.z(sEnd);
    const { y0, y1 } = bumperBand(frame, end);
    if (chrome) {
      // A slim blade on brackets with a rubber strip along it, its ends turned back
      // round the corners, and rubber overriders.
      const blade = 0.07;
      // Inside the published width even where the ends wrap round the corners.
      const half = Math.min(sec.r2[0] + 0.02, widest - blade * 0.35);
      const path = bumperPath(half, zFace, end, blade, reach - blade, 0.16);
      const y = (y0 + y1) / 2;
      b.color(CHROME_TRIM);
      sweep(b, 'chrome', path, [[0, y0], [0.75, y0], [1, y0 + 0.025], [1, y1 - 0.025], [0.75, y1], [0, y1]]);
      b.color(RUBBER);
      sweep(b, 'trim', bumperPath(half, zFace, end, blade + 0.004, reach - blade, 0.15), [[0.9, y - 0.012], [1, y - 0.012], [1, y + 0.012], [0.9, y + 0.012]]);
      for (const side of [1, -1]) {
        b.bevelBox('trim', [side * (half - 0.3), y - 0.015, zFace + end * (reach - 0.02)], [0.03, 0.085, 0.028], 0.012);
        // Bracket from the body to the blade.
        b.color(BLACK).boxFrom('trim', [side * (half - 0.32) - 0.02, y - 0.02, Math.min(zFace, zFace + end * (reach - blade))], [side * (half - 0.32) + 0.02, y + 0.02, Math.max(zFace, zFace + end * (reach - blade))]);
        b.color(RUBBER);
      }
    } else {
      // Moulded plastic bumper: deep, wrapping the corners, its face bevelled top and
      // bottom and its foot drawn in, with a moulding groove along it.
      const depth = reach + 0.01;
      const half = Math.min(sec.r2[0] + 0.015, widest - depth * 0.35);
      b.color(0x232427);
      sweep(b, 'trim', bumperPath(half, zFace - end * 0.01, end, depth, 0, 0.2), [
        [0, y0 + 0.02],
        [0.7, y0],
        [0.92, y0 + 0.03],
        [1, y0 + 0.08],
        [1, y1 - 0.05],
        [0.9, y1 - 0.005],
        [0.55, y1],
        [0, y1],
      ]);
      const g = y0 + 0.11;
      b.color(0x34363a);
      sweep(b, 'trim', bumperPath(half + 0.003, zFace - end * 0.01, end, depth + 0.006, 0, 0.19), [[0.97, g - 0.012], [1, g - 0.012], [1, g + 0.012], [0.97, g + 0.012]]);
    }
  }
}

/** Belt mouldings (chrome on the classic, a black rubbing strip on the Samara). */
function buildMouldings(ctx: KitContext, body: PartBuilder): void {
  const { frame } = ctx;
  const spec = frame.spec;
  if (spec.look.bumpers !== 'chrome') return;
  // Chrome on the wheel-arch lips is the classic's signature; a run along the sill too.
  const sills: [number, number][] = [
    [spec.wheels.front + spec.wheels.radius * spec.wheels.arch + 0.02, spec.wheels.rear - spec.wheels.radius * spec.wheels.arch - 0.02],
  ];
  body.color(CHROME_TRIM);
  for (const side of [1, -1]) {
    for (const [s0, s1] of sills) {
      const y = frame.station((s0 + s1) / 2).sill + 0.045;
      const x = frame.sideX((s0 + s1) / 2, y) + 0.004;
      body.boxFrom('chrome', [side > 0 ? x - 0.01 : -x - 0.004, y - 0.012, frame.z(s1)], [side > 0 ? x + 0.004 : -x + 0.01, y + 0.012, frame.z(s0)]);
    }
  }
}

/** Door hardware outside: handle, and a mirror on each front door. */
function buildDoorHardware(ctx: KitContext): void {
  const { frame, nodes } = ctx;
  const spec = frame.spec;
  for (const [owner, door] of nodes) {
    if (!owner.startsWith('door_')) continue;
    const side = owner.endsWith('l') ? 1 : -1;
    const front = owner.startsWith('door_f');
    const b = new PartBuilder();
    // The door's rear edge at the belt, from its pivot (front edge) and the cabin columns.
    const cols = spec.cabin.columns;
    const rearS = front
      ? cols.find((c) => c.lower === 'door1' && c.upper === 'body')?.s ?? cols.filter((c) => c.upper === 'door1').at(-1)!.s
      : cols.filter((c) => c.upper === 'door2').at(-1)!.s;
    const handleS = rearS - 0.13;
    const beltY = frame.station(handleS).belt;
    const y = beltY - (spec.look.bumpers === 'chrome' ? 0.07 : 0.09);
    const x = side * (frame.sideX(handleS, y) + 0.006);
    if (spec.look.bumpers === 'chrome') {
      b.color(CHROME_TRIM).bevelBox('chrome', [x, y, frame.z(handleS)], [0.012, 0.016, 0.075], 0.006);
    } else {
      b.color(BLACK).bevelBox('trim', [x, y, frame.z(handleS)], [0.012, 0.018, 0.07], 0.006);
    }
    addBuilt(door.node, b, door.pivot, `${owner}_handle`);
    if (!front) continue;
    // Mirror: a stalk from the door's front top corner and a head on it.
    const ms = spec.cabin.columns[1]!.s + 0.08;
    const my = frame.station(ms).belt + 0.06;
    const mx = frame.sideX(ms, frame.station(ms).belt);
    const m = new PartBuilder().color(spec.look.bumpers === 'chrome' ? CHROME_TRIM : BLACK);
    const mslot: KitSlot = spec.look.bumpers === 'chrome' ? 'chrome' : 'trim';
    m.boxFrom(mslot, [side > 0 ? mx - 0.01 : -mx - 0.07, my - 0.04, frame.z(ms) - 0.03], [side > 0 ? mx + 0.07 : -mx + 0.01, my - 0.02, frame.z(ms) + 0.03]);
    m.bevelBox(mslot, [side * (mx + 0.1), my + 0.02, frame.z(ms)], [0.06, 0.045, 0.025], 0.015);
    m.color(0x7a8a96).box('chrome', [side * (mx + 0.1), my + 0.02, frame.z(ms) - 0.026], [0.05, 0.035, 0.002]);
    const holder = new THREE.Group();
    holder.name = `${owner}_mirror`;
    addBuilt(holder, m, door.pivot, 'mirrors');
    for (const mesh of holder.children) mesh.name = 'mirrors';
    door.node.add(holder);
  }
}

/** Two wiper arms parked along the screen's foot, sweeping on `wiper_sweep`. */
function buildWipers(ctx: KitContext): void {
  const { frame, root } = ctx;
  const spec = frame.spec;
  const cabin = spec.cabin;
  const base: Vec3 = [0, frame.deckY(frame.cowl, 0), frame.z(frame.cowl)];
  const head: Vec3 = [0, cabin.rail + cabin.crown, frame.z(cabin.columns[0]!.top)];
  const up = new THREE.Vector3(head[0] - base[0], head[1] - base[1], head[2] - base[2]).normalize();
  const across = new THREE.Vector3(1, 0, 0);
  const normal = new THREE.Vector3().crossVectors(across, up).normalize();
  const basis = new THREE.Matrix4().makeBasis(across, up, normal);
  const length = Math.min(0.5, spec.cabin.railHalf * 0.75);
  for (const [i, px] of [0.42, -0.08].entries()) {
    const at: Vec3 = [px, base[1] + 0.035, base[2] - 0.03];
    const g = pivotGroup(`wiper_${i}`, at, { channel: 'wiper_sweep', kind: 'rot', axis: [normal.x, normal.y, normal.z], amount: -1.75 }, { id: 'wipers', label: 'Дворники', action: { type: 'cycle', channel: 'wipers', values: [0, 1, 2] } });
    const b = new PartBuilder().color(BLACK);
    b.push(new THREE.Matrix4().makeTranslation(...at).multiply(basis));
    b.cylinderZ('trim', [0, 0, 0.01], 0.014, 0.012, 6);
    // Arm and blade, lying parked toward the passenger side (-x).
    b.boxFrom('trim', [-length, -0.006, 0.012], [0, 0.006, 0.022]);
    b.boxFrom('trim', [-length - 0.02, 0.004, 0.006], [-0.04, 0.012, 0.014]);
    b.pop();
    addBuilt(g, b, at, `wiper_${i}`);
    root.add(g);
  }
}

/** A cup with a cap behind the fuel flap, so an open flap shows a filler, not a void. */
function buildFiller(ctx: KitContext): void {
  const { frame, nodes } = ctx;
  const flap = frame.spec.flap;
  if (!nodes.has('flap')) return;
  const s = (flap.s0 + flap.s1) / 2;
  const y = (flap.y0 + flap.y1) / 2;
  const x = -(frame.sideX(s, y) - 0.035);
  const b = new PartBuilder().color(0x1a1b1c);
  const hz = (flap.s1 - flap.s0) / 2 - 0.006;
  const hy = (flap.y1 - flap.y0) / 2 - 0.006;
  b.boxFrom('trim', [x - 0.03, y - hy, frame.z(s) - hz], [x + 0.0, y + hy, frame.z(s) + hz], 0b111110);
  b.color(0x2e3032).cylinderX('trim', [x + 0.002, y, frame.z(s)], 0.026, 0.01, 8);
  addBuilt(ctx.root, b, [0, 0, 0], 'filler');
}

function lerpRange(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function buildExterior(ctx: KitContext): void {
  const body = new PartBuilder();
  buildNose(ctx, body);
  buildTail(ctx, body);
  buildBumpers(ctx, body);
  buildMouldings(ctx, body);
  addBuilt(ctx.root, body, [0, 0, 0], 'exterior');
  buildDoorHardware(ctx);
  buildWipers(ctx);
  buildFiller(ctx);
}
