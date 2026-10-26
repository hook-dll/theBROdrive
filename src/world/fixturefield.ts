import type { FoleyContinuous, FoleyEvent } from '../audio/foley';
import type { DeliveryProbe } from '../contracts/types';
import type { GameWorld } from '../game/state';
import type { Inventory, Item } from '../items/items';
import type { FixedGridView } from '../vehicle/trunk';
import type { PumpNozzle } from './pumps';

/**
 * WORLD FIXTURES: the mechanical things the world stands in reach — a post machine's
 * selector wheel and lever, a pump and its nozzle, a car lot's key box. Each one aims,
 * prompts and acts through itself, so `Interaction` (player/interaction.ts) knows
 * nothing about what it is: it casts the eye ray at every registered fixture, keeps
 * the nearest hit like any other target, asks it for its prompt, and hands it the F
 * edge (`press`) and F held (`hold`).
 *
 * Fixtures are streamed with the chunks that build them, like the market's machines
 * (world/market.ts): a builder registers its fixtures and returns their ids for the
 * chunk's `dispose` to `forget`. Positions are ABSOLUTE world metres; `aim` is handed
 * the floating origin to compare them with the physics-frame eye.
 *
 * A fixture is free to aim at several parts of itself (a wheel, a lever, a door): it
 * remembers which part its last `aim` hit and answers `prompt` / `press` for that one.
 */
export interface FixtureContext {
  readonly world: GameWorld;
  readonly inventory: Inventory;
  /** The item in the hands, or null. */
  readonly held: Item | null;
  /**
   * Takes `rubles` from the player's money while a machine is being worked; false, and
   * nothing taken, when none is or the money is short.
   */
  debit(rubles: number): boolean;
  /** Pays `rubles` into the player's money (economy/economy.ts `credit`). */
  credit(rubles: number): void;
  /** Takes an item out of the hands (or the pack) by id. */
  give(itemId: string): Item | null;
  /**
   * Lets go of the machine being worked (player/machinefocus.ts): the camera steps back
   * so the player sees what the machine did out in the world (a key in a drawer, a haul's
   * load in its slot).
   */
  stepBack(): void;
  /**
   * The delivery-time world at post `postIndex`, its haul place at ABSOLUTE (`x`, `z`)
   * (contracts/types.ts). Reused in place: valid only for the call that asked.
   */
  probe(postIndex: number, x: number, z: number): DeliveryProbe;
  /** Rubles a race win adds for handing contract `contractId` in now (contracts/race.ts). */
  racePay(contractId: string): number;
  /**
   * Puts the player's car `carId` into the toy box (`car_box`), its live body's fuel,
   * wear and pose written to its `CarState` first. The caller has checked it may go
   * (world/toybox.ts `boxRefusal`).
   */
  boxCar(carId: string): void;
  /** The pump nozzle in the player's hand (world/pumps.ts), or null. */
  readonly nozzle: PumpNozzle | null;
  /** Puts `nozzle` in the player's hand, hanging any other back first; null hangs it back. */
  takeNozzle(nozzle: PumpNozzle | null): void;
  /** A one-line message on the HUD. */
  toast(text: string): void;
}

/** What one tick of F held on a fixture did. */
export interface FixtureHoldResult {
  readonly sound: FoleyEvent | null;
  readonly continuous: FoleyContinuous;
}

export interface WorldFixture {
  /** Unique while registered. */
  readonly id: string;
  /**
   * Distance along the eye ray to the nearest part of it, metres, or Infinity for a
   * miss. The eye is in the physics frame: absolute = eye + origin.
   */
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
  ): number;
  /** The prompt for the part the last `aim` hit, or null. */
  prompt(ctx: FixtureContext): string | null;
  /** The F edge on the part the last `aim` hit; the sound it makes, or null. */
  press(ctx: FixtureContext): FoleyEvent | null;
  /** F held on it, every fixed tick after the press; omitted for press-only fixtures. */
  hold?(ctx: FixtureContext, dt: number, first: boolean): FixtureHoldResult | null;
  /** Per-frame animation (a lever swinging back, a door easing); omitted when static. */
  update?(dt: number): void;
  /**
   * A machine worked UP CLOSE (world/cardmachine.ts): F on it frames it in the camera
   * and frees the cursor (player/machinefocus.ts), and from then on the cursor's ray is
   * the eye ray `aim` is handed, a click is F, and a drag works `grab`/`drag`. Omitted
   * for a fixture F works from where the player stands.
   */
  focus?(): FixtureFocus;
  /** The machine is framed (true) or let go of (false); its prompts say "click", not F. */
  setFocused?(focused: boolean, ctx: FixtureContext): void;
  /**
   * Mouse down while framed, with the cursor ray (as `aim`'s). True when a part takes
   * the hand (a card machine's wheel): the drag then goes to `drag`, and the click is not a press.
   */
  grab?(originX: number, originZ: number, eyeX: number, eyeY: number, eyeZ: number, dx: number, dy: number, dz: number): boolean;
  /** The axle the held part turns round, ABSOLUTE metres: the drag is read round it on screen. */
  pivot?(): { x: number; y: number; z: number };
  /** The held part turned by `turn` radians, clockwise as the screen shows it; the sound, or null. */
  drag?(turn: number): FoleyEvent | null;
  /** The mouse let go of the held part; the sound it made, or null. */
  release?(): FoleyEvent | null;
  /** Mouse-wheel notches while framed (positive: the next card); the sound, or null. */
  scroll?(notches: number): FoleyEvent | null;
  /** The cursor to show over the part the last `aim` hit while framed, or null for the arrow. */
  cursor?(): 'grab' | 'grabbing' | 'pointer' | null;
  /**
   * The machine's cell grid while it is framed, for the renderer to draw as a boot's
   * (world/cardmachine.ts, render/trunkview.ts `updateFixed`); omitted for a fixture
   * with none. Read every frame: the object may be reused in place.
   */
  grid?(): FixedGridView | null;
}

/** Where the camera stands to work a machine: ABSOLUTE metres and a field of view. */
export interface FixtureFocus {
  readonly eyeX: number;
  readonly eyeY: number;
  readonly eyeZ: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly lookZ: number;
  /** Vertical field of view, degrees. */
  readonly fov: number;
}

/** The fixtures live in the physics band, keyed by id. */
export class FixtureField {
  private readonly fixtures = new Map<string, WorldFixture>();

  register(fixture: WorldFixture): string {
    this.fixtures.set(fixture.id, fixture);
    return fixture.id;
  }

  forget(ids: readonly string[]): void {
    for (const id of ids) this.fixtures.delete(id);
  }

  get(id: string): WorldFixture | null {
    return this.fixtures.get(id) ?? null;
  }

  values(): IterableIterator<WorldFixture> {
    return this.fixtures.values();
  }

  update(dt: number): void {
    for (const fixture of this.fixtures.values()) fixture.update?.(dt);
  }
}

/**
 * Distance along a ray (origin `o`, direction `d`, both in the box's frame) to an
 * axis-aligned box (centre `c`, half extents `h`), or Infinity for a miss or a box
 * behind the eye. The one slab test a fixture's `aim` needs for each of its parts.
 */
export function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
): number {
  let near = -Infinity;
  let far = Infinity;
  const slab = (o: number, d: number, c: number, h: number): boolean => {
    const lo = c - h - o;
    const hi = c + h - o;
    if (Math.abs(d) < 1e-9) return lo <= 0 && hi >= 0;
    let t0 = lo / d;
    let t1 = hi / d;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    if (t0 > near) near = t0;
    if (t1 < far) far = t1;
    return near <= far;
  };
  if (!slab(ox, dx, cx, hx) || !slab(oy, dy, cy, hy) || !slab(oz, dz, cz, hz)) return Infinity;
  if (far < 0) return Infinity;
  return Math.max(0, near);
}
