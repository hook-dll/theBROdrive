import { contractThing, type Item } from '../items/items';
import { seatKind, type PlayerSeat, type SeatKind } from '../game/state';

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
 * A thing on a seat stays where it was laid, however the car is driven: hard driving
 * costs ride quality (trip/ride.ts), never the thing's place. The floor places hold
 * only what older saves left there when things could still slide off a seat; they are
 * taken from like any other place. A teddy passenger sits only on a seat of its own —
 * the front passenger's or a half of the bench — upright and facing forward (`SIT_ON`).
 *
 * The boy's things (items/things.ts) keep to where they ride (`cabinRule`): the carpet
 * in the cabin only across the whole rear bench (or rolled up in the boot), the cushions
 * on any seat they fit like anything else, and every other thing only in a boot.
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

/** The places with a seat under them: something on one bars sitting there. */
const SEAT_PLACES: readonly CabinPlace[] = ['seat', 'bench_l', 'bench_r', 'bench'];

/**
 * The places reached through a seat's door, by its kind, in the order something is laid
 * on them: a half of the bench before the whole of it. The driver's seat holds nobody's
 * luggage.
 */
const LAY_ON: Readonly<Record<SeatKind, readonly CabinPlace[]>> = {
  driver: [],
  passenger: ['seat'],
  'rear-left': ['bench_l', 'bench'],
  'rear-right': ['bench_r', 'bench'],
  // A front bench's middle (the ZIL-130's): its one place, the passenger's third beside it.
  middle: ['seat'],
};
/** And the places a thing is taken from through that door: seats first, then the floor. */
const TAKE_FROM: Readonly<Record<SeatKind, readonly CabinPlace[]>> = {
  driver: [],
  passenger: ['seat', 'floor_front'],
  'rear-left': ['bench_l', 'bench', 'floor_rear_l', 'floor_rear'],
  'rear-right': ['bench_r', 'bench', 'floor_rear_r', 'floor_rear'],
  middle: ['seat'],
};

/** The seats a place is reached from and sat on; the whole bench and rear floor answer to both. */
export function placeSeats(place: CabinPlace): readonly SeatKind[] {
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
  return SEAT_PLACES.some((place) => cabin[cabinIndex(place)] !== null && placeSeats(place).some((on) => on === seat));
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
 * How a thing may lie in the cabin: `lay`, on any place reached through a door that it
 * fits (`LAY_ON`); `passenger`, sat up on a seat of its own (`SIT_ON`); `bench`, only
 * across the whole rear bench (`BENCH_ONLY`).
 */
export type CabinRule = 'lay' | 'passenger' | 'bench';

/**
 * How `item` may lie in the cabin, or null for a thing that rides only in a boot
 * (game-design2.md §7.3): a teddy is a passenger, the carpet goes across the bench, the
 * cushions lie on a seat like any other item, and the rest of the boy's things keep to
 * the boot. A haul is no item (§7.8).
 */
export function cabinRule(item: Item): CabinRule | null {
  if (item.type !== 'contract_cargo') return 'lay';
  const thing = contractThing(item);
  switch (thing.place) {
    case 'seats':
      return 'passenger';
    case 'bench':
      return 'bench';
    case 'cells':
      return thing.seat ? 'lay' : null;
    default:
      return 'lay';
  }
}

/**
 * The places a PASSENGER (a teddy, contracts/kinds/teddyPassengers.ts) is sat on through
 * each door: a seat of its own, never the whole bench, the floor, the boot or the
 * driver's seat.
 */
const SIT_ON: Readonly<Record<SeatKind, readonly CabinPlace[]>> = {
  driver: [],
  passenger: ['seat'],
  'rear-left': ['bench_l'],
  'rear-right': ['bench_r'],
  middle: ['seat'],
};

/** The one place a bench-only thing (the carpet) lies, through either rear door. */
const BENCH_ONLY: Readonly<Record<SeatKind, readonly CabinPlace[]>> = {
  driver: [],
  passenger: [],
  'rear-left': ['bench'],
  'rear-right': ['bench'],
  middle: [],
};

/**
 * Where a thing in hand goes through `seat`'s door under its `rule`: the first place
 * reached from a seat of its kind that is free and fits, or why not. A `passenger` goes
 * only on a seat of its own (`SIT_ON`), sitting up and facing forward: unturned, or not at
 * all.
 */
export function layPlace(
  cabin: readonly (Item | null)[],
  rooms: CabinRooms,
  seat: PlayerSeat,
  bounds: ItemBounds,
  rule: CabinRule,
): { place: CabinPlace } | { refusal: string } {
  const passenger = rule === 'passenger';
  const kind = seatKind(seat);
  const places = passenger ? SIT_ON[kind] : rule === 'bench' ? BENCH_ONLY[kind] : LAY_ON[kind];
  if (places.length === 0) {
    if (passenger) return { refusal: 'passengers ride on a passenger seat' };
    return { refusal: rule === 'bench' ? 'it goes across the whole rear bench — through a rear door' : 'keep the driver\'s seat clear' };
  }
  let fitsSomewhere = false;
  for (const place of places) {
    const room = rooms[cabinIndex(place)];
    const fit = room ? layFit(bounds, room) : null;
    if (!fit || (passenger && fit.turned)) continue;
    fitsSomewhere = true;
    if (placeFree(cabin, place)) return { place };
  }
  if (!fitsSomewhere) {
    if (passenger) return { refusal: 'no seat for a passenger here' };
    if (rule === 'bench') return { refusal: 'it does not fit across this bench' };
    return { refusal: seat === 'passenger' ? 'too big for the front seat — try the back' : 'too big for the seat' };
  }
  return { refusal: rule === 'bench' ? 'clear the rear bench first' : 'there is something on the seat already' };
}

/** The place something is taken from through `seat`'s door, or null. */
export function takePlace(cabin: readonly (Item | null)[], seat: PlayerSeat): CabinPlace | null {
  return TAKE_FROM[seatKind(seat)].find((place) => cabin[cabinIndex(place)] !== null) ?? null;
}
