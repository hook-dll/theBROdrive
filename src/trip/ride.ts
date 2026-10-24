import type { CarState } from '../game/state';
import { contractThing, isBrokenThing, type Item } from '../items/items';
import { hasTag } from '../items/things';

/**
 * RIDE QUALITY: how the car the player drives is pushing what it carries.
 *
 * Fed each fixed step by the composition root with that car's velocity and heading; it
 * keeps the smoothed horizontal acceleration in the car's own frame and accounts comfort
 * for whoever asked to be accounted. Nothing in the cabin moves because of it
 * (vehicle/cabin.ts): hard driving costs the ride, never a thing's place on the seat.
 *
 * Reading, live:
 * - `longitudinal`: m/s² along the nose, positive speeding up, negative braking;
 * - `lateral`: m/s² across the car, positive towards its LEFT (a left turn's centre);
 * - `magnitude`: the two together;
 * - `harshMoments` / `sinceHarsh`: harsh moments since the meter was made, and seconds
 *   since the last one began (Infinity before the first).
 *
 * Accounting, for contracts (teddy passengers). Keys are the caller's own, e.g. a
 * passenger party's id:
 * - `track(key, comfort?, harsh?, scale?)`: starts accounting under `key`, from the ride
 *   already had (full comfort, no harsh moment by default; no-op if tracked). `scale` is
 *   how much of the ride reaches it: the carrying car's comfort factor
 *   (vehicle/carmodels.ts `comfortFactor`), which scales its comfort drain and counts each
 *   harsh moment as that fraction of one;
 * - `comfort(key)`: 0..1, how the ride felt since `track`; 1 for an untracked key;
 * - `harsh(key)`: harsh moments since `track`, scaled; 0 for an untracked key;
 * - `tracking(key)`: whether `key` is tracked;
 * - `forget(key)`: stops accounting and drops the record.
 * A tracked key accumulates only on steps the composition root reports as the player
 * driving (`step`); on foot, as a passenger or in the title room nothing is added.
 * Runtime-only: a caller that must survive a reload keeps the reading on its own saved
 * state and seeds `track` with it (contracts/kinds/teddyPassengers.ts).
 *
 * For the things a contract carries (contracts/runtime.ts) `takeExcess()` hands over the
 * harshness driven since it was last asked, in (m/s² above easy) · seconds, and starts
 * a fresh count; the car it was driven in is the one the player drives now.
 *
 * The thresholds are the old trip record's: under `RIDE_EASY_MPS2` (pulling away, a
 * firm stop at a junction, a brisk bend) costs nothing; comfort drains with the excess
 * above it; a HARSH moment begins above `RIDE_HARSH_MPS2` and ends once the car is back
 * under the easy line.
 */

/** Horizontal acceleration a passenger notices, m/s². Above it, comfort drains. */
export const RIDE_EASY_MPS2 = 2.5;
/** A harsh moment begins above this, m/s² (0.36 g: a hard stop, a bend taken too fast). */
export const RIDE_HARSH_MPS2 = 3.5;
/** Comfort lost per (m/s² above easy) · second: a five-second 0.5 g stop costs about a fifth. */
const COMFORT_PER_EXCESS = 1 / 60;
/** Smoothing of the measured acceleration, seconds: a road seam is not a swerve. */
const ACCEL_SMOOTH_S = 0.25;
/**
 * One step's raw acceleration is clamped to this, m/s² (2 g): a crash still reads as
 * harsh, while a car set down by hand (a teleport, a reset) does not read as a 100 g
 * jolt that would take a smoothing window to drain.
 */
const ACCEL_CLAMP_MPS2 = 20;

interface RideRecord {
  comfortLoss: number;
  harsh: number;
  readonly scale: number;
}

export class RideMeter {
  longitudinal = 0;
  lateral = 0;
  magnitude = 0;
  harshMoments = 0;
  sinceHarsh = Infinity;
  private harshNow = false;
  private primed = false;
  private lastVx = 0;
  private lastVz = 0;
  private readonly records = new Map<string, RideRecord>();
  /** (m/s² above easy) · s since the last `takeExcess`. */
  private excess = 0;

  /**
   * One fixed step of the car the player drives: its horizontal world velocity, m/s, and
   * its heading (nose along (sin h, cos h), left along (cos h, -sin h)). The velocity is
   * differenced in the world frame and only then turned into the car's: differencing a
   * velocity already in the car's frame would read a steady bend as no push at all.
   */
  step(dt: number, vx: number, vz: number, heading: number): void {
    if (dt <= 0) return;
    this.sinceHarsh += dt;
    if (this.primed) {
      const k = Math.min(1, dt / ACCEL_SMOOTH_S);
      const ax = (vx - this.lastVx) / dt;
      const az = (vz - this.lastVz) / dt;
      const sinH = Math.sin(heading);
      const cosH = Math.cos(heading);
      const along = Math.max(-ACCEL_CLAMP_MPS2, Math.min(ACCEL_CLAMP_MPS2, ax * sinH + az * cosH));
      const across = Math.max(-ACCEL_CLAMP_MPS2, Math.min(ACCEL_CLAMP_MPS2, ax * cosH - az * sinH));
      this.longitudinal += (along - this.longitudinal) * k;
      this.lateral += (across - this.lateral) * k;
      this.magnitude = Math.hypot(this.longitudinal, this.lateral);
      const excess = Math.max(0, this.magnitude - RIDE_EASY_MPS2) * dt;
      this.excess += excess;
      const loss = excess * COMFORT_PER_EXCESS;
      let began = false;
      if (!this.harshNow && this.magnitude > RIDE_HARSH_MPS2) {
        this.harshNow = true;
        began = true;
        this.harshMoments++;
        this.sinceHarsh = 0;
      } else if (this.harshNow && this.magnitude < RIDE_EASY_MPS2) {
        this.harshNow = false;
      }
      if (loss > 0 || began) {
        for (const record of this.records.values()) {
          record.comfortLoss += loss * record.scale;
          if (began) record.harsh += record.scale;
        }
      }
    }
    this.primed = true;
    this.lastVx = vx;
    this.lastVz = vz;
  }

  /**
   * The player is not driving (on foot, a passenger, or just changed cars): the reading
   * falls to rest and the next `step` starts a fresh velocity history.
   */
  idle(): void {
    this.primed = false;
    this.harshNow = false;
    this.longitudinal = 0;
    this.lateral = 0;
    this.magnitude = 0;
  }

  track(key: string, comfort = 1, harsh = 0, scale = 1): void {
    if (!this.records.has(key)) this.records.set(key, { comfortLoss: 1 - comfort, harsh, scale });
  }

  /** The harshness driven since the last call, (m/s² above easy) · s; the count starts afresh. */
  takeExcess(): number {
    const excess = this.excess;
    this.excess = 0;
    return excess;
  }

  tracking(key: string): boolean {
    return this.records.has(key);
  }

  comfort(key: string): number {
    const record = this.records.get(key);
    return record ? Math.max(0, 1 - record.comfortLoss) : 1;
  }

  harsh(key: string): number {
    return this.records.get(key)?.harsh ?? 0;
  }

  forget(key: string): void {
    this.records.delete(key);
  }
}

/**
 * Whether a thing minds how it is driven: the HUD shows the G-force widget while the
 * driven car carries one. A fragile contract thing (not yet broken) or a teddy passenger.
 */
export function rideSensitive(item: Item | null | undefined): boolean {
  if (item?.type !== 'contract_cargo' || isBrokenThing(item)) return false;
  return item.thing === 'teddies' || hasTag(contractThing(item), 'fragile');
}

/** Something in `car`'s cabin or boot, or in the driver's own hands, is `rideSensitive`. */
export function carriesRideSensitive(car: CarState, hands: readonly Item[]): boolean {
  return car.cabin.some(rideSensitive) || car.storage.some(rideSensitive) || hands.some(rideSensitive);
}
