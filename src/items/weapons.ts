import { hash01 } from '../core/rng';
import type { AmmoItem, Inventory, QuarryItem, WeaponItem, WeaponKind } from './items';

/**
 * Weapon firing logic. Pure logic: no Three.js, no Rapier, no audio. The caller
 * (the player controller) owns the render/audio/recoil side and reads the
 * discriminated result to drive it.
 *
 * The only coupling to the world is through the injected `flock` — an object with
 * `tryHit(...)`, which the `BirdFlock` satisfies structurally. Spread is sampled
 * deterministically from a per-controller shot counter, so a replay of the same
 * inputs produces the same trajectories without a shared RNG stream.
 */

/** A single bird struck by a shot. Position is the bird's centre at the moment of impact. */
export interface BirdHit {
  readonly species: string;
  readonly mass: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Structural view of a bird flock: exactly what firing needs, nothing more. */
export interface FlockLike {
  tryHit(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxRange: number,
  ): BirdHit | null;
}

export interface WeaponSpec {
  readonly kind: WeaponKind;
  /** Rounds a full magazine holds. */
  readonly magazine: number;
  /** Seconds between trigger pulls. */
  readonly cycleTime: number;
  /** Muzzle velocity in m/s. */
  readonly muzzleVelocity: number;
  /** Spread half-angle in radians, fired from the hip. */
  readonly hipSpread: number;
  /** Spread half-angle in radians, aimed (tighter). */
  readonly aimedSpread: number;
  /** Projectiles per trigger pull. */
  readonly pellets: number;
  /** Effective range in metres; the ray test is cut off here. */
  readonly range: number;
}

/**
 * Concrete weapon stats. The rifle is one accurate round; the shotgun is a short,
 * wide cone of pellets. `range` is deliberately short for the shotgun because a
 * cloud of small shot loses energy fast.
 */
export const WEAPON_SPECS: Readonly<Record<WeaponKind, WeaponSpec>> = {
  rifle: {
    kind: 'rifle',
    magazine: 5,
    cycleTime: 0.55,
    muzzleVelocity: 850,
    hipSpread: 0.035,
    aimedSpread: 0.004,
    pellets: 1,
    range: 320,
  },
  shotgun: {
    kind: 'shotgun',
    magazine: 2,
    cycleTime: 0.85,
    muzzleVelocity: 380,
    hipSpread: 0.11,
    aimedSpread: 0.05,
    pellets: 8,
    range: 45,
  },
};

export function createRifle(id: string): WeaponItem {
  const s = WEAPON_SPECS.rifle;
  return {
    type: 'weapon',
    id,
    weapon: 'rifle',
    loaded: s.magazine,
    magazine: s.magazine,
    cycleTime: s.cycleTime,
    muzzleVelocity: s.muzzleVelocity,
    hipSpread: s.hipSpread,
  };
}

export function createShotgun(id: string): WeaponItem {
  const s = WEAPON_SPECS.shotgun;
  return {
    type: 'weapon',
    id,
    weapon: 'shotgun',
    loaded: s.magazine,
    magazine: s.magazine,
    cycleTime: s.cycleTime,
    muzzleVelocity: s.muzzleVelocity,
    hipSpread: s.hipSpread,
  };
}

export function createAmmo(id: string, forWeapon: WeaponKind, count: number): AmmoItem {
  return { type: 'ammo', id, forWeapon, count };
}

export type FireResult =
  | { readonly result: 'fired'; readonly hit: BirdHit | null; readonly quarry: QuarryItem | null }
  | { readonly result: 'empty' }
  | { readonly result: 'cooldown' };

/** Monotonic id source for quarry items; uniqueness, not seed-determinism, is what matters. */
let quarryCounter = 0;

export class WeaponController {
  private cooldownRemaining = 0;
  private shotIndex = 0;

  /**
   * Attempt to fire one trigger pull.
   *
   * `inventory` is passed through for API symmetry but is intentionally unused:
   * reloading is `reload(...)`, and a kill must NOT mutate the inventory here so
   * the caller can refuse the quarry when it would exceed the mass limit.
   */
  tryFire(
    weapon: WeaponItem,
    aiming: boolean,
    eyeOrigin: { readonly x: number; readonly y: number; readonly z: number },
    eyeDirection: { readonly x: number; readonly y: number; readonly z: number },
    flock: FlockLike,
    _inventory: Inventory,
    dt: number,
  ): FireResult {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    if (this.cooldownRemaining > 0) return { result: 'cooldown' };
    if (weapon.loaded <= 0) return { result: 'empty' };

    const spec = WEAPON_SPECS[weapon.weapon];
    const spread = aiming ? spec.aimedSpread : spec.hipSpread;

    // Normalise the aim direction, then build an orthonormal basis (u, v) so the
    // spread cone can be sampled around any direction.
    let bx = eyeDirection.x;
    let by = eyeDirection.y;
    let bz = eyeDirection.z;
    const len = Math.hypot(bx, by, bz);
    if (len < 1e-6) {
      // Degenerate aim: burn the round without a meaningful direction.
      this.consumeShot(weapon, spec.cycleTime);
      return { result: 'fired', hit: null, quarry: null };
    }
    bx /= len;
    by /= len;
    bz /= len;

    let hx = 0;
    let hy = 1;
    let hz = 0;
    if (Math.abs(by) > 0.99) {
      hx = 1;
      hy = 0;
      hz = 0;
    }
    // u = normalize(h × dir), v = dir × u — both unit and perpendicular to dir.
    let ux = hy * bz - hz * by;
    let uy = hz * bx - hx * bz;
    let uz = hx * by - hy * bx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = by * uz - bz * uy;
    const vy = bz * ux - bx * uz;
    const vz = bx * uy - by * ux;

    let best: BirdHit | null = null;
    let bestDistSq = Infinity;

    for (let p = 0; p < spec.pellets; p++) {
      // Deterministic-but-varied cone sample: same shot index always yields the
      // same pellet, but every pull (and every pellet of a shotgun) differs.
      const key = this.shotIndex++;
      const phi = hash01(key, 0x51ab) * Math.PI * 2;
      const theta = Math.atan(Math.sqrt(hash01(key, 0x73cd)) * Math.tan(spread));
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      const cp = Math.cos(phi);
      const sp2 = Math.sin(phi);
      const ddx = bx * ct + (ux * cp + vx * sp2) * st;
      const ddy = by * ct + (uy * cp + vy * sp2) * st;
      const ddz = bz * ct + (uz * cp + vz * sp2) * st;

      const hit = flock.tryHit(eyeOrigin.x, eyeOrigin.y, eyeOrigin.z, ddx, ddy, ddz, spec.range);
      if (hit) {
        const dx = hit.x - eyeOrigin.x;
        const dy = hit.y - eyeOrigin.y;
        const dz = hit.z - eyeOrigin.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          best = hit;
        }
      }
    }

    this.consumeShot(weapon, spec.cycleTime);

    let quarry: QuarryItem | null = null;
    if (best) {
      quarryCounter += 1;
      quarry = {
        type: 'quarry',
        id: `quarry:${quarryCounter.toString(36)}`,
        species: best.species,
        mass: best.mass,
      };
    }
    return { result: 'fired', hit: best, quarry };
  }

  private consumeShot(weapon: WeaponItem, cycleTime: number): void {
    weapon.loaded -= 1;
    this.cooldownRemaining = cycleTime;
  }

  /** Consume matching ammo up to the magazine capacity. Returns rounds actually loaded. */
  reload(weapon: WeaponItem, inventory: Inventory): number {
    const need = weapon.magazine - weapon.loaded;
    if (need <= 0) return 0;

    // Snapshot matching stacks first; removing an emptied stack mutates the
    // inventory's backing array, which would be unsafe to do mid-iteration.
    const stacks: AmmoItem[] = [];
    for (const item of inventory.all) {
      if (item.type === 'ammo' && item.forWeapon === weapon.weapon) stacks.push(item);
    }

    let available = 0;
    for (const s of stacks) available += s.count;
    const take = Math.min(need, available);
    if (take <= 0) return 0;

    let remaining = take;
    for (const s of stacks) {
      if (remaining <= 0) break;
      const use = Math.min(s.count, remaining);
      s.count -= use;
      remaining -= use;
    }
    weapon.loaded += take;

    for (const s of stacks) {
      if (s.count <= 0) inventory.remove(s.id);
    }
    return take;
  }
}
