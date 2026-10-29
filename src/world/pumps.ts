import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SurfaceType } from '../core/surfaces';
import type { FoleyEvent } from '../audio/foley';
import { debit, formatPay, PRICE_TABLE } from '../economy/economy';
import type { GameWorld } from '../game/state';
import { canTakes, fillCan, litreText, type FluidKind } from '../items/items';
import type { ChunkContext } from './chunks';
import { rayBox, type FixtureContext, type FixtureField, type FixtureHoldResult, type WorldFixture } from './fixturefield';
import { registerAtlasSign, signMesh } from './market';
import type { Poi } from './poi';
import { box, C, cylinder, material, mergeKitStatics } from './poi/kit';
import { matReflector } from './props/delineators';
import { addStatic, yawRotation } from './props/scatter';

/**
 * THE PUMPS (game-design2.md §9): three in a row on a low concrete island at some
 * settlements, petrol, oil and water, each painted its own loud colour with white
 * reflector chips on its front, so the three read apart in head lamps and dust.
 *
 * A pump never runs dry and is paid by the fill: one shell (`PRICE_TABLE.pumpFill`,
 * economy/economy.ts), shown on the board on its front, for as much as he
 * pours. It is taken as the first drop runs (`dispense`): from taking the nozzle until
 * it is hung back, or for one held fill of a can at the pump. Without that shell it does
 * not pour.
 *
 * Each pump has a hose of about four metres and a nozzle in a holster. F with empty
 * hands takes the nozzle (`PumpNozzle`, kept by player/interaction.ts); the hose follows
 * it, sagging, and the held use button pours into what the crosshair is on — a car's
 * filler, its engine or radiator under an open bonnet, a can on the ground: the same
 * reservoirs a can pours into. Walked out of the hose's reach, the nozzle springs back
 * into its holster; F on the pump hangs it back. A can in the hands is filled at the
 * pump itself: aim at it and hold F.
 */

/** Viewer's left to right: the stand's local +X first (its front faces local -Z). */
const FLUIDS: readonly FluidKind[] = ['petrol', 'oil', 'water'];

/** Body paint: loud enough to tell apart under headlights and in a dust storm. */
const PAINT: Readonly<Record<FluidKind, number>> = { petrol: 0xd2381f, oil: 0xe0a419, water: 0x2477d1 };
/** The head's band and the nozzle's collar, the same paint darker. */
const TRIM: Readonly<Record<FluidKind, number>> = { petrol: 0x7a2012, oil: 0x86600e, water: 0x15467c };
const NAME: Readonly<Record<FluidKind, string>> = { petrol: 'PETROL', oil: 'OIL', water: 'WATER' };
/** The name plate's paint and canvas size; the three are on the sign atlas, one draw. */
const NAME_BOARD = ['#ece4cf', '#1d1b18', 256, 96] as const;
for (const text of Object.values(NAME)) registerAtlasSign([text], ...NAME_BOARD);
/** The price board: a price only the road decides keeps its own cached board. */
const PRICE_BOARD = ['#1d1b18', '#ece4cf', 256, 96] as const;
const HEAD_PAINT = 0xe6e0cf;
const HOSE_PAINT = 0x1b1c1c;

// The stand, local metres: base centre at the origin, front facing -Z.
const ISLAND_W = 3.9;
const ISLAND_D = 1.1;
const ISLAND_H = 0.15;
const SPACING = 1.3;
const BODY_W = 0.56;
const BODY_D = 0.42;
const BODY_H = 1.3;
const HEAD_W = 0.62;
const HEAD_D = 0.46;
const HEAD_H = 0.34;
/** Top of the pump, from the stand's base. */
const PUMP_TOP = ISLAND_H + BODY_H + HEAD_H;
/** The front face of a pump body, local z. */
const FRONT_Z = -BODY_D / 2;
/** Where the hose leaves the body (pump-local), high on its front, left of the boards. */
const OUTLET = new THREE.Vector3(-0.2, ISLAND_H + 1.15, FRONT_Z - 0.03);
/** The nozzle at rest in its holster (pump-local): its hose end, the spout pointing down. */
const HOLSTER = new THREE.Vector3(0.19, ISLAND_H + 0.98, FRONT_Z - 0.07);

/** Farthest the nozzle's hose end goes from the outlet, metres; past it the nozzle springs back. */
const HOSE_REACH_M = 4;
/** The hose's own length: a little more than the reach, so it always sags. */
const HOSE_LENGTH_M = 4.4;
const HOSE_RADIUS = 0.016;
/** The hose as a tube: rings along it and sides round it. */
const HOSE_RINGS = 20;
const HOSE_SIDES = 6;
/** How far over the ground the hose's centre lies: its radius and a little, clear of the asphalt. */
const HOSE_FLOOR = HOSE_RADIUS + 0.02;

/** Litres per second out of a nozzle held open, into a car or into a can. */
export const PUMP_RATE = 2;
/** Within this of its capacity a can reads as full. */
const CAN_FULL_EPSILON = 0.05;
/** Least litres a pour is worth; below it the pump reads as not pouring. */
const POUR_EPSILON = 1e-4;

/**
 * The nozzle in the player's hand, as player/interaction.ts holds and pours it: its
 * pump's fixture, live while that is registered.
 */
export interface PumpNozzle extends WorldFixture {
  readonly fluid: FluidKind;
  /** The fill's price here, shells (`PRICE_TABLE.pumpFill`). */
  readonly price: number;
  /**
   * The hand moved to ABSOLUTE (`x`, `y`, `z`), looking along (`dx`, `dz`): the nozzle
   * and the hose follow it. False, and nothing moved, when the hose does not reach.
   */
  follow(x: number, y: number, z: number, dx: number, dz: number): boolean;
  /** The nozzle back into its holster. */
  hangUp(): void;
  /** Whether it pours for him now: this fill is paid, or his jar holds its price. */
  canPour(world: GameWorld): boolean;
  /** Pours up to `litres`, taking the fill's price with the first drop; 0 when it cannot be paid. */
  dispense(world: GameWorld, litres: number): number;
}

/**
 * Builds a settlement's three pumps on their island at ABSOLUTE (`x`, `z`), the front
 * turned by `yaw` the way a vending machine's is. In the physics band the island and
 * the pumps are solid, and each pump registers a fixture whose id goes into
 * `registered` for the chunk to forget; each hose's geometry is freed by a disposer.
 */
export function buildPumpStand(
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
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // On the lowest corner of the island, a little sunk: level on a slope, never on air.
  let y = Infinity;
  for (const [lx, lz] of [[-ISLAND_W / 2, -ISLAND_D / 2], [ISLAND_W / 2, -ISLAND_D / 2], [-ISLAND_W / 2, ISLAND_D / 2], [ISLAND_W / 2, ISLAND_D / 2]] as const) {
    y = Math.min(y, ctx.terrain.heightAt(x + c * lx + s * lz, z - s * lx + c * lz, poi.s));
  }
  y -= 0.03;

  const root = new THREE.Group();
  root.name = 'pump-stand';
  root.position.set(x - ctx.originX, y, z - ctx.originZ);
  root.rotation.y = yaw;
  box(root, [ISLAND_W, ISLAND_H, ISLAND_D], [0, ISLAND_H / 2, 0], C.concreteLight);
  box(root, [ISLAND_W + 0.02, 0.04, 0.04], [0, ISLAND_H - 0.02, -ISLAND_D / 2], 0xd8b02a);

  const pumps: Pump[] = [];
  FLUIDS.forEach((fluid, index) => {
    const lx = (1 - index) * SPACING;
    const fixtureId = `pump:${poi.index}:${fluid}`;
    const price = PRICE_TABLE.pumpFill;
    const pump = new THREE.Group();
    pump.position.set(lx, 0, 0);
    root.add(pump);
    box(pump, [BODY_W, BODY_H, BODY_D], [0, ISLAND_H + BODY_H / 2, 0], PAINT[fluid]);
    box(pump, [HEAD_W, HEAD_H, HEAD_D], [0, ISLAND_H + BODY_H + HEAD_H / 2, 0], HEAD_PAINT);
    box(pump, [HEAD_W + 0.01, 0.06, HEAD_D + 0.01], [0, ISLAND_H + BODY_H + 0.03, 0], TRIM[fluid]);
    box(pump, [BODY_W + 0.02, 0.08, BODY_D + 0.02], [0, ISLAND_H + 0.04, 0], C.darkMetal);
    // The name on the head, the price of a fill on the body.
    const plate = signMesh([NAME[fluid]], ...NAME_BOARD);
    plate.scale.set(0.5, 0.19, 1);
    plate.position.set(0, ISLAND_H + BODY_H + HEAD_H / 2, -HEAD_D / 2 - 0.006);
    plate.rotation.y = Math.PI;
    pump.add(plate);
    const priceBoard = signMesh([`FILL ${formatPay(price)}`], ...PRICE_BOARD);
    priceBoard.scale.set(0.34, 0.13, 1);
    priceBoard.position.set(0, ISLAND_H + BODY_H - 0.16, FRONT_Z - 0.006);
    priceBoard.rotation.y = Math.PI;
    pump.add(priceBoard);
    // White chips low on the front corners: the paint is what tells the three apart, the
    // chips are what a head lamp finds first.
    for (const sx of [-1, 1]) reflector(pump, sx * (BODY_W / 2 - 0.07), ISLAND_H + 0.45, FRONT_Z - 0.008);
    // The hose's stub and the holster.
    cylinder(pump, 0.03, 0.03, 0.06, 8, [OUTLET.x, OUTLET.y, FRONT_Z - 0.03], C.darkMetal, [Math.PI / 2, 0, 0]);
    box(pump, [0.09, 0.2, 0.08], [HOLSTER.x, HOLSTER.y - 0.12, FRONT_Z - 0.04], C.darkMetal);

    const nozzle = nozzleModel(fluid);
    pump.add(nozzle);
    const hose = new THREE.Mesh(hoseGeometry(), material(HOSE_PAINT, 0.9));
    hose.castShadow = false;
    hose.receiveShadow = true;
    hose.userData.kitKeep = true;
    pump.add(hose);
    disposers.push(() => hose.geometry.dispose());

    // The ground under a pump-local point, pump-local: the asphalt or the sand the hose lies on.
    const px = x + c * lx;
    const pz = z - s * lx;
    const ground = (hx: number, hz: number): number => ctx.terrain.heightAt(px + c * hx + s * hz, pz - s * hx + c * hz, poi.s) - y;
    const fixture = new Pump(fixtureId, fluid, price, px, y, pz, yaw, -lx, nozzle, hose, ground);
    fixture.hangUp();
    // Built before the chunk freezes it: the first frame draws it in its holster.
    fixture.update();
    pumps.push(fixture);
  });
  // The pumps only stand on the island: the whole stand in one draw per finish, its
  // plates in one; each nozzle and hose keeps its own.
  mergeKitStatics(root, { deep: true });
  group.add(root);

  if (!ctx.hasPhysics) return;
  addStatic(
    ctx, bodies, colliders, x, y + ISLAND_H / 2, z,
    RAPIER.ColliderDesc.cuboid(ISLAND_W / 2, ISLAND_H / 2, ISLAND_D / 2),
    SurfaceType.Concrete,
    yawRotation(yaw),
  );
  for (const pump of pumps) {
    addStatic(
      ctx, bodies, colliders, pump.x, y + ISLAND_H + (BODY_H + HEAD_H) / 2, pump.z,
      RAPIER.ColliderDesc.cuboid(HEAD_W / 2, (BODY_H + HEAD_H) / 2, HEAD_D / 2),
      SurfaceType.Concrete,
      yawRotation(yaw),
    );
    registered.push(fixtures.register(pump));
  }
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** One reflector chip: the delineators' material, lit with them at dusk. */
function reflector(parent: THREE.Object3D, x: number, y: number, z: number): void {
  const chip = new THREE.Mesh(UNIT_BOX, matReflector);
  chip.scale.set(0.09, 0.14, 0.014);
  chip.position.set(x, y, z);
  chip.receiveShadow = true;
  parent.add(chip);
}

/**
 * The nozzle: its origin is where the hose goes in, its spout points along local -Z.
 * Moved on its own, so kept out of the stand's merge.
 */
function nozzleModel(fluid: FluidKind): THREE.Group {
  const nozzle = new THREE.Group();
  nozzle.userData.kitKeep = true;
  nozzle.rotation.order = 'YXZ';
  box(nozzle, [0.05, 0.06, 0.16], [0, 0, -0.08], C.darkMetal);
  box(nozzle, [0.04, 0.12, 0.045], [0, -0.07, -0.03], C.darkMetal);
  box(nozzle, [0.052, 0.03, 0.03], [0, 0, -0.01], TRIM[fluid]);
  box(nozzle, [0.012, 0.05, 0.06], [0, -0.05, -0.09], C.metal);
  cylinder(nozzle, 0.012, 0.012, 0.16, 8, [0, -0.02, -0.23], C.metal, [Math.PI / 2 - 0.25, 0, 0]);
  return nozzle;
}

/** A hose's tube, positions written by `layHose`; the ring order and the index never change. */
function hoseGeometry(): THREE.BufferGeometry {
  const count = (HOSE_RINGS + 1) * HOSE_SIDES;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const index: number[] = [];
  for (let ring = 0; ring < HOSE_RINGS; ring++) {
    for (let side = 0; side < HOSE_SIDES; side++) {
      const a = ring * HOSE_SIDES + side;
      const b = ring * HOSE_SIDES + ((side + 1) % HOSE_SIDES);
      index.push(a, a + HOSE_SIDES, b, b, a + HOSE_SIDES, b + HOSE_SIDES);
    }
  }
  geometry.setIndex(index);
  return geometry;
}

const _point = new THREE.Vector3();
const _next = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _binormal = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** The ground under a pump-local point, as a pump-local height. */
type PumpGround = (x: number, z: number) => number;

/** The floor under each ring of the hose, pump-local heights: refilled by `layHose`. */
const _floors = new Float64Array(HOSE_RINGS + 1);

/**
 * The hose's centre line at ring `ring`, 0 at the outlet, `HOSE_RINGS` at the nozzle: a
 * parabola sagging by `sag`, never under the ring's floor (`_floors`).
 */
function hosePoint(from: THREE.Vector3, to: THREE.Vector3, sag: number, ring: number, out: THREE.Vector3): THREE.Vector3 {
  const t = ring / HOSE_RINGS;
  out.lerpVectors(from, to, t);
  out.y = Math.max(_floors[ring]!, out.y - 4 * sag * t * (1 - t));
  return out;
}

/**
 * Lays the hose from `from` to `to` (pump-local): it hangs in the parabola whose length
 * is the hose's, and lies on the ground where that would go under it — the asphalt or
 * the sand as they really lie (`ground`), or the island (centred at pump-local x
 * `islandX`) where it crosses that.
 */
function layHose(geometry: THREE.BufferGeometry, from: THREE.Vector3, to: THREE.Vector3, islandX: number, ground: PumpGround): void {
  for (let ring = 0; ring <= HOSE_RINGS; ring++) {
    const t = ring / HOSE_RINGS;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const onIsland = Math.abs(x - islandX) < ISLAND_W / 2 && Math.abs(z) < ISLAND_D / 2;
    _floors[ring] = Math.max(ground(x, z), onIsland ? ISLAND_H : -Infinity) + HOSE_FLOOR;
  }
  const chord = from.distanceTo(to);
  const slack = Math.max(0, HOSE_LENGTH_M - chord);
  // A shallow parabola of chord d and sag h is d + 8h²/3d long.
  const sag = Math.min(1.4, Math.sqrt((3 * Math.max(chord, 0.3) * slack) / 8));
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  for (let ring = 0; ring <= HOSE_RINGS; ring++) {
    hosePoint(from, to, sag, ring, _point);
    if (ring < HOSE_RINGS) _tangent.subVectors(hosePoint(from, to, sag, ring + 1, _next), _point);
    else _tangent.subVectors(_point, hosePoint(from, to, sag, ring - 1, _next));
    if (_tangent.lengthSq() < 1e-10) _tangent.set(0, -1, 0);
    _tangent.normalize();
    _normal.crossVectors(_tangent, _up);
    if (_normal.lengthSq() < 1e-6) _normal.set(1, 0, 0);
    _normal.normalize();
    _binormal.crossVectors(_tangent, _normal);
    for (let side = 0; side < HOSE_SIDES; side++) {
      const a = (side / HOSE_SIDES) * Math.PI * 2;
      const nx = Math.cos(a) * _normal.x + Math.sin(a) * _binormal.x;
      const ny = Math.cos(a) * _normal.y + Math.sin(a) * _binormal.y;
      const nz = Math.cos(a) * _normal.z + Math.sin(a) * _binormal.z;
      const i = ring * HOSE_SIDES + side;
      position.setXYZ(i, _point.x + nx * HOSE_RADIUS, _point.y + ny * HOSE_RADIUS, _point.z + nz * HOSE_RADIUS);
      normal.setXYZ(i, nx, ny, nz);
    }
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  geometry.computeBoundingSphere();
}

/** One pump: F takes or hangs back its nozzle, or fills a can held to it. */
class Pump implements WorldFixture, PumpNozzle {
  /** In the player's hand (true) or in its holster. */
  private taken = false;
  /** The nozzle's hose end, pump-local, and its look; `dirty` until the hose is laid to it. */
  private readonly end = new THREE.Vector3();
  private yawInHand = 0;
  private dirty = true;
  /**
   * This fill is paid: set by the first drop (`dispense`), cleared when the nozzle is
   * hung back or a new held fill of a can begins.
   */
  private paid = false;

  constructor(
    readonly id: string,
    readonly fluid: FluidKind,
    readonly price: number,
    /** The pump's base centre, ABSOLUTE world metres (the island's foot). */
    readonly x: number,
    private readonly y: number,
    readonly z: number,
    private readonly yaw: number,
    /** The island's centre along the row, pump-local x: the hose lies on it. */
    private readonly islandX: number,
    private readonly nozzle: THREE.Object3D,
    private readonly hose: THREE.Mesh,
    /** The ground under a pump-local point, pump-local: the hose lies on it. */
    private readonly ground: PumpGround,
  ) {}

  private priceText(): string {
    return `fill ${formatPay(this.price)}`;
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
    // The body and head, and the holster with the nozzle standing off its front.
    const hit = rayBox(ox, oy, oz, lx, dy, lz, 0, (ISLAND_H + PUMP_TOP) / 2, -0.05, HEAD_W / 2, (PUMP_TOP - ISLAND_H) / 2, HEAD_D / 2 + 0.05);
    return hit <= range ? hit : Infinity;
  }

  prompt(ctx: FixtureContext): string | null {
    const name = `${this.fluid} pump`;
    if (ctx.nozzle === this) return `[F] hang the ${this.fluid} nozzle back`;
    const held = ctx.held;
    if (held === null) return `[F] take the ${this.fluid} nozzle — ${this.priceText()}`;
    if (held.type !== 'fluid_can') return `${name} — ${this.priceText()} · hands full`;
    if (!canTakes(held, this.fluid)) return `${name} — not into a ${held.fluid} can`;
    const reading = `can ${held.litres.toFixed(1)}/${litreText(held.capacity)}`;
    if (held.litres >= held.capacity - CAN_FULL_EPSILON) return `${name} — ${reading}, full`;
    if (!this.canPour(ctx.world)) return `${name} — ${this.priceText()} · no shell, it does not pour`;
    return `[F] hold to fill — ${reading} · ${this.priceText()}`;
  }

  press(ctx: FixtureContext): FoleyEvent | null {
    if (ctx.nozzle === this) {
      ctx.takeNozzle(null);
      return 'drop';
    }
    if (ctx.held !== null) return null;
    ctx.takeNozzle(this);
    return 'pickup';
  }

  hold(ctx: FixtureContext, dt: number, first: boolean): FixtureHoldResult | null {
    const can = ctx.held;
    if (can?.type !== 'fluid_can') return null;
    const refused: FixtureHoldResult | null = first ? { sound: 'refused', continuous: null } : null;
    // A can held to the pump is a fill of its own each time the button goes down.
    if (first && !this.taken) this.paid = false;
    if (!canTakes(can, this.fluid)) return refused;
    const room = can.capacity - can.litres;
    if (room <= CAN_FULL_EPSILON) return refused;
    const litres = this.dispense(ctx.world, Math.min(PUMP_RATE * dt, room));
    if (litres <= 0) return refused;
    fillCan(can, this.fluid, litres);
    return { sound: null, continuous: 'pour' };
  }

  follow(x: number, y: number, z: number, dx: number, dz: number): boolean {
    // Into the pump's own frame, as `aim` does.
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const rx = x - this.x;
    const rz = z - this.z;
    _point.set(c * rx - s * rz, y - this.y, s * rx + c * rz);
    if (_point.distanceTo(OUTLET) > HOSE_REACH_M) return false;
    const yawInHand = Math.atan2(-(c * dx - s * dz), -(s * dx + c * dz));
    if (this.taken && _point.distanceToSquared(this.end) < 1e-6 && Math.abs(yawInHand - this.yawInHand) < 1e-3) return true;
    this.taken = true;
    this.end.copy(_point);
    this.yawInHand = yawInHand;
    this.dirty = true;
    return true;
  }

  canPour(world: GameWorld): boolean {
    return this.paid || world.state.player.shells >= this.price;
  }

  dispense(world: GameWorld, litres: number): number {
    if (litres <= POUR_EPSILON) return 0;
    if (!this.paid) {
      if (!debit(world, this.price)) return 0;
      this.paid = true;
    }
    return litres;
  }

  hangUp(): void {
    this.taken = false;
    this.paid = false;
    this.end.copy(HOLSTER);
    this.dirty = true;
  }

  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.nozzle.position.copy(this.end);
    if (this.taken) this.nozzle.rotation.set(-0.35, this.yawInHand, 0);
    else this.nozzle.rotation.set(-Math.PI / 2, 0, 0);
    // The chunk froze every matrix when it was placed (world/chunks.ts `freezeStaticSubtree`).
    this.nozzle.updateMatrix();
    layHose(this.hose.geometry, OUTLET, this.end, this.islandX, this.ground);
  }
}
