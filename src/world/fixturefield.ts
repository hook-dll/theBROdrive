import type { FoleyContinuous, FoleyEvent } from '../audio/foley';
import type { GameWorld } from '../game/state';
import type { Inventory, Item } from '../items/items';

/**
 * WORLD FIXTURES: the mechanical things the world stands in reach — a post machine's
 * selector wheel and lever, a fluid barrel's tap, a car lot's key box. Each one aims,
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
  /** Coins in the pack. */
  coins(): number;
  /** Takes `amount` coins from the pack; false (and nothing taken) when short. */
  spend(amount: number): boolean;
  /** Puts an item in the hands; false when they are full. */
  take(item: Item): boolean;
  /** Takes an item out of the hands (or the pack) by id. */
  give(itemId: string): Item | null;
  /** Lets a real loose item fall at an ABSOLUTE world point (a tray, a drawer). */
  drop(item: Item, x: number, y: number, z: number): void;
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
