import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { hash01 } from '../core/rng';
import { SurfaceType } from '../core/surfaces';
import type { FoleyEvent } from '../audio/foley';
import type { GameWorld } from '../game/state';
import { canTakes, fillCan, litreText, type FluidKind } from '../items/items';
import type { ChunkContext } from './chunks';
import { rayBox, type FixtureContext, type FixtureField, type FixtureHoldResult, type WorldFixture } from './fixturefield';
import { registerAtlasSign, signMesh } from './market';
import type { Poi } from './poi';
import { box, C, cylinder, mergeKitStatics } from './poi/kit';
import { addStatic, yawRotation } from './props/scatter';

/**
 * The fluid barrels a stop sometimes leaves out (game-design2.md §9): three drums on a
 * timber rack, petrol, oil and water, each painted its own loud colour and stencilled,
 * each with a tap low on its front.
 *
 * A barrel is a help on the road, not a filling station. What is in it is a pure
 * function of the world seed and the barrel (`barrelFirstLitres`): usually a couple of
 * litres, sometimes less, about one in four bone dry. What the taps have run out of it
 * is in `WorldState.barrelLitres`, so a rebuilt chunk holds what was left, and a barrel
 * never refills.
 *
 * Filling is by hand: aim at the tap with a can in your hands and hold F. The tap's
 * handle turns open while F is held (and back when it is let go), the stream runs, and
 * the can fills at a drum tap's rate until it is full or the barrel runs dry. An empty
 * can takes the barrel's fluid; a can of another fluid is refused. The prompt says what
 * is in the can, and only that the barrel is low or empty; F on the drum itself knocks
 * on it, and the knock tells hollow from not.
 */

/** Domain tag for the barrel rolls. */
const BARREL_DOMAIN = 0x42524c31; // 'BRL1'

/** Viewer's left to right: the stand's local +X first (its front faces local -Z). */
const FLUIDS: readonly FluidKind[] = ['petrol', 'oil', 'water'];

/** Drum paint: loud enough to tell apart under headlights and in a dust storm. */
const PAINT: Readonly<Record<FluidKind, number>> = { petrol: 0xd2381f, oil: 0xe0a419, water: 0x2477d1 };
/** The hoops and lid, the same paint darker. */
const HOOP: Readonly<Record<FluidKind, number>> = { petrol: 0x7a2012, oil: 0x86600e, water: 0x15467c };
/** The stream from the tap. */
const STREAM: Readonly<Record<FluidKind, number>> = { petrol: 0xd9cf9a, oil: 0x8a5a14, water: 0xa9c9dd };
const STENCIL: Readonly<Record<FluidKind, string>> = { petrol: 'PETROL', oil: 'OIL', water: 'WATER' };
/** A stencil plate's paint and canvas size; the three are on the sign atlas, one draw. */
const STENCIL_BOARD = ['#ece4cf', '#1d1b18', 256, 96] as const;
for (const text of Object.values(STENCIL)) registerAtlasSign([text], ...STENCIL_BOARD);

// The stand, local metres: base centre at the origin, front facing -Z.
/** A 200 L drum, a touch short. */
const R = 0.29;
const DRUM_H = 0.88;
const RACK_H = 0.32;
const SPACING = 0.72;
const RACK_W = SPACING * 2 + 2 * R + 0.12;
const RACK_D = 2 * R + 0.1;
/** The tap: its height and how far its spout stands off the drum. */
const TAP_Y = RACK_H + 0.11;
const SPOUT_Z = -R - 0.09;
const STREAM_LEN = 0.3;

/** Litres per second out of a drum tap with the handle full open. */
const TAP_RATE = 0.25;
/** Below this the prompt calls a barrel low. */
const LOW_LITRES = 1;
/** Within this of its capacity a can reads as full. */
const CAN_FULL_EPSILON = 0.05;
/** The handle's quarter turn and how quickly it turns, per second of the full turn. */
const HANDLE_TURN = Math.PI / 2;
const HANDLE_SPEED = 4;
/** Seconds the tap stays "held" after the last hold tick: F is sampled per fixed tick. */
const HOLD_GRACE_S = 0.1;

/** A barrel's key in `WorldState.barrelLitres`. */
function barrelId(poiIndex: number, fluid: FluidKind): string {
  return `barrel:${poiIndex}:${fluid}`;
}

/**
 * What a barrel held before anyone came by: about one in four is dry, one in five has
 * a splash under a litre and a quarter, the rest a couple of litres.
 */
function barrelFirstLitres(seed: number, poiIndex: number, fluidIndex: number): number {
  const roll = hash01(seed, BARREL_DOMAIN, poiIndex, fluidIndex);
  const amount = hash01(seed, BARREL_DOMAIN, poiIndex, fluidIndex, 1);
  if (roll < 0.25) return 0;
  if (roll < 0.45) return 0.3 + amount * 0.9;
  return 1.5 + amount * 2;
}

/**
 * Builds a stop's three barrels on their rack at ABSOLUTE (`x`, `z`), the front (taps)
 * turned by `yaw` the way a vending machine's is. In the physics band the rack and the
 * drums are solid, and each drum registers a fixture (its tap and its body) whose id
 * goes into `registered` for the chunk to forget.
 */
export function buildBarrelStand(
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
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // On the lowest corner of the rack, a little sunk: level on a slope, never on air.
  let y = Infinity;
  for (const [lx, lz] of [[-RACK_W / 2, -RACK_D / 2], [RACK_W / 2, -RACK_D / 2], [-RACK_W / 2, RACK_D / 2], [RACK_W / 2, RACK_D / 2]] as const) {
    y = Math.min(y, ctx.terrain.heightAt(x + c * lx + s * lz, z - s * lx + c * lz, poi.s));
  }
  y -= 0.03;

  const root = new THREE.Group();
  root.name = 'barrel-stand';
  root.position.set(x - ctx.originX, y, z - ctx.originZ);
  root.rotation.y = yaw;
  // The rack: two sleepers and the planks across them.
  box(root, [RACK_W, 0.06, RACK_D], [0, RACK_H - 0.03, 0], C.timber);
  for (const lx of [-RACK_W / 2 + 0.08, 0, RACK_W / 2 - 0.08]) {
    box(root, [0.12, RACK_H - 0.06, RACK_D - 0.06], [lx, (RACK_H - 0.06) / 2, 0], C.darkTimber);
  }

  const drums: Barrel[] = [];
  FLUIDS.forEach((fluid, index) => {
    const lx = (1 - index) * SPACING;
    const drum = new THREE.Group();
    drum.position.set(lx, 0, 0);
    root.add(drum);
    cylinder(drum, R, R, DRUM_H, 18, [0, RACK_H + DRUM_H / 2, 0], PAINT[fluid]);
    for (const h of [0.3, 0.62]) cylinder(drum, R + 0.008, R + 0.008, 0.03, 18, [0, RACK_H + DRUM_H * h, 0], HOOP[fluid]);
    cylinder(drum, R - 0.012, R - 0.012, 0.012, 18, [0, RACK_H + DRUM_H + 0.006, 0], HOOP[fluid]);
    cylinder(drum, 0.035, 0.035, 0.02, 8, [R * 0.5, RACK_H + DRUM_H + 0.016, R * 0.2], C.darkMetal);
    // The stencil: a plate on the front.
    const plate = signMesh([STENCIL[fluid]], ...STENCIL_BOARD);
    plate.scale.set(0.22, 0.085, 1);
    plate.position.set(0, RACK_H + DRUM_H * 0.47, -R - 0.006);
    plate.rotation.y = Math.PI;
    drum.add(plate);
    // The tap: a stub of pipe, the valve body, its spout turned down, and the handle on
    // top, which turns a quarter round to open.
    box(drum, [0.035, 0.035, 0.08], [0, TAP_Y, -R - 0.03], C.metal);
    box(drum, [0.06, 0.05, 0.05], [0, TAP_Y, -R - 0.075], C.darkMetal);
    box(drum, [0.026, 0.05, 0.026], [0, TAP_Y - 0.045, SPOUT_Z], C.metal);
    const handle = new THREE.Group();
    // Turned by the tap: kept out of the stand's merge.
    handle.userData.kitKeep = true;
    handle.position.set(0, TAP_Y + 0.03, -R - 0.075);
    box(handle, [0.12, 0.016, 0.022], [0.05, 0, 0], 0xb0261c);
    drum.add(handle);
    const stream = box(drum, [0.018, STREAM_LEN, 0.018], [0, TAP_Y - 0.07 - STREAM_LEN / 2, SPOUT_Z], STREAM[fluid]);
    stream.castShadow = false;
    stream.visible = false;
    stream.userData.kitKeep = true;

    const id = barrelId(poi.index, fluid);
    drums.push(new Barrel(
      id,
      fluid,
      barrelFirstLitres(ctx.world.state.seed, poi.index, index),
      x + c * lx,
      y,
      z - s * lx,
      yaw,
      handle,
      stream,
    ));
  });
  // The drums only stand on the rack: the whole stand in one draw per finish, its three
  // stencils in one; the handles and the streams keep their own.
  mergeKitStatics(root, { deep: true });
  group.add(root);

  if (!ctx.hasPhysics) return;
  addStatic(
    ctx, bodies, colliders, x, y + RACK_H / 2, z,
    RAPIER.ColliderDesc.cuboid(RACK_W / 2, RACK_H / 2, RACK_D / 2),
    SurfaceType.Concrete,
    yawRotation(yaw),
  );
  for (const drum of drums) {
    addStatic(
      ctx, bodies, colliders, drum.x, y + RACK_H + DRUM_H / 2, drum.z,
      RAPIER.ColliderDesc.cylinder(DRUM_H / 2, R),
      SurfaceType.Concrete,
    );
    registered.push(fixtures.register(drum));
  }
}

type Part = 'tap' | 'body';

/** One drum: its tap fills a can held to it, its body answers a knock. */
class Barrel implements WorldFixture {
  /** The part the last `aim` hit. */
  private part: Part | null = null;
  /** The handle's turn, 0 shut to 1 open, eased in `update`. */
  private open = 0;
  /** Seconds left of "F is held on the tap" and "fluid is running", refreshed by `hold`. */
  private turning = 0;
  private running = 0;
  /** What the last knock told, null before one. */
  private knock: 'hollow' | 'slosh' | null = null;

  constructor(
    readonly id: string,
    private readonly fluid: FluidKind,
    /** What it held before anyone came by (`barrelFirstLitres`). */
    private readonly firstLitres: number,
    /** The drum's base centre, ABSOLUTE world metres (the rack's foot). */
    readonly x: number,
    private readonly y: number,
    readonly z: number,
    private readonly yaw: number,
    private readonly handle: THREE.Object3D,
    private readonly stream: THREE.Object3D,
  ) {}

  private litres(world: GameWorld): number {
    return world.state.barrelLitres[this.id] ?? this.firstLitres;
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
    const rx = eyeX + originX - this.x;
    const rz = eyeZ + originZ - this.z;
    const ox = c * rx - s * rz;
    const oy = eyeY - this.y;
    const oz = s * rx + c * rz;
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    const tap = rayBox(ox, oy, oz, lx, dy, lz, 0, TAP_Y, -R - 0.06, 0.08, 0.08, 0.08);
    const body = rayBox(ox, oy, oz, lx, dy, lz, 0, RACK_H + DRUM_H / 2, 0, R, DRUM_H / 2, R);
    const nearest = Math.min(tap, body);
    if (nearest > range) {
      this.part = null;
      return Infinity;
    }
    this.part = tap <= body ? 'tap' : 'body';
    return nearest;
  }

  prompt(ctx: FixtureContext): string | null {
    const name = `${this.fluid} barrel`;
    if (this.part === 'body') {
      if (this.knock === 'hollow') return `${name} — it sounds hollow`;
      if (this.knock === 'slosh') return `${name} — something sloshes inside`;
      return `[F] knock on the ${name}`;
    }
    if (this.part !== 'tap') return null;
    const level = this.litres(ctx.world);
    const barrel = level <= 0 ? ' · barrel empty' : level < LOW_LITRES ? ' · barrel low' : '';
    const can = ctx.held;
    if (can?.type !== 'fluid_can') return `${name} tap — bring a can${barrel}`;
    if (!canTakes(can, this.fluid)) return `${name} tap — not into a ${can.fluid} can`;
    const reading = `can ${can.litres.toFixed(1)}/${litreText(can.capacity)}`;
    if (can.litres >= can.capacity - CAN_FULL_EPSILON) return `${name} tap — ${reading}, full`;
    if (level <= 0) return `${name} tap — ${reading} · the tap runs dry`;
    return `[F] hold to fill — ${reading}${barrel}`;
  }

  press(ctx: FixtureContext): FoleyEvent | null {
    if (this.part !== 'body') return null;
    this.knock = this.litres(ctx.world) <= 0 ? 'hollow' : 'slosh';
    return 'drop';
  }

  hold(ctx: FixtureContext, dt: number, first: boolean): FixtureHoldResult | null {
    if (this.part !== 'tap') return null;
    const can = ctx.held;
    const refused: FixtureHoldResult | null = first ? { sound: 'refused', continuous: null } : null;
    if (can?.type !== 'fluid_can' || !canTakes(can, this.fluid)) return refused;
    // The handle turns whether or not anything comes out: that is how a dry barrel is found.
    this.turning = HOLD_GRACE_S;
    const level = this.litres(ctx.world);
    const room = can.capacity - can.litres;
    if (room <= CAN_FULL_EPSILON || level <= 0) return refused;
    // The flow follows the handle: a trickle as it starts to turn, the full rate open.
    const flow = Math.min(TAP_RATE * this.open * dt, level, room);
    if (flow <= 0) return null;
    fillCan(can, this.fluid, flow);
    ctx.world.apply({ t: 'barrel_litres', barrelId: this.id, litres: level - flow });
    this.running = HOLD_GRACE_S;
    return { sound: null, continuous: 'pour' };
  }

  update(dt: number): void {
    this.turning = Math.max(0, this.turning - dt);
    this.running = Math.max(0, this.running - dt);
    const target = this.turning > 0 ? 1 : 0;
    this.open += Math.sign(target - this.open) * Math.min(Math.abs(target - this.open), HANDLE_SPEED * dt);
    this.handle.rotation.y = this.open * HANDLE_TURN;
    // The chunk froze every matrix when it was placed (world/chunks.ts `freezeStaticSubtree`).
    this.handle.updateMatrix();
    this.stream.visible = this.running > 0;
  }
}
