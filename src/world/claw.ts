import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { hash01 } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import { formatPrice, PRICE_TABLE } from '../economy/economy';
import { machineShellKind, type ShellPrice } from '../economy/shells';
import type { GameWorld } from '../game/state';
import type { Item, StickerFigurineItem } from '../items/items';
import { STICKERS, type StickerKind } from '../items/stickercatalog';
import { createFigurineMesh, FIGURINE_THICK_M, FigurineBatch, figurineGeometry } from '../render/figurine';
import type { FixedGridView, GridLayout } from '../vehicle/trunk';
import { thingName } from './cardmachine';
import type { ChunkContext } from './chunks';
import { rayBox, type FixtureContext, type FixtureField, type FixtureFocus, type WorldFixture } from './fixturefield';
import { registerAtlasSign, signMesh } from './market';
import type { Poi } from './poi';
import { box, C, cylinder, material, mergeKitStatics, type V3 } from './poi/kit';
import { addStatic, yawRotation } from './props/scatter';

/**
 * THE CLAW MACHINE: where a driver wins stickers, at the settlements that have one
 * (world/settlement.ts `poiHasMachine(seed, post, 'claw')`: posts 0..2 always, past them
 * half), on the service band beside the garage machine.
 *
 * A crane cabinet: a glass box on a base, a heap of STICKER FIGURINES in it — each a thick
 * block cut in the outline of one sticker with its print on the face (render/figurine.ts)
 * — a claw hanging from a gantry under the marquee, a chute in the glass box's front
 * right corner over the PRIZE DOOR in the base, and on the ledge across the front a
 * joystick and a DROP button. The glass itself is not drawn (no see-through material is
 * linked): its frame and a few glints say it is there.
 *
 * Worked up close (player/machinefocus.ts): F frames it, and then
 *  - the claw moves over the heap with the movement keys (`WorldFixture.steer`) or with
 *    the joystick dragged by the cursor (`grab`);
 *  - DROP (a click on the button, or the jump key) takes one try's shells, two of the
 *    one kind the machine takes (`machineShellKind` of its id, `PRICE_TABLE.clawTry`), out
 *    of the jar; short of them the button rattles and the claw stays. A try spent is
 *    spent, whatever it brings up. The claw goes down onto the heap, closes, rises, goes
 *    back over the chute and opens there.
 *  - The prize door is a one-cell grid like a card machine's (render/trunkview.ts draws
 *    it while the player stands at the machine, `reach`): F on it takes the figurine,
 *    framed or not (`frames`). While one lies there DROP refuses, as a card machine's
 *    button does with its grid taken.
 *
 * WHAT A TRY BRINGS UP is settled the moment DROP is pressed, and saved with the try
 * (`claw_try`), so leaving or reloading never rolls it again:
 *  - the claw closes on the highest figurine whose middle is within `GRAB_R` of it, or on
 *    nothing: a try over bare felt holds nothing. The heap covers the felt but for the
 *    chute's corner, so that is rare (tools/claw-odds.ts).
 *  - a try that closed on one holds it to the chute by a seeded roll of the machine and
 *    its try count (`HOLD_CHANCE`), or always on the `PITY_TRIES`th try since the last
 *    win. Else it is a WEAK grip: the claw lifts the figurine and loosens on the way up or
 *    over at a seeded point, and the figurine falls back onto the heap.
 *  - Measured (tools/claw-odds.ts), that is a win in 3.8 tries, never more than five,
 *    aimed at a figurine, and in 4.0 with the claw dropped anywhere it reaches (one drop
 *    in seven over bare felt or the chute's corner).
 * A win drops into the chute and lands in the prize door, saved there at once
 * (`WorldState.machineGrids`): it waits for the player whatever happens meanwhile.
 *
 * THE HEAP is drawn from every sticker in the catalogue, seeded per machine: heap slot k
 * is a pure function of the seed, the stop and k. The heap shows the first `HEAP_COUNT`
 * slots not won yet (`ClawMachineState.taken`), so a won figurine leaves it and the next
 * slot fills its place the next time the machine is built (the player came back, or
 * drove off and returned). The figurines are not physics bodies: they lie stacked where
 * they were dropped, a low dome over the felt three layers deep on average, and one
 * that falls drops under gravity,
 * bounces once and lies where it landed; the ones on top of a figurine lifted settle into
 * its gap at once.
 *
 * DRAWN CHEAPLY: the heap is one mesh (render/figurine.ts `FigurineBatch`), one draw for
 * all `HEAP_COUNT` figurines in the sign board's program; a figurine that moves into or
 * out of it rewrites only its own range of the buffer, once. The one figurine in the
 * claw or falling is drawn by itself while it moves (`loose`). The heap and the machine's
 * workings are built only in the physics band (`ClawMachine.live`): farther off the
 * cabinet stands empty.
 *
 * Local metres: base centre at the origin, front facing -Z, so the viewer's left is local +X.
 */

const W = 0.9;
const D = 0.86;
const FRONT = -D / 2;
/** The cabinet under the glass, the glass box's top, and the marquee's. */
const BASE_H = 0.86;
const GLASS_TOP = 1.66;
const H = 1.96;
/** The glass box's corner posts, and the room inside them, either side of the middle. */
const POST = 0.045;
const INNER_X = W / 2 - POST;
const INNER_Z = D / 2 - POST;
/** The felt floor's top. */
const FLOOR_Y = BASE_H + 0.03;
/** The chute: a square hole in the floor's front right corner (the viewer's right is -X), its guard's height. */
const CHUTE_HALF = 0.12;
const CHUTE_X = -INNER_X + CHUTE_HALF + 0.02;
const CHUTE_Z = -INNER_Z + CHUTE_HALF + 0.02;
const GUARD_H = 0.07;
/** A figurine is kept this far outside the chute's guard when it falls on the heap. */
const CHUTE_CLEAR = 0.07;
/** How far the claw's middle reaches from the middle, each way. */
const REACH_X = INNER_X - 0.07;
const REACH_Z = INNER_Z - 0.07;
/** The gantry's rails, the claw head's height at rest, and the drop from its middle to a held figurine's. */
const RAIL_Y = GLASS_TOP - 0.05;
const HEAD_REST_Y = RAIL_Y - 0.17;
const GRIP_Y = 0.15;

/** The ledge across the front: its top, depth and middle; the joystick and the button on it. */
const LEDGE_TOP = BASE_H - 0.02;
const LEDGE_D = 0.2;
const LEDGE_Z = FRONT - LEDGE_D / 2;
const STICK_AT: V3 = [0.2, LEDGE_TOP, LEDGE_Z];
const BUTTON_AT: V3 = [-0.17, LEDGE_TOP, LEDGE_Z];
/** The prize door under the chute, on the base's front: its middle height and size. */
const DOOR_Y = 0.32;
const DOOR_W = 0.3;
const DOOR_H = 0.24;

/** How near the player's feet must be to the front middle of the ledge for the prize door to be reached. */
const ENGAGE_M = 1.4;

/**
 * THE HEAP: how many figurines lie in it, and how far either way of the middle their
 * middles are dropped (a figurine's half length in from the glass). `HEAP_BIAS` of each
 * drop is a second roll's, so the heap is deeper toward the middle.
 */
const HEAP_COUNT = 48;
const SPREAD_X = INNER_X - 0.09;
const SPREAD_Z = INNER_Z - 0.09;
const HEAP_BIAS = 0.35;
/**
 * Each figurine is dropped where it lies lowest under a dome `HEAP_PEAK` high over the
 * middle, falling to the felt at the glass, of this many tries: a heap, not towers.
 */
const HEAP_DROPS = 6;
const HEAP_PEAK = 0.12;
/** Share of the figurines lying face up. */
const FACE_UP = 0.85;
/** Two figurines' middles nearer than this lie one on the other, a layer apart. */
const STACK_R = 0.11;
const LAYER = FIGURINE_THICK_M * 0.9;

/** THE GRIP: the claw closes on the highest figurine whose middle is this near its own. */
export const GRAB_R = 0.13;
/** Chance a try that closed on a figurine holds it to the chute, before the pity rule. */
const HOLD_CHANCE = 0.15;
/** The try this many since the last win holds whatever the roll, if it closed on a figurine. */
const PITY_TRIES = 5;
/** How far the claw's middle reaches from the middle, each way (tools/claw-odds.ts drops it anywhere in it). */
export const CLAW_REACH = { x: REACH_X, z: REACH_Z } as const;

/** Speeds, metres a second: the claw over the felt, down, up, and back to the chute. */
const MOVE_SPEED = 0.22;
const DESCEND_SPEED = 0.32;
const RISE_SPEED = 0.3;
const CARRY_SPEED = 0.22;
/** Timelines, seconds. */
const CLOSE_S = 0.55;
const OPEN_S = 0.45;
const SLIP_S = 0.35;
const RESET_S = 0.5;
const BUTTON_S = 0.3;
const REFUSE_S = 0.4;
/** The prongs' swing out from hanging straight, radians: open, holding a figurine, shut on nothing, loosening. */
const PRONG_OPEN = 0.62;
const PRONG_GRIP = 0.22;
const PRONG_SHUT = 0.04;
const PRONG_SLIP = 0.5;
/** The joystick's lean at full push, radians. */
const STICK_LEAN = 0.35;

const GRAVITY = 9.8;
/** A falling figurine landing faster than this bounces, keeping this share of its speed. */
const BOUNCE_MPS = 0.6;
const BOUNCE_KEEP = 0.3;
const FOCUS_FOV = 50;

/** Domain tag for the claw rolls. */
const CLAW_DOMAIN = 0x434c4157; // 'CLAW'

const BODY = 0xc0396b;
const BODY_DARK = 0x2a1e2b;
const CHROME = 0xd3d7d6;
const HOOD = 0xf2c230;
const TRIM = 0xf2c230;
const FELT = 0x2c4a7a;
const BACKDROP = 0x4a6fa8;
const ACRYLIC = 0xbfe0ea;
const GLINT = 0xe6f3f7;
const HOLE = 0x0d0d10;
const BALL = 0xd0342c;
const BUTTON = 0xd0342c;

/** The marquee and the button's plate, on the sign atlas. */
const MARQUEE = [['CLAW'], '#f2c230', '#26221c', 512, 160] as const;
const BUTTON_PLATE = [['DROP'], '#f2ecd8', '#26221c', 256, 64] as const;
registerAtlasSign(...MARQUEE);
registerAtlasSign(...BUTTON_PLATE);

const BALL_GEOMETRY = new THREE.SphereGeometry(0.026, 12, 8);
const ONE = new THREE.Vector3(1, 1, 1);

/** The prize door's one cell in the machine's frame, for the renderer (render/trunkview.ts). */
const DOOR_LAYOUT: GridLayout = {
  count: 1,
  grid: { columns: 1, rows: 1 },
  cellBox(cell, centre, size) {
    if (cell !== 0) return false;
    centre.set(CHUTE_X, DOOR_Y, FRONT - 0.03);
    size.set(DOOR_W - 0.02, DOOR_H - 0.02, 0);
    return true;
  },
};

type Part = 'body' | 'glass' | 'stick' | 'button' | 'door';

/** The renderer's view of the prize door (`grid`), reused in place. */
interface DoorView {
  readonly layout: GridLayout;
  readonly cells: readonly (Item | null)[];
  selectedCell: number | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}
type Phase = 'idle' | 'descend' | 'close' | 'rise' | 'carry' | 'open' | 'reset';

/** One figurine of the heap, in the machine's frame. */
export interface Prize {
  readonly slot: number;
  readonly kind: StickerKind;
  /** Its range in the heap mesh (`FigurineBatch`). */
  readonly index: number;
  x: number;
  y: number;
  z: number;
  /** Its turn (Euler XYZ): lying flat is rx ±π/2 off its own lean, rz its spin in its own plane. */
  rx: number;
  ry: number;
  rz: number;
  vx: number;
  vy: number;
  vz: number;
  /** Lying in the heap, held by the claw, falling back, falling down the chute, or gone. */
  state: 'pile' | 'held' | 'falling' | 'chute' | 'gone';
  /** Counted by the heap's settling pass: those under it are settled first. */
  settled: boolean;
  /** Its own small lean off flat, radians. */
  readonly tilt: number;
  /** Where the claw took it from, as it closes. */
  fromX: number;
  fromY: number;
  fromZ: number;
}

/** The sticker in heap slot `slot` of the machine at POI `poiIndex`. */
function slotKind(seed: number, poiIndex: number, slot: number): StickerKind {
  return STICKERS[Math.floor(hash01(seed, CLAW_DOMAIN, poiIndex, slot, 1) * STICKERS.length) % STICKERS.length]!.kind;
}

/** True where a figurine would lie on or inside the chute's guard. */
function overChute(x: number, z: number): boolean {
  return x < CHUTE_X + CHUTE_HALF + CHUTE_CLEAR && z < CHUTE_Z + CHUTE_HALF + CHUTE_CLEAR;
}

/**
 * Whether try number `tries` (counting from 1) at the machine of POI `poiIndex`, the
 * `sinceWin`th since its last win, holds what the claw closed on to the chute.
 */
export function clawHolds(seed: number, poiIndex: number, tries: number, sinceWin: number): boolean {
  return sinceWin >= PITY_TRIES || hash01(seed, CLAW_DOMAIN, poiIndex, tries, 2) < HOLD_CHANCE;
}

/**
 * THE HEAP as figures, no meshes: where each figurine lies, what lies on what, and what
 * the claw closes on. Laid out from the seed, the stop and the slots won (`taken`): the
 * first `HEAP_COUNT` slots not won, dropped one by one (each the lowest of a few
 * rolled spots under the heap's dome) and stacked on whatever lies there already.
 */
export class ClawHeap {
  readonly prizes: Prize[] = [];

  constructor(seed: number, poiIndex: number, taken: readonly number[]) {
    const won = new Set(taken);
    const drop = (place: number, k: number): number => {
      const u = (1 - HEAP_BIAS) * hash01(seed, CLAW_DOMAIN, poiIndex, place, k) + HEAP_BIAS * hash01(seed, CLAW_DOMAIN, poiIndex, place, k + 1);
      return 2 * u - 1;
    };
    for (let slot = 0, place = 0; this.prizes.length < HEAP_COUNT; slot++) {
      if (won.has(slot)) continue;
      // Of `HEAP_DROPS` drops off the chute's corner, the one lying lowest under the
      // heap's dome: the heap spreads over the felt instead of growing towers.
      let x = CHUTE_X + CHUTE_HALF + CHUTE_CLEAR;
      let z = 0;
      let best = Infinity;
      for (let k = 0; k < HEAP_DROPS; k++, place++) {
        const cx = drop(place, 10) * SPREAD_X;
        const cz = drop(place, 12) * SPREAD_Z;
        if (overChute(cx, cz)) continue;
        const dome = HEAP_PEAK * (1 - (cx / SPREAD_X) ** 2) * (1 - (cz / SPREAD_Z) ** 2);
        const over = this.restHeight(cx, cz, null) - dome;
        if (over < best) {
          best = over;
          x = cx;
          z = cz;
        }
      }
      const tilt = (hash01(seed, CLAW_DOMAIN, poiIndex, slot, 14) - 0.5) * 0.3;
      const faceUp = hash01(seed, CLAW_DOMAIN, poiIndex, slot, 15) < FACE_UP;
      const prize: Prize = {
        slot, kind: slotKind(seed, poiIndex, slot), index: this.prizes.length,
        x, y: 0, z,
        rx: (faceUp ? -Math.PI / 2 : Math.PI / 2) + tilt,
        ry: (hash01(seed, CLAW_DOMAIN, poiIndex, slot, 16) - 0.5) * 0.3,
        rz: hash01(seed, CLAW_DOMAIN, poiIndex, slot, 17) * Math.PI * 2,
        vx: 0, vy: 0, vz: 0, state: 'pile', settled: true, tilt,
        fromX: 0, fromY: 0, fromZ: 0,
      };
      prize.y = this.restHeight(x, z, prize);
      this.prizes.push(prize);
    }
  }

  /**
   * Where a figurine's middle comes to rest at (`x`, `z`): on the felt, or a layer over
   * the highest settled figurine of the heap within `STACK_R`.
   */
  restHeight(x: number, z: number, self: Prize | null): number {
    let y = FLOOR_Y + FIGURINE_THICK_M / 2;
    for (const q of this.prizes) {
      if (q === self || q.state !== 'pile' || !q.settled) continue;
      if (Math.hypot(q.x - x, q.z - z) < STACK_R) y = Math.max(y, q.y + LAYER);
    }
    return y;
  }

  /** The highest figurine lying in the heap within `GRAB_R` of the claw's middle at (`x`, `z`), or null. */
  prizeUnder(x: number, z: number): Prize | null {
    let best: Prize | null = null;
    for (const p of this.prizes) {
      if (p.state !== 'pile' || Math.hypot(p.x - x, p.z - z) >= GRAB_R) continue;
      if (!best || p.y > best.y) best = p;
    }
    return best;
  }

  /** A figurine went out of the heap: those that lay on it drop into the gap at once. The ones that moved. */
  settle(): Prize[] {
    const pile = this.prizes.filter((p) => p.state === 'pile').sort((a, b) => a.y - b.y);
    const moved: Prize[] = [];
    for (const p of pile) p.settled = false;
    for (const p of pile) {
      const rest = this.restHeight(p.x, p.z, p);
      if (rest < p.y - 1e-4) {
        p.y = rest;
        moved.push(p);
      }
      p.settled = true;
    }
    return moved;
  }
}

/**
 * Builds stop `poi`'s claw machine standing at absolute (`x`, `z`) on the sand, its front
 * turned by `yaw`. In the physics band it is solid, fills its heap and registers its
 * fixture (id pushed to `registered`, for the chunk to forget); `disposers` gets the heap.
 * Yields between its stages: the cabinet, its merge, the machine and its heap.
 */
export function* buildClawSteps(
  ctx: ChunkContext,
  poi: Poi,
  x: number,
  z: number,
  yaw: number,
  group: THREE.Group,
  bodies: RAPIER.RigidBody[],
  colliders: RAPIER.Collider[],
  fixtures: FixtureField,
  registered: string[],
  disposers: Array<() => void>,
): Generator<void, void> {
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const local = (lx: number, lz: number): [number, number] => [x + c * lx + sn * lz, z - sn * lx + c * lz];
  let y = Infinity;
  for (const [lx, lz] of [[-W / 2, FRONT - LEDGE_D], [W / 2, FRONT - LEDGE_D], [-W / 2, -FRONT], [W / 2, -FRONT]] as const) {
    const [wx, wz] = local(lx, lz);
    y = Math.min(y, ctx.terrain.heightAt(wx, wz, poi.s));
  }
  y -= 0.04;

  const root = new THREE.Group();
  root.name = 'claw-machine';
  root.position.set(x - ctx.originX, y, z - ctx.originZ);
  root.rotation.y = yaw;
  const parts = dressCabinet(root);
  yield;
  mergeKitStatics(root);
  group.add(root);

  if (ctx.hasPhysics) {
    addStatic(ctx, bodies, colliders, x, y + H / 2, z, RAPIER.ColliderDesc.cuboid(W / 2, H / 2, D / 2), SurfaceType.Concrete, yawRotation(yaw));
    const [lx, lz] = local(0, LEDGE_Z);
    addStatic(
      ctx, bodies, colliders, lx, y + LEDGE_TOP - 0.15, lz,
      RAPIER.ColliderDesc.cuboid(W / 2 - 0.02, 0.15, LEDGE_D / 2), SurfaceType.Concrete, yawRotation(yaw),
    );
  }

  yield;
  const machine = new ClawMachine(ctx.world, poi.index, parts, x, y, z, yaw, ctx.hasPhysics);
  if (!ctx.hasPhysics) return;
  disposers.push(() => machine.dispose());
  registered.push(fixtures.register(machine));
}

/** The moving parts the cabinet hands the machine. */
interface ClawParts {
  /** The bar across the gantry (moves along Z), the carriage on it (X and Z), the cable and the head under it. */
  readonly bridge: THREE.Object3D;
  readonly carriage: THREE.Object3D;
  readonly cable: THREE.Object3D;
  readonly head: THREE.Object3D;
  /** Each prong's arm, swung out about its hinge's X. */
  readonly prongs: readonly THREE.Object3D[];
  readonly stick: THREE.Object3D;
  readonly buttonCap: THREE.Object3D;
  /** Where the figurines are added. */
  readonly heap: THREE.Group;
}

/** The whole cabinet in the machine's frame: the shell, the glass box's frame, the inside, the gantry and claw, the ledge. */
function dressCabinet(root: THREE.Group): ClawParts {
  // The base, its plinth and a band round it; the marquee over the glass box.
  box(root, [W, BASE_H, D], [0, BASE_H / 2, 0], BODY);
  box(root, [W + 0.02, 0.06, D + 0.02], [0, 0.03, 0], BODY_DARK);
  box(root, [W + 0.012, 0.04, D + 0.012], [0, BASE_H - 0.17, 0], TRIM);
  box(root, [W, H - GLASS_TOP, D], [0, (GLASS_TOP + H) / 2, 0], HOOD);
  box(root, [W + 0.012, 0.03, D + 0.012], [0, GLASS_TOP + 0.015, 0], CHROME);
  const marquee = signMesh(...MARQUEE);
  marquee.scale.set(W - 0.12, 0.2, 1);
  marquee.position.set(0, (GLASS_TOP + H) / 2 + 0.01, FRONT - 0.008);
  marquee.rotation.y = Math.PI;
  root.add(marquee);

  // The glass box: corner posts, a top and a bottom rail, the back panel, and glints
  // across the front and the sides where the glass would catch the sky.
  const glassMid = (BASE_H + GLASS_TOP) / 2;
  const glassH = GLASS_TOP - BASE_H;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(root, [POST, glassH, POST], [sx * (W / 2 - POST / 2), glassMid, sz * (D / 2 - POST / 2)], CHROME);
  }
  for (const yy of [BASE_H + 0.012, GLASS_TOP - 0.012]) {
    box(root, [W - 2 * POST, 0.024, 0.024], [0, yy, FRONT + 0.012], CHROME);
    for (const sx of [-1, 1]) box(root, [0.024, 0.024, D - 2 * POST], [sx * (W / 2 - 0.012), yy, 0], CHROME);
  }
  box(root, [W - 2 * POST, glassH, 0.02], [0, glassMid, D / 2 - 0.01], BACKDROP);
  box(root, [0.014, 0.42, 0.004], [0.14, glassMid + 0.06, FRONT + 0.02], GLINT, [0, 0, 0.55]);
  box(root, [0.008, 0.3, 0.004], [0.22, glassMid + 0.02, FRONT + 0.02], GLINT, [0, 0, 0.55]);
  for (const sx of [-1, 1]) box(root, [0.004, 0.36, 0.012], [sx * (W / 2 - 0.02), glassMid + 0.04, -0.08], GLINT, [0.55 * sx, 0, 0]);

  // The felt floor round the chute's hole, the hole, and the chute's guard on its two inner sides.
  const holeX = CHUTE_X + CHUTE_HALF;
  const holeZ = CHUTE_Z + CHUTE_HALF;
  box(root, [2 * INNER_X, 0.03, INNER_Z - holeZ], [0, FLOOR_Y - 0.015, (INNER_Z + holeZ) / 2], FELT);
  box(root, [INNER_X - holeX, 0.03, holeZ + INNER_Z], [(INNER_X + holeX) / 2, FLOOR_Y - 0.015, (holeZ - INNER_Z) / 2], FELT);
  box(root, [2 * CHUTE_HALF, 0.008, 2 * CHUTE_HALF], [CHUTE_X, BASE_H + 0.005, CHUTE_Z], HOLE);
  box(root, [2 * CHUTE_HALF + 0.008, GUARD_H, 0.008], [CHUTE_X, FLOOR_Y + GUARD_H / 2, holeZ], ACRYLIC);
  box(root, [0.008, GUARD_H, 2 * CHUTE_HALF], [holeX, FLOOR_Y + GUARD_H / 2, CHUTE_Z], ACRYLIC);

  // The gantry: a rail down each side, the bar across them, the carriage on the bar.
  for (const sx of [-1, 1]) box(root, [0.02, 0.02, 2 * INNER_Z], [sx * (INNER_X - 0.01), RAIL_Y + 0.02, 0], CHROME);
  const bridge = new THREE.Group();
  box(bridge, [2 * INNER_X - 0.04, 0.025, 0.03], [0, RAIL_Y + 0.01, 0], CHROME);
  box(bridge, [0.03, 0.03, 0.04], [INNER_X - 0.03, RAIL_Y + 0.02, 0], C.darkMetal);
  box(bridge, [0.03, 0.03, 0.04], [-INNER_X + 0.03, RAIL_Y + 0.02, 0], C.darkMetal);
  root.add(bridge);
  const carriage = new THREE.Group();
  box(carriage, [0.07, 0.04, 0.07], [0, RAIL_Y - 0.015, 0], C.darkMetal);
  box(carriage, [0.05, 0.012, 0.05], [0, RAIL_Y - 0.04, 0], CHROME);
  root.add(carriage);
  // The cable: a unit cylinder stretched from the carriage to the head every frame.
  const cable = cylinder(root, 0.004, 0.004, 1, 6, [0, 0, 0], C.darkMetal);
  cable.userData.kitKeep = true;

  // The head: a hub and three prongs, each an arm on a hinge round the hub, bent in at the tip.
  const head = new THREE.Group();
  cylinder(head, 0.055, 0.055, 0.08, 16, [0, 0, 0], CHROME);
  cylinder(head, 0.03, 0.04, 0.03, 12, [0, 0.055, 0], C.darkMetal);
  const prongs: THREE.Object3D[] = [];
  for (let k = 0; k < 3; k++) {
    const hinge = new THREE.Group();
    hinge.rotation.y = (k * 2 * Math.PI) / 3;
    const arm = new THREE.Group();
    arm.position.set(0, -0.035, 0.05);
    box(arm, [0.016, 0.12, 0.016], [0, -0.06, 0], CHROME);
    box(arm, [0.016, 0.07, 0.016], [0, -0.148, -0.017], CHROME, [0.6, 0, 0]);
    hinge.add(arm);
    head.add(hinge);
    prongs.push(arm);
  }
  root.add(head);

  // The ledge across the front, its plate, the joystick and the DROP button with its name.
  box(root, [W - 0.04, 0.1, LEDGE_D], [0, LEDGE_TOP - 0.05, LEDGE_Z], BODY_DARK);
  box(root, [W - 0.08, 0.008, LEDGE_D - 0.04], [0, LEDGE_TOP + 0.004, LEDGE_Z], TRIM);
  cylinder(root, 0.04, 0.045, 0.016, 16, [STICK_AT[0], LEDGE_TOP + 0.016, STICK_AT[2]], BODY_DARK);
  const stick = new THREE.Group();
  stick.position.set(STICK_AT[0], LEDGE_TOP + 0.024, STICK_AT[2]);
  cylinder(stick, 0.008, 0.008, 0.09, 8, [0, 0.045, 0], CHROME);
  const ball = new THREE.Mesh(BALL_GEOMETRY, material(BALL));
  ball.position.set(0, 0.1, 0);
  ball.castShadow = true;
  ball.receiveShadow = true;
  stick.add(ball);
  root.add(stick);
  cylinder(root, 0.052, 0.056, 0.02, 20, [BUTTON_AT[0], LEDGE_TOP + 0.018, BUTTON_AT[2]], BODY_DARK);
  const buttonCap = new THREE.Group();
  buttonCap.position.set(BUTTON_AT[0], LEDGE_TOP + 0.028, BUTTON_AT[2]);
  cylinder(buttonCap, 0.04, 0.042, 0.03, 20, [0, 0.015, 0], BUTTON);
  root.add(buttonCap);
  const plate = signMesh(...BUTTON_PLATE);
  plate.scale.set(0.12, 0.03, 1);
  plate.position.set(BUTTON_AT[0], LEDGE_TOP + 0.014, BUTTON_AT[2] - 0.07);
  // Lying on the plate, read from the front: its right to the viewer's right, its top away.
  plate.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
  root.add(plate);

  // The prize door under the chute: its dark opening in a chrome frame; a coin plate on the other side.
  box(root, [DOOR_W, DOOR_H, 0.012], [CHUTE_X, DOOR_Y, FRONT - 0.006], HOLE);
  box(root, [DOOR_W + 0.06, 0.03, 0.03], [CHUTE_X, DOOR_Y + DOOR_H / 2 + 0.015, FRONT - 0.015], CHROME);
  box(root, [DOOR_W + 0.06, 0.03, 0.03], [CHUTE_X, DOOR_Y - DOOR_H / 2 - 0.015, FRONT - 0.015], CHROME);
  box(root, [0.03, DOOR_H, 0.03], [CHUTE_X + DOOR_W / 2 + 0.015, DOOR_Y, FRONT - 0.015], CHROME);
  box(root, [0.03, DOOR_H, 0.03], [CHUTE_X - DOOR_W / 2 - 0.015, DOOR_Y, FRONT - 0.015], CHROME);
  box(root, [0.12, 0.2, 0.012], [0.22, 0.5, FRONT - 0.006], CHROME);
  box(root, [0.012, 0.07, 0.008], [0.22, 0.53, FRONT - 0.014], HOLE);

  const heap = new THREE.Group();
  heap.name = 'claw-heap';
  heap.userData.kitKeep = true;
  root.add(heap);
  return { bridge, carriage, cable, head, prongs, stick, buttonCap, heap };
}

class ClawMachine implements WorldFixture {
  readonly id: string;
  private part: Part | null = null;
  private focused = false;
  private engaged = false;
  private readonly price: ShellPrice;
  /** The heap, its mesh, and the one figurine moving by itself (in the claw, falling): null out of the physics band. */
  private heap: ClawHeap | null = null;
  private batch: FigurineBatch | null = null;
  private loose: THREE.Mesh | null = null;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  /** The prize door's one cell: the figurine won and not taken. The renderer reads it as the grid's cells. */
  private readonly cell: (Item | null)[] = [null];
  private readonly gridView: DoorView;
  private readonly focusPose: FixtureFocus;

  /** Where the claw's middle is over the felt, and its head's height. */
  private clawX = CHUTE_X;
  private clawZ = CHUTE_Z;
  private headY = HEAD_REST_Y;
  private prong = PRONG_OPEN;
  /** The stick as the player pushes it this tick (`steer`), and as drawn. */
  private stickX = 0;
  private stickZ = 0;
  private gripping = false;
  private phase: Phase = 'idle';
  private phaseT = 0;
  /** This try: the figurine the claw closes on, whether its grip is weak, where it loosens, what it won. */
  private target: Prize | null = null;
  private weak = false;
  private slipAt = 0;
  private slipT = -1;
  private stopY = HEAD_REST_Y;
  private carried = 0;
  private carryTotal = 1;
  /** The figurine in the claw or falling, drawn by itself (`loose`) until it lies in the heap again or is won. */
  private moving: Prize | null = null;
  /** The figurine this try won, until it lands in the prize door. */
  private won: StickerFigurineItem | null = null;
  private buttonT = -1;
  private refuseT = 0;
  /** A sound the machine made on its own (a prize landing), handed out with the next `steer`. */
  private pendingSound: FoleyEvent | null = null;

  constructor(
    private readonly world: GameWorld,
    private readonly poiIndex: number,
    private readonly parts: ClawParts,
    private readonly x: number,
    private readonly y: number,
    private readonly z: number,
    private readonly yaw: number,
    /** In the physics band: the heap is filled and the machine is worked. */
    live: boolean,
  ) {
    this.id = `claw:${poiIndex}`;
    this.price = { kind: machineShellKind(world.seed, this.id), count: PRICE_TABLE.clawTry };
    this.cell[0] = world.state.machineGrids[this.id]?.find((item) => item !== null) ?? null;
    this.gridView = { layout: DOOR_LAYOUT, cells: this.cell, selectedCell: null, x, y, z, yaw };
    // Framed from in front and above the glass, looking down onto the heap with the ledge in view.
    const [eyeX, eyeY, eyeZ] = this.absolute([0, 1.55, FRONT - 0.95]);
    const [lookX, lookY, lookZ] = this.absolute([0, 1.06, 0.02]);
    this.focusPose = { eyeX, eyeY, eyeZ, lookX, lookY, lookZ, fov: FOCUS_FOV };
    if (live) this.fillHeap();
    this.pose();
  }

  /** A point of the machine's frame in ABSOLUTE metres. */
  private absolute(p: V3): [number, number, number] {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return [this.x + c * p[0] + s * p[2], this.y + p[1], this.z - s * p[0] + c * p[2]];
  }

  /**
   * The heap as the save leaves it, drawn as one mesh in the heap group, and the mesh the
   * one moving figurine is drawn with.
   */
  private fillHeap(): void {
    const heap = new ClawHeap(this.world.seed, this.poiIndex, this.world.state.clawMachines[this.id]?.taken ?? []);
    const bounds = new THREE.Sphere(new THREE.Vector3(0, (FLOOR_Y + GLASS_TOP) / 2, 0), Math.hypot(INNER_X, INNER_Z, (GLASS_TOP - FLOOR_Y) / 2));
    const batch = new FigurineBatch(
      heap.prizes.map((p) => p.kind),
      heap.prizes.map((p) => this.matrixOf(p, new THREE.Matrix4())),
      bounds,
    );
    batch.mesh.matrixAutoUpdate = false;
    this.parts.heap.add(batch.mesh);
    const loose = createFigurineMesh(heap.prizes[0]!.kind);
    loose.visible = false;
    loose.matrixAutoUpdate = false;
    this.parts.heap.add(loose);
    this.heap = heap;
    this.batch = batch;
    this.loose = loose;
  }

  /** `prize`'s pose into `out`. */
  private matrixOf(prize: Prize, out: THREE.Matrix4): THREE.Matrix4 {
    this.euler.set(prize.rx, prize.ry, prize.rz);
    this.position.set(prize.x, prize.y, prize.z);
    return out.compose(this.position, this.quaternion.setFromEuler(this.euler), ONE);
  }

  /** Writes `prize`, lying in the heap now, into the heap mesh. */
  private toBatch(prize: Prize): void {
    this.batch?.place(prize.index, this.matrixOf(prize, this.matrix));
  }

  /** The chunk went: the heap mesh's buffer with it. */
  dispose(): void {
    this.batch?.dispose();
  }

  focus(): FixtureFocus {
    return this.focusPose;
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
    if (!focused) {
      this.stickX = this.stickZ = 0;
      this.gripping = false;
    }
  }

  /** F on a figurine lying in the prize door takes it where the player stands; anything else frames the machine. */
  frames(): boolean {
    return !(this.part === 'door' && this.cell[0] !== null);
  }

  reach(x: number, z: number): number {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const rx = x - this.x;
    const rz = z - this.z;
    const lx = c * rx - s * rz;
    const lz = s * rx + c * rz;
    // In front of it only.
    if (lz > FRONT) return Infinity;
    const d = Math.hypot(lx, lz - (FRONT - LEDGE_D));
    return d <= ENGAGE_M ? d : Infinity;
  }

  engage(): void {
    this.engaged = true;
  }

  disengage(): void {
    this.engaged = false;
  }

  grid(): FixedGridView | null {
    if (!this.engaged) return null;
    this.gridView.selectedCell = this.part === 'door' ? 0 : null;
    return this.gridView;
  }

  aim(originX: number, originZ: number, eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number, range: number): number {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const rx = eyeX - (this.x - originX);
    const rz = eyeZ - (this.z - originZ);
    const ox = c * rx - s * rz;
    const oy = eyeY - this.y;
    const oz = s * rx + c * rz;
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    let best = Infinity;
    let part: Part = 'body';
    const test = (p: Part, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void => {
      const t = rayBox(ox, oy, oz, lx, dy, lz, cx, cy, cz, hx, hy, hz);
      if (t < best) {
        best = t;
        part = p;
      }
    };
    test('body', 0, BASE_H / 2, 0, W / 2, BASE_H / 2, D / 2);
    test('body', 0, (GLASS_TOP + H) / 2, 0, W / 2, (H - GLASS_TOP) / 2, D / 2);
    test('body', 0, LEDGE_TOP - 0.05, LEDGE_Z, W / 2 - 0.02, 0.05, LEDGE_D / 2);
    test('glass', 0, (BASE_H + GLASS_TOP) / 2, 0, W / 2, (GLASS_TOP - BASE_H) / 2, D / 2);
    test('stick', STICK_AT[0], LEDGE_TOP + 0.07, STICK_AT[2], 0.05, 0.08, 0.05);
    test('button', BUTTON_AT[0], LEDGE_TOP + 0.03, BUTTON_AT[2], 0.06, 0.04, 0.06);
    test('door', CHUTE_X, DOOR_Y, FRONT - 0.02, DOOR_W / 2, DOOR_H / 2, 0.03);
    this.part = best > range ? null : part;
    return best > range ? Infinity : best;
  }

  prompt(_ctx: FixtureContext): string | null {
    if (this.part === null) return null;
    const item = this.cell[0];
    if (this.part === 'door' && item) return `[F] take ${thingName(item)}`;
    if (!this.focused) return `[F] CLAW · ${formatPrice(this.price)} a try`;
    if (this.phase !== 'idle') return null;
    switch (this.part) {
      case 'stick':
        return 'drag the stick or WASD: move the claw';
      case 'button':
        return `[click] DROP · ${formatPrice(this.price)}`;
      default:
        return `WASD move the claw · Space or DROP: a try for ${formatPrice(this.price)}`;
    }
  }

  press(ctx: FixtureContext): FoleyEvent | null {
    switch (this.part) {
      case 'door':
        return this.takePrize(ctx);
      case 'button':
        return this.drop(ctx);
      default:
        return null;
    }
  }

  steer(x: number, z: number, jump: boolean, ctx: FixtureContext): FoleyEvent | null {
    this.stickX = x;
    this.stickZ = z;
    const sound = jump ? this.drop(ctx) : null;
    const pending = this.pendingSound;
    this.pendingSound = null;
    return sound ?? pending;
  }

  grab(originX: number, originZ: number, eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number): boolean {
    this.aim(originX, originZ, eyeX, eyeY, eyeZ, dx, dy, dz, Infinity);
    this.gripping = this.part === 'stick';
    return this.gripping;
  }

  release(): FoleyEvent | null {
    this.gripping = false;
    return null;
  }

  cursor(): 'grab' | 'grabbing' | 'pointer' | null {
    if (this.gripping) return 'grabbing';
    if (this.part === 'stick') return 'grab';
    if (this.part === 'button' || (this.part === 'door' && this.cell[0])) return 'pointer';
    return null;
  }

  /** F on the prize door: the figurine lying there into the hands or the pack. */
  private takePrize(ctx: FixtureContext): FoleyEvent | null {
    const item = this.cell[0];
    if (!item) return null;
    if (!ctx.inventory.add(item)) {
      ctx.toast('hands full');
      return 'refused';
    }
    this.cell[0] = null;
    this.world.apply({ t: 'machine_grid', machineId: this.id, cells: [] });
    return 'pickup';
  }

  private refuse(): FoleyEvent {
    this.refuseT = REFUSE_S;
    return 'refused';
  }

  /**
   * DROP: one try's shells out of the jar, and the claw goes down. What it brings up is
   * settled here and saved with the try (see the header).
   */
  private drop(ctx: FixtureContext): FoleyEvent | null {
    const heap = this.heap;
    if (!heap || this.phase !== 'idle') return null;
    this.buttonT = 0;
    if (this.cell[0] || this.won) {
      ctx.toast('take the figurine out of the prize door first');
      return this.refuse();
    }
    if (!ctx.debit(this.price)) {
      ctx.toast(`not enough ${this.price.kind} shells: a try is ${formatPrice(this.price)}`);
      return this.refuse();
    }
    const seed = this.world.seed;
    const record = this.world.state.clawMachines[this.id];
    const tries = (record?.tries ?? 0) + 1;
    const holds = clawHolds(seed, this.poiIndex, tries, (record?.sinceWin ?? 0) + 1);
    const target = heap.prizeUnder(this.clawX, this.clawZ);
    const wins = target !== null && holds;
    this.world.apply({ t: 'claw_try', machineId: this.id, won: wins ? target.slot : null });
    if (wins) {
      // In the prize door for the save at once: it waits there whatever happens to the claw.
      this.won = {
        type: 'sticker_figurine',
        id: this.world.generatedPartId('claw', this.poiIndex, target.slot),
        stickerKind: target.kind,
      };
      this.world.apply({ t: 'machine_grid', machineId: this.id, cells: [this.won] });
    }
    this.target = target;
    this.weak = target !== null && !wins;
    this.slipAt = 0.1 + 0.65 * hash01(seed, CLAW_DOMAIN, this.poiIndex, tries, 3);
    // Down onto the figurine it will close on, else onto whatever lies under it.
    this.stopY = target ? target.y + GRIP_Y : heap.restHeight(this.clawX, this.clawZ, null) + GRIP_Y - 0.02;
    this.stickX = this.stickZ = 0;
    this.phase = 'descend';
    this.phaseT = 0;
    return 'coin';
  }

  /** The held figurine lets go with the claw's velocity: back onto the heap, or down the chute. */
  private letGo(prize: Prize, vx: number, vy: number, vz: number, chute: boolean): void {
    prize.state = chute ? 'chute' : 'falling';
    prize.vx = vx;
    prize.vy = vy;
    prize.vz = vz;
  }

  update(frameDt: number): void {
    const dt = Math.min(frameDt, 0.05);
    let vx = 0;
    let vy = 0;
    let vz = 0;
    switch (this.phase) {
      case 'idle': {
        // The viewer's right is -X, away from him +Z.
        this.clawX = Math.max(-REACH_X, Math.min(REACH_X, this.clawX - this.stickX * MOVE_SPEED * dt));
        this.clawZ = Math.max(-REACH_Z, Math.min(REACH_Z, this.clawZ + this.stickZ * MOVE_SPEED * dt));
        break;
      }
      case 'descend': {
        this.headY = Math.max(this.stopY, this.headY - DESCEND_SPEED * dt);
        if (this.headY <= this.stopY) {
          this.phase = 'close';
          this.phaseT = 0;
          const target = this.target;
          if (target) {
            target.state = 'held';
            target.fromX = target.x;
            target.fromY = target.y;
            target.fromZ = target.z;
            // Out of the heap mesh, drawn by itself while it moves.
            this.batch?.hide(target.index);
            this.moving = target;
            if (this.loose) {
              this.loose.geometry = figurineGeometry(target.kind);
              this.loose.visible = true;
            }
          }
        }
        break;
      }
      case 'close': {
        this.phaseT += dt;
        const k = Math.min(1, this.phaseT / CLOSE_S);
        this.prong = PRONG_OPEN + ((this.target ? PRONG_GRIP : PRONG_SHUT) - PRONG_OPEN) * k;
        if (k >= 1) {
          this.phase = 'rise';
          this.carried = 0;
          this.carryTotal = Math.max(0.01, HEAD_REST_Y - this.headY + Math.hypot(CHUTE_X - this.clawX, CHUTE_Z - this.clawZ));
          if (this.target && this.heap) for (const moved of this.heap.settle()) this.toBatch(moved);
        }
        break;
      }
      case 'rise': {
        const step = Math.min(RISE_SPEED * dt, HEAD_REST_Y - this.headY);
        this.headY += step;
        this.carried += step;
        vy = RISE_SPEED;
        if (this.headY >= HEAD_REST_Y) this.phase = 'carry';
        break;
      }
      case 'carry': {
        const ex = CHUTE_X - this.clawX;
        const ez = CHUTE_Z - this.clawZ;
        const left = Math.hypot(ex, ez);
        const step = Math.min(CARRY_SPEED * dt, left);
        if (left > 1e-6) {
          vx = (ex / left) * CARRY_SPEED;
          vz = (ez / left) * CARRY_SPEED;
          this.clawX += (ex / left) * step;
          this.clawZ += (ez / left) * step;
        }
        this.carried += step;
        if (left - step <= 1e-4) {
          this.phase = 'open';
          this.phaseT = 0;
        }
        break;
      }
      case 'open': {
        // A win still grips as the prongs part; a weak grip or a miss is shut by now.
        const from = this.target && !this.weak ? PRONG_GRIP : PRONG_SHUT;
        this.phaseT += dt;
        const k = Math.min(1, this.phaseT / OPEN_S);
        this.prong = from + (PRONG_OPEN - from) * k;
        if (this.target?.state === 'held' && k > 0.35) this.letGo(this.target, 0, 0, 0, true);
        if (k >= 1) {
          this.phase = 'reset';
          this.phaseT = 0;
        }
        break;
      }
      case 'reset': {
        this.phaseT += dt;
        if (this.phaseT >= RESET_S) {
          this.phase = 'idle';
          this.target = null;
        }
        break;
      }
    }

    // A weak grip loosens at its point of the way up and over: the prongs give and the
    // figurine falls back, with the claw's own velocity.
    const target = this.target;
    if (this.weak && target?.state === 'held' && (this.phase === 'rise' || this.phase === 'carry') && this.carried >= this.slipAt * this.carryTotal) {
      this.letGo(target, vx, vy, vz, false);
      this.slipT = 0;
    }
    if (this.slipT >= 0) {
      this.slipT += dt;
      const k = this.slipT / SLIP_S;
      this.prong = PRONG_SHUT + (PRONG_SLIP - PRONG_SHUT) * Math.sin(Math.PI * Math.min(1, k));
      if (k >= 1) {
        this.slipT = -1;
        this.prong = PRONG_SHUT;
      }
    }
    if (target?.state === 'held') {
      const k = this.phase === 'close' ? Math.min(1, this.phaseT / CLOSE_S) : 1;
      target.x = target.fromX + (this.clawX - target.fromX) * k;
      target.y = target.fromY + (this.headY - GRIP_Y - target.fromY) * k;
      target.z = target.fromZ + (this.clawZ - target.fromZ) * k;
    }
    this.updateMoving(dt);

    let push = 0;
    if (this.buttonT >= 0) {
      this.buttonT += dt;
      push = 0.012 * Math.sin(Math.PI * Math.min(1, this.buttonT / BUTTON_S));
      if (this.buttonT >= BUTTON_S) this.buttonT = -1;
    }
    if (this.refuseT > 0) {
      this.refuseT = Math.max(0, this.refuseT - dt);
      push += 0.004 * Math.sin(this.refuseT * 70) * (this.refuseT / REFUSE_S);
    }
    this.parts.buttonCap.position.y = LEDGE_TOP + 0.028 - push;
    const lean = this.phase === 'idle' ? 1 : 0;
    this.parts.stick.rotation.set(this.stickZ * STICK_LEAN * lean, 0, this.stickX * STICK_LEAN * lean);
    this.pose();
  }

  /**
   * The moving figurine: hanging in the claw, or falling, landing and bouncing, or gone
   * down the chute into the prize door. Back in the heap, it is written into the heap
   * mesh and drawn by itself no more.
   */
  private updateMoving(dt: number): void {
    const p = this.moving;
    const loose = this.loose;
    if (!p || !loose || !this.heap) return;
    if (p.state === 'held') {
      // Hanging in the prongs, tipped toward the face.
      const k = Math.min(1, dt * 6);
      p.rx += (-Math.PI / 2 + 0.9 - p.rx) * k;
      p.ry -= p.ry * k;
    } else if (p.state === 'falling' || p.state === 'chute') {
      p.vy -= GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rx += 7 * dt;
      p.rz += 3 * dt;
      if (p.state === 'chute') {
        // Gone down the hole, out of sight.
        if (p.y < BASE_H + FIGURINE_THICK_M) {
          this.landInDoor(p);
          return;
        }
      } else {
        p.x = Math.max(-SPREAD_X, Math.min(SPREAD_X, p.x));
        p.z = Math.max(-SPREAD_Z, Math.min(SPREAD_Z, p.z));
        // The chute's guard turns it back onto the felt.
        if (overChute(p.x, p.z)) {
          if (CHUTE_X + CHUTE_HALF + CHUTE_CLEAR - p.x < CHUTE_Z + CHUTE_HALF + CHUTE_CLEAR - p.z) p.x = CHUTE_X + CHUTE_HALF + CHUTE_CLEAR;
          else p.z = CHUTE_Z + CHUTE_HALF + CHUTE_CLEAR;
          p.vx = p.vz = 0;
        }
        const rest = this.heap.restHeight(p.x, p.z, p);
        if (p.y <= rest) {
          p.y = rest;
          if (p.vy < -BOUNCE_MPS) {
            p.vy = -p.vy * BOUNCE_KEEP;
            p.vx *= BOUNCE_KEEP;
            p.vz *= BOUNCE_KEEP;
          } else {
            // Face up or face down as it fell (its face's normal is up while
            // cos(ry)·sin(rx) < 0), at its own lean; back into the heap mesh.
            const faceUp = Math.cos(p.ry) * Math.sin(p.rx) < 0;
            p.rx = (faceUp ? -Math.PI / 2 : Math.PI / 2) + p.tilt;
            p.rz = Math.atan2(Math.sin(p.rz), Math.cos(p.rz));
            p.state = 'pile';
            p.settled = true;
            p.vx = p.vy = p.vz = 0;
            this.toBatch(p);
            this.moving = null;
            loose.visible = false;
            return;
          }
        }
      }
    }
    this.matrixOf(p, loose.matrix);
    loose.matrixWorldNeedsUpdate = true;
  }

  /** The won figurine came down the chute: out of the heap, into the prize door. */
  private landInDoor(p: Prize): void {
    p.state = 'gone';
    this.moving = null;
    if (this.loose) this.loose.visible = false;
    if (this.won) {
      this.cell[0] = this.won;
      this.won = null;
      this.pendingSound = 'drop';
    }
  }

  /** The gantry, the cable, the head and its prongs where the claw is now; their matrices, as the chunk froze them. */
  private pose(): void {
    const { bridge, carriage, cable, head, prongs, stick, buttonCap } = this.parts;
    bridge.position.z = this.clawZ;
    carriage.position.set(this.clawX, 0, this.clawZ);
    head.position.set(this.clawX, this.headY, this.clawZ);
    const top = RAIL_Y - 0.04;
    const bottom = this.headY + 0.07;
    cable.position.set(this.clawX, (top + bottom) / 2, this.clawZ);
    cable.scale.set(1, Math.max(0.001, top - bottom), 1);
    for (const prong of prongs) {
      // Swinging out is toward the hinge's +Z, away from the hub.
      prong.rotation.x = -this.prong;
      prong.updateMatrix();
    }
    bridge.updateMatrix();
    carriage.updateMatrix();
    cable.updateMatrix();
    head.updateMatrix();
    stick.updateMatrix();
    buttonCap.updateMatrix();
  }
}
