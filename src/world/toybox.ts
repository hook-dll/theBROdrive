import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FoleyEvent } from '../audio/foley';
import { isContractClosed } from '../contracts/registry';
import { postHaulPlace } from '../contracts/world';
import { carUniqueness } from '../economy/economy';
import { poseOnGround } from '../game/spawn';
import type { CarState, GameWorld, WorldState } from '../game/state';
import type { Item } from '../items/items';
import { carModelMeasure, carSpawnYAboveGround } from '../render/carmodel';
import { carModel, hasCarModel } from '../vehicle/carmodels';
import { TRAILER_BALL_Z, TRAILER_HALF_WIDTH } from '../vehicle/trailer';
import { trunkCellCount } from '../vehicle/trunk';
import { buildCardMachine, CardMachine, paintCardFace, registerCardMachineSigns, type CardMachineParts } from './cardmachine';
import type { ChunkContext } from './chunks';
import type { FixtureContext, FixtureField } from './fixturefield';
import { LAYBY_CAR_RANGE_M } from './post';
import type { PostStop } from './poststops';
import type { Terrain } from './terrain';

/**
 * THE TOY BOX (game-design2.md §13.4): the collection of the player's cars, a card
 * machine (world/cardmachine.ts) beside every post, toward its lay-by's middle.
 *
 * Its cards are the boxed cars (`WorldState.toyBox`), one each: the model, its comfort
 * and boot, its stickers and its fuel; the footer says what TAKE OUT will do with the
 * lay-by. TAKE OUT on a card:
 *  - the player's car standing within `LAYBY_CAR_RANGE_M` of the post's haul place (the
 *    one he last drove when it is there, else the nearest) goes into the box first
 *    (`FixtureContext.boxCar`), refused while it holds an active job's cargo (a broken
 *    souvenir goes in with it), a trailer or a tow bar (`boxRefusal`); with none there,
 *    nothing goes in;
 *  - the card's car comes out standing on the haul place, heading along the road, as it
 *    went in (fuel, wear, stickers, parts, its boot's own things), refused while another
 *    car or a trailer stands on the place (`spotBlocker`). It is the car the post reads
 *    when none stands on its lay-by from then on (`PlayerState.lastDrivenCarId`).
 *
 * A boxed car is out of the world: in `WorldState.toyBox`, not in `cars`, so nothing
 * streams it, draws it or counts it (`car_box`, `car_unbox`). Only the player's own
 * cars (`CarState.papers`) go in; a haul's car and a lot car never do.
 */

const TOYBOX_LOOK = {
  title: 'TOY BOX',
  body: 0x8a4a2a,
  buttonLabel: 'TAKE OUT',
  buttonColour: 0xc8902a,
} as const;
registerCardMachineSigns(TOYBOX_LOOK);

const CARD_BAND = '#8a4a2a';
const EMPTY_BAND = '#6b6355';
const REFUSED_BAND = '#7a3a2a';

/** Clear ground kept round the taken-out car on the haul place, m. */
const SPOT_MARGIN_M = 0.4;

/**
 * True when `car` carries an active contract thing (`isContractClosed` false), in its boot
 * or its cabin. A closed one — a broken souvenir, a teddy left from a returned party — is
 * the car's own thing now and goes into the box with it.
 */
export function carHoldsContract(car: CarState, completedIds: readonly string[]): boolean {
  const active = (item: Item | null): boolean => item?.type === 'contract_cargo' && !isContractClosed(item, completedIds);
  return car.storage.some(active) || car.cabin.some(active);
}

/**
 * Why the player's car `carId` may not go into the toy box now, or null when it may:
 * not his, sat in, holding contract cargo, or coupled to a trailer or a tow bar.
 */
export function boxRefusal(state: WorldState, carId: string): string | null {
  const car = state.cars[carId];
  if (!car?.papers) return 'only your own car goes in the box';
  const label = carModel(car.modelId).label;
  if (state.player.drivingCarId === carId) return `get out of the ${label} first`;
  if (carHoldsContract(car, state.completedContractIds)) return `take the jobs out of the ${label} first`;
  const coupled =
    (car.towedBy ?? null) !== null ||
    Object.values(state.cars).some((other) => other.towedBy === carId) ||
    Object.values(state.trailers).some((trailer) => trailer.hitchedTo === carId);
  if (coupled) return `unhitch the ${label} first`;
  return null;
}

/**
 * Builds stop `stop`'s toy box at ABSOLUTE (`x`, `z`) on the sand, its front turned by
 * `yaw` (front local -Z). In the physics band it is solid and registers its fixture (id
 * pushed to `registered`); beyond it, it is only seen. `disposers` gets the card materials.
 */
export function buildToyBox(
  ctx: ChunkContext,
  stop: PostStop,
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
  const parts = buildCardMachine(ctx, stop.s, x, z, yaw, TOYBOX_LOOK, group, bodies, colliders, disposers);
  const machine = new ToyBox(ctx.world, ctx.terrain, stop, postHaulPlace(ctx.world.seed, ctx.road, stop.index), parts);
  if (ctx.hasPhysics) registered.push(fixtures.register(machine));
}

/** Where a taken-out car stands: the post's haul place, ABSOLUTE metres, heading along the road. */
interface Spot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly s: number;
}

/** What TAKE OUT would do with the lay-by now: the car that goes in, or why nothing may. */
interface Swap {
  readonly inCarId: string | null;
  readonly refusal: string | null;
}

class ToyBox extends CardMachine {
  protected readonly title = 'TOY BOX';
  /** The boxed cars the cards show, in the box's order. */
  private boxed: string[] = [];
  /** The lay-by as last read (on focus, after a swap): the cards' footer. */
  private swap: Swap = { inCarId: null, refusal: null };

  constructor(
    private readonly world: GameWorld,
    private readonly terrain: Terrain,
    private readonly stop: PostStop,
    private readonly spot: Spot,
    parts: CardMachineParts,
  ) {
    super(`toybox:${stop.index}`, parts);
    this.boxed = Object.keys(world.state.toyBox);
    this.start();
  }

  protected cardCount(): number {
    // The empty box still shows a card: what it is for.
    return Math.max(1, this.boxed.length);
  }

  protected paintCard(g: CanvasRenderingContext2D, w: number, h: number, index: number): void {
    const car = this.world.state.toyBox[this.boxed[index] ?? ''];
    if (!car) {
      paintCardFace(g, w, h, {
        band: EMPTY_BAND,
        bandText: 'EMPTY',
        corner: '',
        headline: 'NO CARS IN THE BOX',
        lines: ['your bought cars wait in here', 'park yours on the lay-by,', 'take another one out'],
        footer: '',
      });
      return;
    }
    const model = carModel(car.modelId);
    const stickers = carUniqueness(car);
    const inCar = this.swap.inCarId ? this.world.state.cars[this.swap.inCarId] : undefined;
    paintCardFace(g, w, h, {
      band: this.swap.refusal ? REFUSED_BAND : CARD_BAND,
      bandText: 'IN THE BOX',
      corner: `${index + 1}/${this.boxed.length}`,
      headline: model.label,
      lines: [
        `comfort ${model.comfort} · boot ${trunkCellCount(model.trunkGrid)} cells`,
        `${stickers} sticker${stickers === 1 ? '' : 's'} · ${Math.round(car.fuelLitres)} l of fuel`,
        this.swap.refusal ?? (inCar ? `your ${carModel(inCar.modelId).label} goes in` : 'the lay-by is clear'),
      ],
      footer: this.swap.refusal ? 'TAKE OUT will not work now' : 'TAKE OUT: it stands on the lay-by',
    });
  }

  protected override onFocused(ctx: FixtureContext): void {
    this.refresh(ctx);
  }

  /** The box's cards and the lay-by's footer read again, and the window repainted. */
  private refresh(ctx: FixtureContext): void {
    this.boxed = Object.keys(this.world.state.toyBox);
    this.swap = this.readSwap(ctx);
    this.cardsChanged();
  }

  /**
   * The player's car on the lay-by (the one he last drove when it is there, else the
   * nearest within `LAYBY_CAR_RANGE_M` of the haul place), whether it may go in, and
   * whether the haul place is clear for the car coming out.
   */
  private readSwap(ctx: FixtureContext): Swap {
    const state = this.world.state;
    if (state.player.drivingCarId) return { inCarId: null, refusal: 'step out of the car first' };
    const probe = ctx.probe(this.stop.index, this.spot.x, this.spot.z);
    let inCarId: string | null = null;
    let best = LAYBY_CAR_RANGE_M * LAYBY_CAR_RANGE_M;
    for (const [carId, car] of Object.entries(state.cars)) {
      if (!car.papers) continue;
      const at = probe.carPosition(carId);
      if (!at) continue;
      const d2 = (at.x - this.spot.x) ** 2 + (at.z - this.spot.z) ** 2;
      if (d2 > LAYBY_CAR_RANGE_M * LAYBY_CAR_RANGE_M) continue;
      if (carId === this.world.state.player.lastDrivenCarId) {
        inCarId = carId;
        break;
      }
      if (d2 > best) continue;
      best = d2;
      inCarId = carId;
    }
    const refusal = inCarId ? boxRefusal(state, inCarId) : null;
    return { inCarId, refusal: refusal ?? this.spotBlocker(ctx, inCarId) };
  }

  /**
   * What stands on the haul place, leaving no room for a car to come out: any car but
   * `going` (the one that goes into the box), or a trailer. Each other body is taken as a
   * square of its half length, whichever way it stands; the room kept is the longest
   * and widest car in the box, so whichever card is turned to fits.
   */
  private spotBlocker(ctx: FixtureContext, going: string | null): string | null {
    const state = this.world.state;
    const probe = ctx.probe(this.stop.index, this.spot.x, this.spot.z);
    const sin = Math.sin(this.spot.yaw);
    const cos = Math.cos(this.spot.yaw);
    // The room a car needs: the longest the box holds, so no card is refused later.
    let halfLength = 0;
    let halfWidth = 0;
    for (const car of Object.values(state.toyBox)) {
      const half = carModelMeasure(car.modelId).halfExtents;
      halfLength = Math.max(halfLength, half[2]);
      halfWidth = Math.max(halfWidth, half[0]);
    }
    const blocks = (x: number, z: number, otherHalf: number, otherHalfWidth: number): boolean => {
      const dx = x - this.spot.x;
      const dz = z - this.spot.z;
      const along = dx * sin + dz * cos;
      const across = dx * cos - dz * sin;
      return Math.abs(along) < halfLength + otherHalf + SPOT_MARGIN_M && Math.abs(across) < halfWidth + otherHalfWidth + SPOT_MARGIN_M;
    };
    for (const [carId, car] of Object.entries(state.cars)) {
      if (carId === going || !hasCarModel(car.modelId)) continue;
      const at = probe.carPosition(carId);
      // Whichever way it stands: its half length both ways.
      const half = carModelMeasure(car.modelId).halfExtents[2];
      if (at && blocks(at.x, at.z, half, half)) return `the lay-by is taken: the ${carModel(car.modelId).label} stands on it`;
    }
    for (const trailerId of Object.keys(state.trailers)) {
      const at = probe.trailerPosition(trailerId);
      if (at && blocks(at.x, at.z, TRAILER_BALL_Z, Math.max(TRAILER_HALF_WIDTH, TRAILER_BALL_Z))) {
        return 'the lay-by is taken: a trailer stands on it';
      }
    }
    return null;
  }

  protected pressButton(ctx: FixtureContext, index: number): FoleyEvent {
    const outId = this.boxed[index];
    const out = outId ? this.world.state.toyBox[outId] : undefined;
    if (!outId || !out) return this.refuse();
    const swap = this.readSwap(ctx);
    if (swap.refusal) {
      ctx.toast(swap.refusal);
      this.swap = swap;
      this.cardsChanged();
      return this.refuse();
    }
    let boxedLabel: string | null = null;
    if (swap.inCarId) {
      const going = this.world.state.cars[swap.inCarId]!;
      ctx.boxCar(swap.inCarId);
      if (this.world.state.cars[swap.inCarId]) return this.refuse();
      boxedLabel = carModel(going.modelId).label;
    }
    this.world.apply({ t: 'car_unbox', carId: outId, ...this.standing(out) });
    const label = carModel(out.modelId).label;
    ctx.toast(boxedLabel ? `the ${boxedLabel} went into the box, the ${label} is out` : `the ${label} is out on the lay-by`);
    this.refresh(ctx);
    // Let go, so the player sees it standing there.
    ctx.stepBack();
    return 'mount';
  }

  /** The pose `car` comes out at: on the haul place, on its own wheels, in clear air over the ground. */
  private standing(car: CarState): { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number } {
    const { x, z, yaw, s } = this.spot;
    const measure = carModelMeasure(car.modelId);
    const plane = poseOnGround(measure.wheels, x, z, yaw, (gx, gz) => this.terrain.heightAt(gx, gz));
    const groundY = plane ? plane.groundY : this.terrain.heightAt(x, z, s);
    const y = carSpawnYAboveGround(measure, groundY);
    if (plane) return { x, y, z, qx: plane.qx, qy: plane.qy, qz: plane.qz, qw: plane.qw };
    return { x, y, z, qx: 0, qy: Math.sin(yaw / 2), qz: 0, qw: Math.cos(yaw / 2) };
  }
}
