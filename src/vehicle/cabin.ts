import type { Item } from '../items/items';
import type { PlayerSeat } from '../game/state';

/**
 * CARGO IN THE CABIN: things laid on the front passenger seat, on the rear bench or on
 * the floor in front of them, beside the boot's cells.
 *
 * Every kit car has the same places, because every kit cabin is built from the same
 * seats and bench (carkit/interior.ts): the front passenger's cushion, the bench's two
 * halves or the whole of it, and the floor in front of each. Each place is an empty
 * node in the built car (`KIT_PLACE_NODE`) whose frame is the surface it stands on and
 * whose `userData.kitPlace` is the room over it, checked clear of every other part of
 * the cabin (tools/cabin-places.ts). An item lies on a place only if its bounds fit that
 * room, so nothing laid in the cabin ever stands in a seat.
 *
 * A thing on a seat can come off it: braking hard pushes it forward off the cushion
 * onto the floor in front, a hard turn pushes it off the front seat sideways or across
 * the bench (`CabinRide`). The floor is where it stays.
 *
 * Pure: no three.js. The view is vehicle/cabincargo.ts.
 */

export const CABIN_PLACES = [
  'seat',
  'bench_l',
  'bench_r',
  'bench',
  'floor_front',
  'floor_rear_l',
  'floor_rear_r',
  'floor_rear',
] as const;
export type CabinPlace = (typeof CABIN_PLACES)[number];
export const CABIN_PLACE_COUNT = CABIN_PLACES.length;

export function cabinIndex(place: CabinPlace): number {
  return CABIN_PLACES.indexOf(place);
}

/** A cabin with nothing in it. */
export function emptyCabin(): (Item | null)[] {
  return new Array<Item | null>(CABIN_PLACE_COUNT).fill(null);
}

/** A place spanning two others: something on it takes both, and either taken bars it. */
const SPANS: Partial<Record<CabinPlace, readonly CabinPlace[]>> = {
  bench: ['bench_l', 'bench_r'],
  floor_rear: ['floor_rear_l', 'floor_rear_r'],
};

/** Where a thing goes when it comes off a seat: the floor in front of it. */
export const FALLS_TO: Partial<Record<CabinPlace, CabinPlace>> = {
  seat: 'floor_front',
  bench_l: 'floor_rear_l',
  bench_r: 'floor_rear_r',
  bench: 'floor_rear',
};

/** The places with a seat under them, which a push can empty. */
export const SEAT_PLACES: readonly CabinPlace[] = ['seat', 'bench_l', 'bench_r', 'bench'];

/**
 * The places reached through a seat's door, in the order something is laid on them:
 * a half of the bench before the whole of it. The driver's seat holds nobody's luggage.
 */
const LAY_ON: Readonly<Record<PlayerSeat, readonly CabinPlace[]>> = {
  driver: [],
  passenger: ['seat'],
  'rear-left': ['bench_l', 'bench'],
  'rear-right': ['bench_r', 'bench'],
};
/** And the places a thing is taken from through that door: seats first, then the floor. */
const TAKE_FROM: Readonly<Record<PlayerSeat, readonly CabinPlace[]>> = {
  driver: [],
  passenger: ['seat', 'floor_front'],
  'rear-left': ['bench_l', 'bench', 'floor_rear_l', 'floor_rear'],
  'rear-right': ['bench_r', 'bench', 'floor_rear_r', 'floor_rear'],
};

/** The seat a place is reached from and sat on; the whole bench and rear floor answer to both. */
export function placeSeats(place: CabinPlace): readonly PlayerSeat[] {
  switch (place) {
    case 'seat':
    case 'floor_front':
      return ['passenger'];
    case 'bench_l':
    case 'floor_rear_l':
      return ['rear-left'];
    case 'bench_r':
    case 'floor_rear_r':
      return ['rear-right'];
    case 'bench':
    case 'floor_rear':
      return ['rear-left', 'rear-right'];
  }
}

/** Nothing on `place` and nothing on a place overlapping it. */
export function placeFree(cabin: readonly (Item | null)[], place: CabinPlace): boolean {
  if (cabin[cabinIndex(place)]) return false;
  const spans = SPANS[place];
  if (spans && spans.some((part) => cabin[cabinIndex(part)])) return false;
  for (const [whole, parts] of Object.entries(SPANS) as [CabinPlace, readonly CabinPlace[]][]) {
    if (parts.includes(place) && cabin[cabinIndex(whole)]) return false;
  }
  return true;
}

/** Something lies on the seat itself (not the floor in front of it), so nobody can sit there. */
export function seatTaken(cabin: readonly (Item | null)[], seat: PlayerSeat): boolean {
  return SEAT_PLACES.some((place) => cabin[cabinIndex(place)] !== null && placeSeats(place).includes(seat));
}

/**
 * The room over a place in metres, in the place's own frame: x across the car, y up
 * from the surface, z forward. A thing is laid against the back (z = -halfZ) and may
 * stand out over the front edge by `overhang`.
 */
export interface PlaceRoom {
  readonly halfX: number;
  readonly halfZ: number;
  readonly height: number;
  readonly overhang: number;
}

/** A thing's bounds as it is drawn, metres, unturned: x across, y up, z along. */
export interface ItemBounds {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * How a thing lies on a place: `turned` when its own x runs along the car. Null when it
 * fits neither way. The longer side across first: on a bench that is how a thing lies.
 */
export function layFit(bounds: ItemBounds, room: PlaceRoom): { turned: boolean } | null {
  if (bounds.y > room.height) return null;
  const fits = (across: number, along: number): boolean =>
    across <= room.halfX * 2 && along <= room.halfZ * 2 + Math.min(room.overhang, along * 0.3);
  const acrossFirst = bounds.x >= bounds.z;
  for (const turned of acrossFirst ? [false, true] : [true, false]) {
    if (turned ? fits(bounds.z, bounds.x) : fits(bounds.x, bounds.z)) return { turned };
  }
  return null;
}

/** What the composition root knows of one car's cabin, by place: its room, or null where the car has none. */
export type CabinRooms = readonly (PlaceRoom | null)[];

/**
 * Where a thing in hand goes through `seat`'s door: the first place reached from it
 * that is free and fits, or why not.
 */
export function layPlace(
  cabin: readonly (Item | null)[],
  rooms: CabinRooms,
  seat: PlayerSeat,
  bounds: ItemBounds,
): { place: CabinPlace } | { refusal: string } {
  const places = LAY_ON[seat];
  if (places.length === 0) return { refusal: 'keep the driver\'s seat clear' };
  let fitsSomewhere = false;
  for (const place of places) {
    const room = rooms[cabinIndex(place)];
    if (!room || !layFit(bounds, room)) continue;
    fitsSomewhere = true;
    if (placeFree(cabin, place)) return { place };
  }
  if (!fitsSomewhere) return { refusal: seat === 'passenger' ? 'too big for the front seat — try the back' : 'too big for the seat' };
  return { refusal: 'there is something on the seat already' };
}

/** The place something is taken from through `seat`'s door, or null. */
export function takePlace(cabin: readonly (Item | null)[], seat: PlayerSeat): CabinPlace | null {
  return TAKE_FROM[seat].find((place) => cabin[cabinIndex(place)] !== null) ?? null;
}

/**
 * How hard the car must push before a thing on a seat comes off, m/s², from how it
 * sits: a box slides on the cloth at `SLIDE_GRIP` g, and a tall one tips first, once the
 * push turns its weight over its edge (half its base over half its height, in g).
 */
const SLIDE_GRIP = 0.4;
const G = 9.81;
export function slipAt(bounds: ItemBounds, along: boolean): number {
  const base = along ? bounds.z : bounds.x;
  return G * Math.min(SLIDE_GRIP, base / Math.max(1e-3, bounds.y));
}

/** Smoothing of the push, seconds: a pothole's jolt is no shove. */
const PUSH_SMOOTH_S = 0.3;
/** After a thing has come off or knocked about, the push must ease below this share of the limit before it can again. */
const SLIP_RESET = 0.6;

/** One thing coming off its place: where it went (null: wedged where it was, knocked). */
export interface CabinSlip {
  readonly from: CabinPlace;
  readonly to: CabinPlace | null;
  readonly item: Item;
}

/**
 * The push on the things on the seats of the car the player drives, fed each fixed
 * step with the car's horizontal velocity in its own frame (x to the car's left, z
 * forward), and the moves it makes. Pure; the composition root applies the moves.
 */
export class CabinRide {
  private lastX = 0;
  private lastZ = 0;
  private primed = false;
  /** Smoothed acceleration in the car's frame. */
  private ax = 0;
  private az = 0;
  /** Places whose thing is waiting for the push to ease (`SLIP_RESET`). */
  private readonly spent = new Set<CabinPlace>();

  /** Forget the last velocity: the car changed, or it was moved by hand. */
  reset(): void {
    this.primed = false;
    this.ax = 0;
    this.az = 0;
    this.spent.clear();
  }

  /**
   * One step. `bounds(item)` is a thing's drawn size, `rooms` the car's places. Returns
   * the slips this step, with the cabin left for the caller to change.
   */
  step(
    dt: number,
    vx: number,
    vz: number,
    cabin: readonly (Item | null)[],
    rooms: CabinRooms,
    bounds: (item: Item) => ItemBounds,
    out: CabinSlip[],
  ): void {
    out.length = 0;
    if (dt <= 0) return;
    if (this.primed) {
      const k = Math.min(1, dt / PUSH_SMOOTH_S);
      this.ax += ((vx - this.lastX) / dt - this.ax) * k;
      this.az += ((vz - this.lastZ) / dt - this.az) * k;
    }
    this.primed = true;
    this.lastX = vx;
    this.lastZ = vz;
    // What the car does to the things in it is the opposite of its own acceleration:
    // braking (az < 0) throws them forward.
    const forward = -this.az;
    const sideways = -this.ax;
    const taken = cabin.slice();
    for (const from of SEAT_PLACES) {
      const item = taken[cabinIndex(from)];
      if (!item) {
        this.spent.delete(from);
        continue;
      }
      const room = rooms[cabinIndex(from)];
      const size = bounds(item);
      const turned = room ? layFit(size, room)?.turned ?? false : false;
      const footprint: ItemBounds = turned ? { x: size.z, y: size.y, z: size.x } : size;
      const ahead = forward / slipAt(footprint, true);
      // Sideways only matters where there is an edge to go over: the front seat's, or
      // across to the other half of the bench. The whole bench is held by both doors.
      const across = from === 'bench' ? 0 : Math.abs(sideways) / slipAt(footprint, false);
      const push = Math.max(ahead, across);
      if (this.spent.has(from)) {
        if (push < SLIP_RESET) this.spent.delete(from);
        continue;
      }
      if (push < 1) continue;
      this.spent.add(from);
      let to: CabinPlace | null = null;
      if (ahead >= across) {
        to = FALLS_TO[from] ?? null;
      } else if (from === 'seat') {
        to = 'floor_front';
      } else {
        // +x is the car's left: a push to the left carries the right half's thing over.
        const other: CabinPlace = from === 'bench_l' ? 'bench_r' : 'bench_l';
        const towards = sideways > 0 ? 'bench_l' : 'bench_r';
        to = towards === other ? other : null;
      }
      if (to !== null) {
        const room = rooms[cabinIndex(to)];
        taken[cabinIndex(from)] = null;
        if (!room || !layFit(size, room) || !placeFree(taken, to)) {
          taken[cabinIndex(from)] = item;
          to = null;
        } else {
          taken[cabinIndex(to)] = item;
          // Moved to another seat: it may slip again from there once the push eases.
          if (SEAT_PLACES.includes(to)) this.spent.add(to);
        }
      }
      out.push({ from, to, item });
    }
  }
}
