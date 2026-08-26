/**
 * The floating origin: the reason a 40 000 km road can be driven at all.
 *
 * THE PROBLEM IS PRECISION, NOT SIZE. The centreline random-walks, and walking it
 * out to 40 000 km puts it up to 386 km from (0, 0) — measured, seed 1337. Three.js
 * geometry positions are `Float32Array` and `@dimforge/rapier3d-compat` is the f32
 * build, and a float32 near 386 000 can only represent values 46 mm apart. Rapier's
 * ray-cast suspension does not measure a position, it measures the GAP between the
 * wheel mount and the ground — a small difference between two large numbers. Quantise
 * both to a 46 mm grid and a 200 mm suspension travel resolves into four steps: the
 * bumps and potholes we just spent so long tuning stop existing, and the body twitches
 * by up to a grid step per frame. It is the ride that breaks first, long before
 * anything looks wrong.
 *
 * THE FIX. Never let f32 hold a large coordinate. One f64 origin is kept near the
 * player and everything stored in f32 — mesh vertices, collider vertices, Rapier body
 * translations — holds a position RELATIVE to it. Only ±1200 m of world is ever alive,
 * so the largest number any f32 sees is about 2 km, where the step is 0.14 mm. That
 * holds at 40 000 km exactly as well as it holds at 400 m, which is the property worth
 * having: precision stops being a function of how far the player has driven.
 *
 * THREE FRAMES, AND EXACTLY ONE CONVERSION AT EACH BOUNDARY:
 *
 *  - ABSOLUTE (f64). The road, its spine and its distance field; the saved world
 *    state; and — load-bearing — EVERY noise field. Terrain height, dunes, outcrops
 *    and the road's own 2D bump noise are functions of world position, so they must go
 *    on being sampled at absolute coordinates. Sample them at rebased ones and the
 *    ground silently changes shape the first time the origin moves, which is the worst
 *    bug available here: it does not throw, and it only appears after a kilometre.
 *  - RELATIVE. Rapier and the scene graph. Everything in f32.
 *  - ARCLENGTH. Chunk indices, POIs, poles, monuments, road condition, the odometer.
 *    Immune: `s` is not a world coordinate and none of this cares where the origin is.
 *
 * WHEN IT MOVES. Only at a `REBASE_STEP` lattice point, and only once the anchor is
 * more than `REBASE_RADIUS` away. Snapping to a lattice rather than to the player
 * keeps the origin itself exactly representable and makes a rebase reproducible: two
 * sessions that reach the same place get the same origin, so a chunk rebuilt after a
 * reload is bit-identical to the one that was unloaded. Following the player
 * continuously would put a different rounding error in every rebuild.
 *
 * WHERE IT MOVES. Between the physics step and the post-step latches, so the camera,
 * the HUD and the save all observe one origin per frame. Never in the middle of a
 * `translation()`-then-`setTranslation()` pair: the trailer's hitch enforcement has a
 * 1.5 m drift guard, and a 1 km origin step landing inside that pair reads as the
 * trailer having teleported.
 */

/** Lattice the origin snaps to, metres. */
export const REBASE_STEP = 1000;
/**
 * How far the anchor may stray before the origin follows, metres.
 *
 * Bigger than `REBASE_STEP` on purpose. Equal to it, a player idling on a lattice
 * boundary would rebase every time they rolled a metre back and forth, and a rebase
 * is a pass over every live body and mesh. 1500 m gives half a kilometre of hysteresis
 * either side, so crossing back and forth costs nothing, while the largest coordinate
 * any f32 can hold stays about 2.7 km — a 0.32 mm step, three orders of magnitude
 * below the suspension travel it must not quantise.
 */
export const REBASE_RADIUS = 1500;

/** What a rebase moved, in metres. Both are whole multiples of `REBASE_STEP`. */
export interface RebaseShift {
  readonly dx: number;
  readonly dz: number;
}

/**
 * Something holding positions relative to the origin, which must be shifted when the
 * origin moves. Rapier bodies, cached world positions, anything in f32.
 *
 * Meshes and colliders belonging to streamed chunks deliberately do NOT implement
 * this: they are rebuilt from absolute road coordinates anyway, so the streamer drops
 * and rebuilds them instead, which is both simpler and exactly as correct.
 */
export interface Rebasable {
  /** Shift every relative position this owns by `-dx, -dz`. */
  rebase(shift: RebaseShift): void;
}

export class WorldOrigin {
  private ox = 0;
  private oz = 0;
  private readonly listeners: Rebasable[] = [];

  /** Absolute X of the current origin. Relative = absolute - this. */
  get x(): number {
    return this.ox;
  }

  /** Absolute Z of the current origin. */
  get z(): number {
    return this.oz;
  }

  /**
   * Registers something that must be shifted on every rebase. There is no removal:
   * the things that hold relative state across a rebase — the car, the trailer, the
   * player, the spray field — live for the whole session.
   */
  register(listener: Rebasable): void {
    this.listeners.push(listener);
  }

  /**
   * Places the origin at the lattice point nearest an absolute position, with no
   * hysteresis and no listener notification. For the one moment that has neither: world
   * setup, before anything holds a relative position at all.
   */
  reset(absX: number, absZ: number): void {
    this.ox = Math.round(absX / REBASE_STEP) * REBASE_STEP;
    this.oz = Math.round(absZ / REBASE_STEP) * REBASE_STEP;
  }

  /**
   * Moves the origin if `anchor` has strayed past `REBASE_RADIUS`, notifying every
   * listener, and reports the shift so the caller can drop what it cannot shift.
   * Returns null when nothing moved, which is almost every frame.
   */
  advance(absX: number, absZ: number): RebaseShift | null {
    const dxFromOrigin = absX - this.ox;
    const dzFromOrigin = absZ - this.oz;
    if (
      dxFromOrigin * dxFromOrigin + dzFromOrigin * dzFromOrigin <
      REBASE_RADIUS * REBASE_RADIUS
    ) {
      return null;
    }

    const nextX = Math.round(absX / REBASE_STEP) * REBASE_STEP;
    const nextZ = Math.round(absZ / REBASE_STEP) * REBASE_STEP;
    const shift: RebaseShift = { dx: nextX - this.ox, dz: nextZ - this.oz };
    if (shift.dx === 0 && shift.dz === 0) return null;

    this.ox = nextX;
    this.oz = nextZ;
    for (const listener of this.listeners) listener.rebase(shift);
    return shift;
  }
}
