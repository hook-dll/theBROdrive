import { hash } from '../core/rng';
import type { FluidKind, Item, StickerKind, SunShadesItem } from '../items/items';
import type { PartInstance } from '../parts/registry';
import type { ContractKind } from '../contracts/types';
import { AIR_FILTER_CELL, bonnetAccepts, bonnetSlotFluid, BONNET_SLOT_COUNT } from '../vehicle/bonnet';
import type { CarPaint } from '../vehicle/carpaint';
import { DEFAULT_SETTINGS } from './settings';
import { localSolarDateAt } from './calendar';
import type { Settings } from './settings';
import type { KitMirror } from '../carkit/names';

/** Where a car's state keeps each mirror's hand-set aim (`car_mirror`). */
export const MIRROR_FIELD = {
  inner: 'innerMirror',
  left: 'leftMirror',
  right: 'rightMirror',
} as const satisfies Readonly<Record<KitMirror, string>>;

/**
 * Authoritative, serialisable game state, plus the single API for mutating it.
 *
 * Two rules make this file load-bearing:
 *  1. Procedural content is never stored. The world is a function of `seed`, so
 *     state holds only what the player *changed*. Saves stay a few kB after hours.
 *  2. Every mutation goes through `apply(delta)`. Saving snapshots the state;
 *     multiplayer would replay the deltas. One layer, written once.
 *
 * Nothing here may reference a Three.js object or a Rapier handle.
 */

/** Fractions written by both an accumulating simulation and a cleaning tool. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * A sticker on a car's bodywork: the record of one completed haul.
 *
 * Position and normal are in the car's own local space, taken from where the player
 * aimed on the actual mesh, so it survives a save and stays exactly where it was
 * put. There is deliberately no removal delta — a sticker cannot be scratched off,
 * and it does not follow the player to another car. The car IS the save file.
 */
export interface StickerState {
  /** Physical envelope id consumed to create this permanent decal. */
  readonly id: string;
  /** Sticker design id, from the built-in pack. */
  readonly kind: StickerKind;
  /** Contact point, car-local metres. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Surface normal at the contact point, car-local and unit length. */
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  /** Spin about the normal, radians, from where the player was standing. */
  readonly roll: number;
  /** Size against the catalog's, STICKER_SCALE_MIN..MAX; absent on older saves = 1. */
  readonly scale?: number;
  /** Printed mirror-image (flipped left to right); absent on older saves = false. */
  readonly mirror?: boolean;
}

export type HeadlightMode = 'off' | 'low' | 'high';


export interface CarState {
  readonly id: string;
  /** Complete car model id from the catalogue (vehicle/carmodels.ts). */
  readonly modelId: string;
  /** Earned stickers, in the order they were placed. Append-only, permanent. */
  readonly stickers: StickerState[];
  /** Dipped/high-beam selection, persisted independently of the day/night clock. */
  headlightMode: HeadlightMode;
  /** Last rendered tail-lamp state, including a brake-light flash. */
  taillightsOn: boolean;
  /** Last rendered reverse-lamp state. */
  reverseLightsOn: boolean;
  /**
   * The inside mirror's aim as the driver set it by hand (carkit `mirror_yaw`,
   * `mirror_pitch`, radians off the built aim). Absent: never touched.
   */
  innerMirror?: readonly [number, number];
  /** The door mirrors' hand-set aims (carkit `mirror_l_*`, `mirror_r_*`), as `innerMirror`. */
  leftMirror?: readonly [number, number];
  rightMirror?: readonly [number, number];
  fuelLitres: number;
  /**
   * Water in the radiator and oil in the engine, litres.
   *
   * Neither is consumed by driving the way fuel is. Oil SEEPS at a flat rate while
   * the engine runs; water is lost to the cap and the hoses, and much faster once
   * the engine is allowed to boil (see vehicle/cooling.ts). Water capacity belongs
   * to the FITTED RADIATOR (`bonnetWaterCapacity`), oil capacity to the engine's
   * cylinder count (`oilCapacity`), because that is what each one physically is.
   *
   * These live on the CAR, not on the container part, because the running engine is
   * what drains them. Detaching the container moves its share into the part (see the
   * `car_bonnet` delta) so nothing is lost by carrying it around.
   */
  waterLitres: number;
  oilLitres: number;
  /**
   * Coolant temperature, degrees Celsius.
   *
   * Persisted per car because it is real state, not a derived reading: a car parked
   * hot is still hot a minute later, and the engine that seized from overheating did
   * so because of a history the save has to carry. Live simulation lives in
   * `EngineCoolingSystem` and mirrors into here on the same throttled cadence as
   * fuel, so a number changing in the third decimal place does not write authority
   * three hundred times a second.
   */
  engineTempC: number;
  /**
   * Boot cells. `null` is an empty cell; the array's LENGTH is the car's capacity,
   * fixed at spawn from the model, so a save carries the layout it was created with.
   */
  readonly storage: (Item | null)[];
  /** Four fixed, typed service cells under the bonnet. */
  readonly bonnet: (Item | null)[];
  /**
   * What lies in the cabin, by place (vehicle/cabin.ts `CABIN_PLACES`): the front
   * passenger's seat, the rear bench and the floor in front of them.
   */
  readonly cabin: (Item | null)[];
  /**
   * Cosmetic body condition of the SHELL, 0..1 each, distinct from the per-part
   * `dirt`/`rust` a `PartInstance` carries: those describe a component that can be
   * removed and carried around, these describe the car.
   *
   * `dirt` is raised by driving — how fast depends on what the tyres are throwing
   * up (see `SURFACES[].dust`) — and taken off with the brush and sponge that
   * already clean parts. `scratches` are raised by impacts and polished off with
   * the sponge, all the way to zero. A respray (`paint`) changes the colour under
   * them, not their amount.
   */
  dirt: number;
  scratches: number;
  /**
   * A spray-can respray over the factory colour, or null for the colour the car
   * left the works in (vehicle/carpaint.ts).
   */
  paint: CarPaint | null;
  /** Metres travelled by this specific car. */
  odometer: number;
  /** Last known world transform, so a save restores it where it stood. */
  x: number;
  y: number;
  z: number;
  /** Quaternion. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /**
   * The car this one is coupled to as the TOWED end of a car-to-car tow bar, or
   * null/absent. There is no mirror field on the tower: the set of towers is
   * derived from the cars that are somebody's `towedBy`, exactly as a trailer's
   * `hitchedTo` names the car pulling it. Saved, and it IS the coupling — the live
   * Rapier joint is rebuilt from it whenever both cars are materialised
   * (vehicle/cartow.ts), so a reload puts the pair back on the bar.
   */
  towedBy?: string | null;
  /**
   * The player holds this car's papers: he bought it at a lot (`car_buy`), or it is the
   * car the drive started in. Absent or false: somebody else's car. The player's cars are
   * exactly the ones with papers, in `WorldState.cars` (out in the world) or in
   * `WorldState.toyBox` (boxed); a haul's car and a lot car never have them.
   */
  papers?: boolean;
  /**
   * Kopecks a car standing on a lot asks (world/carlot.ts), flat across the road. Present
   * only while it is for sale: nobody drives it off before `car_buy` clears it.
   */
  lotPrice?: number;
  /**
   * Kopecks already paid into this lot car's key box (world/keybox.ts), toward
   * `lotPrice`: the whole price once its lever has taken it from the player's money, or what a
   * save from the coin days had fed in. Kept so a reload never eats it; `car_buy` clears
   * it with the price.
   */
  lotPaid?: number;
}

/** A kit car's four seats; the driver sits on the car's left (+X in the kit frame). */
export const PLAYER_SEATS = ['driver', 'passenger', 'rear-left', 'rear-right'] as const;
export type PlayerSeat = (typeof PLAYER_SEATS)[number];

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Hidden physical condition, normalised to 0 (dead) .. 1 (uninjured). */
  health: number;
  /** Arclength hint for road projection; also what save files display. */
  s: number;
  /** Car the player is currently sitting in, or null when on foot. */
  drivingCarId: string | null;
  /**
   * Which seat of `drivingCarId` he sits in. Only the driver's seat drives the car;
   * from the others it stands held where it is. Meaningless on foot.
   */
  seat: PlayerSeat;
  /**
   * The pack, in slot order. `Inventory` is authoritative in-session and mirrors
   * itself here through the `inventory` delta; this array holds the same item
   * objects, so in-place changes (ammo counts, can litres) need no delta.
   */
  carried: Item[];
  /** Index into `carried` of the held item; clamped on restore. */
  carriedSelected: number;
  /** Shades currently on the player's face; absent from the carried pack while worn. */
  wornSunShades: SunShadesItem | null;
  /**
   * The player's balance, KOPECKS (economy/economy.ts). Not an item: money machines
   * debit or pay it directly while they are worked.
   */
  money: number;
}

/**
 * A towed trailer. Not a car: no engine, no gearbox, no driver — a bed on two
 * wheels that follows whatever is pulling it and makes that car handle worse.
 *
 * Trailers are taken and left, never owned: one stands at a gas stop, you couple
 * it, you drop it at the destination. `hitchedTo` is the whole coupling state.
 */
export interface TrailerState {
  readonly id: string;
  /** Car id it is coupled to, or null when standing on its own. */
  hitchedTo: string | null;
  /** Mass on the bed, kg. Zero when empty. */
  cargoKg: number;
  /**
   * Where that mass sits along the bed, metres forward of the bed centre: the
   * placement that decides how much of the rig's weight bears on the tow ball
   * (`Trailer.tongueLoadN`). Absent is centred, 0.2 m ahead of the axle — 8% on the
   * ball, an ordinary well-loaded trailer. Clamped by the trailer to keep a crate on
   * the bed.
   */
  cargoZ?: number;
  /** A load longer than the bed (the bed, contracts/world.ts), or absent for an ordinary flatbed. */
  load?: TrailerLoad;
  x: number;
  y: number;
  z: number;
  /** Quaternion. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

/**
 * A load lashed to a trailer bed that overhangs it.
 *
 * The long trailer load of a contract (the bed) is the only producer. The shape is
 * state, not a mesh detail: the trailer builds a real collider from `halfExtents`, so
 * whatever the overhang hits is hit for real, and it lives in the save so a reloaded
 * trailer is the same physical object. Mass is NOT here — it is the bed's `cargoKg`, so
 * it takes the one mass path every trailer already uses.
 */
export interface TrailerLoad {
  /** Half-extents of the load box, m. Longer than the bed, so it overhangs. */
  readonly halfExtents: readonly [number, number, number];
}


/**
 * Layout version of the saved state, for the migrations its shape alone cannot tell
 * apart (save/save.ts). A save without the field is version 1.
 *  - 2: the bonnet lost the fuel tank's cell; four cells (engine, turbine, radiator, air
 *    filter), where a version 1 bonnet had the tank fourth and the filter fifth.
 *  - 3: money is kopecks in the purse (`PlayerState.money`); before it, coin items
 *    were the money and lot prices were coins.
 */
export const SAVE_VERSION = 3;

export interface WorldState {
  readonly seed: number;
  /** `SAVE_VERSION` this state was written in; migrated saves carry the current one. */
  readonly saveVersion: number;
  /** Real Laayoune local-solar date corresponding to dayIndex zero. */
  readonly calendarEpoch: string;
  /** Seconds since midnight of the in-game clock. */
  timeOfDay: number;
  /**
   * Whole in-game days elapsed. Bumped when `timeOfDay` wraps past midnight, which
   * makes it the only monotonic clock in the state — `timeOfDay` itself is wrapped
   * and `playedSeconds` counts real time at whatever day length the player chose.
   * The sky's twilight moods key off it, so a sunrise looks the same every time you
   * reload into it and different from yesterday's.
   */
  dayIndex: number;
  /** Total real seconds played, for the save list. */
  playedSeconds: number;
  /** Furthest arclength ever reached, for the personal-record monument. */
  recordS: number;
  /**
   * `playedSeconds` when the weather schedule began: the first time `recordS` reached
   * `CLEAR_START_M` past the start (world/weather.ts). `null` until then, and the sky
   * stays clear.
   */
  weatherFromS: number | null;
  /** Player preferences; defaulted on load so old saves keep working. */
  settings: Settings;
  player: PlayerState;
  cars: Record<string, CarState>;
  /**
   * The player's boxed cars (game-design2.md §13.4, world/toybox.ts), keyed by car id:
   * out of the world, each `CarState` kept whole (fuel, wear, stickers, parts, what its
   * boot holds), never with contract cargo. A car is in `cars` or here, never both.
   */
  toyBox: Record<string, CarState>;
  /** Trailers standing in the world or coupled to a car, keyed by trailer id. */
  trailers: Record<string, TrailerState>;
  /** Parts lying loose in the world, keyed by part id. */
  looseParts: Record<string, { part: PartInstance; x: number; y: number; z: number }>;
  /**
   * Non-part pickups lying in the world (tools, fuel cans, weapons, ammo, quarry),
   * keyed by item id. Parts are kept separate because only they can fill a slot.
   */
  looseItems: Record<string, { item: Item; x: number; y: number; z: number }>;
  /**
   * POI indices whose loot has already been materialised into `looseParts` /
   * `looseItems`. Presence means "do not generate again" — the surviving loot lives
   * in those maps, and anything picked up is simply absent. This is what stops a
   * POI restocking itself every time its chunk reloads.
   */
  lootedPois: number[];
  /**
   * Scatter props knocked to pieces, by packed cell identity (`propCellId` in
   * world/props/scatter.ts). Presence means "do not stand this one up again".
   *
   * The same guard `lootedPois` is, for the same reason: a chunk is rebuilt every time
   * it crosses the physics radius, so without a record every cactus you flattened would
   * be standing again the next time you drove past. Numbers rather than strings so it
   * migrates through `migrateNumberArray` like every other index list in the save.
   */
  flattenedProps: number[];
  /**
   * A post's stock after its first release, keyed by `postId` (world/poststops.ts): the
   * offers it still holds (contracts/offers.ts `postStock`). Saved key from the courier
   * days, kept.
   */
  courierStorage: Record<string, (Item | null)[]>;
  /** Contract cargo ids already exchanged for signed envelopes. */
  completedContractIds: string[];
  /**
   * The delivery ledger: completed deliveries counted by contract kind, written with
   * the completed id (`courier_storage`).
   */
  deliveriesByKind: Partial<Record<ContractKind, number>>;
  /**
   * Vending machine slots already sold, by machine id (world/vending.ts). A machine's
   * stock is a pure function of the seed and where it stands; this is what it has
   * given out, so an emptied slot stays empty. Machines never restock.
   */
  vendingSold: Record<string, number[]>;
  /**
   * Litres left in each fluid barrel the player has drawn from, by barrel id
   * (world/barrels.ts). A barrel's first contents are a pure function of the seed and
   * its id; an entry here is what the taps have left of them. Barrels never refill.
   */
  barrelLitres: Record<string, number>;
}

export type WorldDelta =
  | { t: 'time'; timeOfDay: number; playedSeconds: number }
  | { t: 'time_of_day'; timeOfDay: number }
  | { t: 'settings'; settings: Settings }
  | { t: 'player_move'; x: number; y: number; z: number; yaw: number; pitch: number; s: number }
  | { t: 'player_health'; health: number }
  | { t: 'enter_car'; carId: string; seat: PlayerSeat }
  | { t: 'exit_car' }
  | { t: 'car_add'; car: CarState }
  | { t: 'car_remove'; carId: string }
  /** An owned car out of the world into the toy box (world/toybox.ts): `cars` → `toyBox`. */
  | { t: 'car_box'; carId: string }
  /** A boxed car back into the world, standing at the given pose: `toyBox` → `cars`. */
  | { t: 'car_unbox'; carId: string; x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }
  /** `carId` is the TOWED car; `towerId` null drops the bar. */
  | { t: 'car_tow'; carId: string; towerId: string | null }
  | { t: 'car_transform'; carId: string; x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }
  | { t: 'car_odometer'; carId: string; metres: number }
  | { t: 'car_fuel'; carId: string; litres: number }
  /** The fitted air filter's wear, written by the driving car (vehicle/airfilter.ts). */
  | { t: 'car_air_filter'; carId: string; clog: number }
  | { t: 'car_lights'; carId: string; headlightMode: HeadlightMode; taillightsOn: boolean; reverseLightsOn: boolean }
  | { t: 'car_mirror'; carId: string; mirror: KitMirror; yaw: number; pitch: number }
  | { t: 'car_body_condition'; carId: string; dirt: number; scratches: number }
  | { t: 'car_paint'; carId: string; paint: CarPaint }
  | { t: 'car_bonnet'; carId: string; cell: number; item: Item | null }
  | { t: 'car_fluid'; carId: string; fluid: 'water' | 'oil'; litres: number }
  | { t: 'car_engine_temp'; carId: string; celsius: number }
  | { t: 'car_storage'; carId: string; cell: number; item: Item | null }
  /** One place in a car's cabin (vehicle/cabin.ts) laid on or cleared. */
  | { t: 'car_cabin'; carId: string; place: number; item: Item | null }
  | {
      /** A post's stock rewritten, and what a posting consumed and completed (world/post.ts). */
      t: 'courier_storage';
      courierId: string;
      cells: readonly (Item | null)[];
      consumedItemId?: string;
      completedContractId?: string;
      /** The completed contract's kind, counted into `deliveriesByKind`. */
      completedContractKind?: ContractKind;
    }
  | { t: 'trailer_add'; trailer: TrailerState }
  | { t: 'trailer_remove'; trailerId: string }
  | { t: 'trailer_transform'; trailerId: string; x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }
  | { t: 'trailer_hitch'; trailerId: string; carId: string | null }
  | { t: 'trailer_cargo'; trailerId: string; cargoKg: number }
  | { t: 'part_drop'; part: PartInstance; x: number; y: number; z: number }
  | { t: 'part_pickup'; partId: string }
  | { t: 'part_condition'; partId: string; dirt: number; rust: number }
  /**
   * Fluid poured into a container that is NOT fitted to a car: a radiator or
   * engine lying in the world. The level lives on the part (`PartInstance.litres`)
   * and comes back out through the `car_bonnet` transfer when it is installed.
   */
  | { t: 'loose_part_fluid'; partId: string; litres: number }
  /**
   * Fluid poured into a can lying in the world; an empty can takes on the fluid poured
   * into it (items/items.ts `fillCan`).
   */
  | { t: 'loose_item_fluid'; itemId: string; fluid: FluidKind; litres: number }
  | { t: 'item_drop'; item: Item; x: number; y: number; z: number }
  | { t: 'item_pickup'; itemId: string }
  | { t: 'poi_looted'; poiIndex: number }
  | { t: 'prop_flatten'; propId: number }
  | { t: 'sticker_place'; carId: string; sticker: StickerState; envelopeId: string }
  | { t: 'inventory'; items: readonly Item[]; selected: number }
  | { t: 'wearable'; shades: SunShadesItem | null }
  | { t: 'record'; s: number }
  /** The weather schedule begins now (world/weather.ts `CLEAR_START_M`). */
  | { t: 'weather_begin'; playedSeconds: number }
  /** A vending machine slot paid for and dispensed (world/vending.ts). */
  | { t: 'vend_sold'; machineId: string; slot: number }
  /** A barrel's tap ran into a can (world/barrels.ts): what is left in the barrel. */
  | { t: 'barrel_litres'; barrelId: string; litres: number }
  /** A lot car paid for: its asking price goes, its papers are the player's. */
  | { t: 'car_buy'; carId: string }
  /** Kopecks paid into a lot car's key box (world/keybox.ts): its `lotPaid` rises by `kopecks`. */
  | { t: 'lot_pay'; carId: string; kopecks: number }
  /** The player's balance is now `kopecks` (economy/economy.ts `debit`, `credit`). */
  | { t: 'money'; kopecks: number };

/** Seconds in an in-game day. A 24-minute day makes night frequent but not tedious. */
export const DAY_LENGTH = 24 * 60;

/**
 * Prefix marking an id minted at runtime rather than derived from the seed. The
 * `GameWorld` constructor scans for it to resume the counter past a loaded save.
 */
const RUNTIME_ID_PREFIX = 'rt:';

export function newWorldState(seed: number): WorldState {
  return {
    seed: seed >>> 0,
    saveVersion: SAVE_VERSION,
    calendarEpoch: localSolarDateAt(),
    // Start mid-morning: the garage should be lit on a new game.
    timeOfDay: DAY_LENGTH * 0.36,
    playedSeconds: 0,
    dayIndex: 0,
    recordS: 0,
    weatherFromS: null,
    settings: DEFAULT_SETTINGS,
    player: {
      x: 0,
      y: 1.7,
      z: -14,
      yaw: 0,
      pitch: 0,
      health: 1,
      s: 0,
      drivingCarId: null,
      seat: 'driver',
      carried: [],
      carriedSelected: 0,
      wornSunShades: null,
      money: 0,
    },
    cars: {},
    toyBox: {},
    courierStorage: {},
    completedContractIds: [],
    deliveriesByKind: {},
    trailers: {},
    looseParts: {},
    looseItems: {},
    lootedPois: [],
    flattenedProps: [],
    vendingSold: {},
    barrelLitres: {},
  };
}

/**
 * Keeps a container's fluid WITH the container across a bonnet swap.
 *
 * The car owns the level while the part is fitted, so a removal has to pour it into
 * the part and an installation has to pour it back out. This lives in the reducer
 * rather than at the interaction site because that makes it unconditional: every
 * path that swaps a bonnet cell goes through this delta. The old code instead zeroed
 * the radiator at ONE call site, which is why a full radiator you unbolted came back
 * dry and the engine's oil silently teleported to whatever engine you fitted next.
 *
 * Capacity is not enforced: a small radiator moved onto a big engine is simply
 * under-filled, and the bonnet readout says so.
 */
function moveSlotFluid(
  car: CarState,
  cell: number,
  outgoing: Item | null,
  incoming: Item | null,
): void {
  const channel = bonnetSlotFluid(cell);
  if (channel === null || outgoing === incoming) return;
  // Same part id on both sides: the cell was EDITED in place, not swapped — an
  // engine being marked destroyed re-applies this delta with a copy of itself. The
  // container never left the car, so nothing may move. Without this an engine that
  // cooked itself also lost every litre of oil it was holding.
  if (
    outgoing?.type === 'part' &&
    incoming?.type === 'part' &&
    outgoing.part.id === incoming.part.id
  ) {
    return;
  }

  // `bonnetAccepts` is the same gate installation uses, so a part that was never a
  // container for THIS slot cannot be handed a level it has no business holding.
  if (bonnetAccepts(cell, outgoing)) {
    if (channel === 'water') {
      outgoing.part.litres = car.waterLitres;
      car.waterLitres = 0;
    } else {
      outgoing.part.litres = car.oilLitres;
      car.oilLitres = 0;
    }
  }

  if (bonnetAccepts(cell, incoming)) {
    const litres = Math.max(0, incoming.part.litres ?? 0);
    if (channel === 'water') {
      car.waterLitres = litres;
    } else {
      car.oilLitres = litres;
    }
    // Emptied on the way in: the fitted part's level is the CAR's now, and leaving a
    // copy behind would double the fluid the next removal pours back out.
    incoming.part.litres = 0;
  }
}

/**
 * Owns the world state and is the only thing permitted to mutate it.
 *
 * Listeners are notified after each applied delta, which is how the renderer, HUD
 * and audio stay in sync without polling or owning state of their own.
 */
export class GameWorld {
  readonly state: WorldState;
  private readonly listeners = new Set<(delta: WorldDelta) => void>();
  private partCounter = 0;
  /**
   * The car the player last sat in at the wheel this session, or took out of the toy box,
   * or null (boxed away): the car he arrived in, which a post pays the uniqueness bonus
   * by when none stands on its lay-by (world/post.ts), and the old car a purchase boxes
   * (world/keybox.ts). Session memory, not saved: a reload starts from the car he sits in.
   */
  lastDrivenCarId: string | null;

  constructor(state: WorldState) {
    this.state = state;
    this.lastDrivenCarId = state.player.drivingCarId;
    // Continue runtime ids past anything already in the save, or a reloaded game
    // hands out an id something is still holding. Counting collections is not
    // enough — the pack persists across a save and its items keep their `rt:`
    // ids — so the highest id actually present is what the counter resumes from.
    let highest = 0;
    const bump = (id: string): void => {
      if (!id.startsWith(RUNTIME_ID_PREFIX)) return;
      const n = Number.parseInt(id.slice(RUNTIME_ID_PREFIX.length), 36);
      if (Number.isFinite(n) && n >= highest) highest = n + 1;
    };
    for (const id of Object.keys(state.looseParts)) bump(id);
    for (const id of Object.keys(state.looseItems)) bump(id);
    for (const item of state.player.carried) bump(item.id);
    if (state.player.wornSunShades) bump(state.player.wornSunShades.id);
    for (const car of [...Object.values(state.cars), ...Object.values(state.toyBox)]) {
      bump(car.id);
      for (const item of car.storage) {
        if (item) bump(item.id);
      }
      for (const item of car.cabin) {
        if (item) bump(item.id);
      }
    }
    for (const storage of Object.values(state.courierStorage)) {
      for (const item of storage) {
        if (item) bump(item.id);
      }
    }
    for (const trailer of Object.values(state.trailers)) bump(trailer.id);
    this.partCounter = highest;
  }

  get seed(): number {
    return this.state.seed;
  }

  onDelta(listener: (delta: WorldDelta) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Deterministic id for procedurally generated parts, stable across sessions. */
  generatedPartId(domain: string, index: number, sub: number): string {
    return `${domain}:${hash(this.state.seed, index, sub).toString(36)}`;
  }

  /** Unique id for parts created at runtime, e.g. spawned by the player. */
  runtimePartId(): string {
    return `${RUNTIME_ID_PREFIX}${(this.partCounter++).toString(36)}`;
  }

  apply(delta: WorldDelta): void {
    const s = this.state;
    switch (delta.t) {
      case 'time': {
        const wrapped = delta.timeOfDay % DAY_LENGTH;
        // Midnight crossed: the clock went backwards because it wrapped, not because
        // anything jumped it (a jump is 'time_of_day', below, and deliberately does
        // not advance the calendar).
        if (wrapped < s.timeOfDay) s.dayIndex++;
        s.timeOfDay = wrapped;
        s.playedSeconds = delta.playedSeconds;
        break;
      }
      case 'time_of_day':
        // An explicit clock jump (settings presets), kept separate from 'time',
        // the loop's per-tick advance: a jump repositions the sun without
        // counting played seconds, and nothing may re-derive it from 'time'.
        s.timeOfDay = delta.timeOfDay % DAY_LENGTH;
        break;
      case 'settings':
        // Wholesale replacement: the pause menu edits preferences as a unit and
        // settings is never mutated field-by-field, so no merge is needed.
        s.settings = delta.settings;
        break;
      case 'car_add':
        s.cars[delta.car.id] = delta.car;
        break;
      case 'car_remove':
        delete s.cars[delta.carId];
        break;
      case 'car_box': {
        // Only the player's own car, and not the one he sits in: the box takes it as it
        // stands, off any bar (world/toybox.ts refuses a coupled one first).
        const car = s.cars[delta.carId];
        if (!car?.papers || s.player.drivingCarId === delta.carId) break;
        delete s.cars[delta.carId];
        car.towedBy = null;
        s.toyBox[delta.carId] = car;
        if (this.lastDrivenCarId === delta.carId) this.lastDrivenCarId = null;
        break;
      }
      case 'car_unbox': {
        const car = s.toyBox[delta.carId];
        if (!car) break;
        delete s.toyBox[delta.carId];
        car.x = delta.x;
        car.y = delta.y;
        car.z = delta.z;
        car.qx = delta.qx;
        car.qy = delta.qy;
        car.qz = delta.qz;
        car.qw = delta.qw;
        s.cars[delta.carId] = car;
        // Taken out to be driven: the car a post reads when none stands on its lay-by.
        this.lastDrivenCarId = delta.carId;
        break;
      }
      case 'car_tow': {
        // A coupling to a car that is not there is not a coupling; the tower side
        // is derived from this field, so a dangling id would keep a ghost alive.
        const car = s.cars[delta.carId];
        if (car) car.towedBy = delta.towerId !== null && s.cars[delta.towerId] ? delta.towerId : null;
        break;
      }
      case 'player_move':
        s.player.x = delta.x;
        s.player.y = delta.y;
        s.player.z = delta.z;
        s.player.yaw = delta.yaw;
        s.player.pitch = delta.pitch;
        s.player.s = delta.s;
        break;
      case 'player_health':
        s.player.health = Math.min(1, Math.max(0, delta.health));
        break;
      case 'enter_car':
        s.player.drivingCarId = delta.carId;
        s.player.seat = delta.seat;
        if (delta.seat === 'driver') this.lastDrivenCarId = delta.carId;
        break;
      case 'exit_car':
        s.player.drivingCarId = null;
        s.player.seat = 'driver';
        break;
      case 'car_transform': {
        const car = s.cars[delta.carId];
        if (car) {
          car.x = delta.x;
          car.y = delta.y;
          car.z = delta.z;
          car.qx = delta.qx;
          car.qy = delta.qy;
          car.qz = delta.qz;
          car.qw = delta.qw;
        }
        break;
      }
      case 'car_odometer': {
        const car = s.cars[delta.carId];
        if (car) car.odometer += delta.metres;
        break;
      }
      case 'car_lights': {
        const car = s.cars[delta.carId];
        if (car) {
          car.headlightMode = delta.headlightMode;
          car.taillightsOn = delta.taillightsOn;
          car.reverseLightsOn = delta.reverseLightsOn;
        }
        break;
      }
      case 'car_mirror': {
        const car = s.cars[delta.carId];
        if (car) car[MIRROR_FIELD[delta.mirror]] = [delta.yaw, delta.pitch];
        break;
      }
      case 'car_body_condition': {
        const car = s.cars[delta.carId];
        if (car) {
          // Fractions written by both the accumulating simulation and cleaning tools.
          car.dirt = clamp01(delta.dirt);
          car.scratches = clamp01(delta.scratches);
        }
        break;
      }
      case 'car_paint': {
        const car = s.cars[delta.carId];
        if (car) car.paint = { ...delta.paint, cover: clamp01(delta.paint.cover) };
        break;
      }
      case 'car_fuel': {
        const car = s.cars[delta.carId];
        if (car) car.fuelLitres = Math.max(0, delta.litres);
        break;
      }
      case 'car_air_filter': {
        const car = s.cars[delta.carId];
        const item = car?.bonnet[AIR_FILTER_CELL];
        if (car && bonnetAccepts(AIR_FILTER_CELL, item ?? null) && item?.type === 'part') {
          item.part.clog = Math.max(0, delta.clog);
        }
        break;
      }
      case 'car_bonnet': {
        const car = s.cars[delta.carId];
        if (car && delta.cell >= 0 && delta.cell < BONNET_SLOT_COUNT) {
          const outgoing = car.bonnet[delta.cell];
          car.bonnet[delta.cell] = delta.item;
          moveSlotFluid(car, delta.cell, outgoing, delta.item);
        }
        break;
      }
      case 'car_fluid': {
        const car = s.cars[delta.carId];
        if (!car) break;
        const level = Math.max(0, delta.litres);
        if (delta.fluid === 'water') car.waterLitres = level;
        else car.oilLitres = level;
        break;
      }
      case 'car_engine_temp': {
        const car = s.cars[delta.carId];
        if (!car) break;
        // Bounded here rather than trusted: this is the one field a corrupt save or
        // a divide upstream could turn into a NaN that then poisons every later
        // step of the thermal integrator.
        car.engineTempC = Number.isFinite(delta.celsius)
          ? Math.min(400, Math.max(-60, delta.celsius))
          : 30;
        break;
      }
      case 'car_storage': {
        const car = s.cars[delta.carId];
        // Out-of-range cells are ignored rather than growing the array: capacity is
        // the model's, fixed when the car was created.
        if (car && delta.cell >= 0 && delta.cell < car.storage.length) {
          car.storage[delta.cell] = delta.item;
        }
        break;
      }
      case 'car_cabin': {
        const car = s.cars[delta.carId];
        if (car && delta.place >= 0 && delta.place < car.cabin.length) car.cabin[delta.place] = delta.item;
        break;
      }
      case 'trailer_add':
        s.trailers[delta.trailer.id] = delta.trailer;
        break;
      case 'trailer_remove':
        // A contract trailer that was handed over. Streaming reconciles from state,
        // so the runtime body is dropped by the composition root's own listener.
        delete s.trailers[delta.trailerId];
        break;
      case 'trailer_transform': {
        const trailer = s.trailers[delta.trailerId];
        if (trailer) {
          trailer.x = delta.x;
          trailer.y = delta.y;
          trailer.z = delta.z;
          trailer.qx = delta.qx;
          trailer.qy = delta.qy;
          trailer.qz = delta.qz;
          trailer.qw = delta.qw;
        }
        break;
      }
      case 'trailer_hitch': {
        const trailer = s.trailers[delta.trailerId];
        if (trailer) trailer.hitchedTo = delta.carId;
        break;
      }
      case 'trailer_cargo': {
        const trailer = s.trailers[delta.trailerId];
        if (trailer) trailer.cargoKg = Math.max(0, delta.cargoKg);
        break;
      }
      case 'part_drop':
        s.looseParts[delta.part.id] = {
          part: delta.part,
          x: delta.x,
          y: delta.y,
          z: delta.z,
        };
        break;
      case 'part_pickup':
        delete s.looseParts[delta.partId];
        break;
      case 'part_condition': {
        // Condition lives on the loose-part record: a part is only ever in one place,
        // and the fitted ones live in a car's bonnet cells, which never carry a
        // condition anyone can reach with a brush.
        const loose = s.looseParts[delta.partId];
        if (loose) {
          loose.part.dirt = delta.dirt;
          loose.part.rust = delta.rust;
        }
        break;
      }
      case 'loose_part_fluid': {
        const loose = s.looseParts[delta.partId];
        if (!loose) break;
        loose.part.litres = delta.litres;
        break;
      }
      case 'loose_item_fluid': {
        const loose = s.looseItems[delta.itemId];
        if (loose?.item.type === 'fluid_can') {
          loose.item.fluid = delta.litres > 0 ? delta.fluid : null;
          loose.item.litres = Math.max(0, delta.litres);
        }
        break;
      }
      case 'item_drop':
        s.looseItems[delta.item.id] = { item: delta.item, x: delta.x, y: delta.y, z: delta.z };
        break;
      case 'item_pickup':
        delete s.looseItems[delta.itemId];
        break;
      case 'poi_looted':
        if (!s.lootedPois.includes(delta.poiIndex)) s.lootedPois.push(delta.poiIndex);
        break;
      case 'prop_flatten':
        if (!s.flattenedProps.includes(delta.propId)) s.flattenedProps.push(delta.propId);
        break;
      case 'vend_sold': {
        const sold = s.vendingSold[delta.machineId] ?? (s.vendingSold[delta.machineId] = []);
        if (!sold.includes(delta.slot)) sold.push(delta.slot);
        break;
      }
      case 'barrel_litres':
        s.barrelLitres[delta.barrelId] = Math.max(0, delta.litres);
        break;
      case 'car_buy': {
        const car = s.cars[delta.carId];
        if (car) {
          delete car.lotPrice;
          delete car.lotPaid;
          car.papers = true;
        }
        break;
      }
      case 'lot_pay': {
        const car = s.cars[delta.carId];
        if (car?.lotPrice !== undefined) car.lotPaid = Math.min(car.lotPrice, (car.lotPaid ?? 0) + delta.kopecks);
        break;
      }
      case 'money': {
        s.player.money = Math.max(0, Math.round(delta.kopecks));
        break;
      }
      case 'courier_storage':
        if (
          delta.completedContractId
          && s.completedContractIds.includes(delta.completedContractId)
        ) break;
        s.courierStorage[delta.courierId] = delta.cells.slice();
        if (delta.consumedItemId) {
          const carried = s.player.carried.findIndex((item) => item.id === delta.consumedItemId);
          if (carried >= 0) s.player.carried.splice(carried, 1);
        }
        if (delta.completedContractId) {
          s.completedContractIds.push(delta.completedContractId);
          if (delta.completedContractKind) {
            const kind = delta.completedContractKind;
            s.deliveriesByKind[kind] = (s.deliveriesByKind[kind] ?? 0) + 1;
          }
        }
        break;
      case 'sticker_place': {
        const car = s.cars[delta.carId];
        const envelope = s.player.carried.findIndex(
          (item) => item.id === delta.envelopeId && item.type === 'sticker_envelope',
        );
        if (car && envelope >= 0) {
          car.stickers.push(delta.sticker);
          s.player.carried.splice(envelope, 1);
        }
        break;
      }
      case 'inventory':
        // Copy the array, share the items. The slot order must not alias the live
        // pack (it mutates in place, and a save snapshot taken mid-frame would see
        // a half-spliced array), but the item objects are deliberately the same
        // ones so per-item field changes are already persisted.
        s.player.carried = delta.items.slice();
        s.player.carriedSelected = delta.selected;
        break;
      case 'wearable':
        s.player.wornSunShades = delta.shades;
        break;
      case 'record':
        // Monotonic: the personal-record marker must never move backwards.
        if (delta.s > s.recordS) s.recordS = delta.s;
        break;
      case 'weather_begin':
        // Once: the schedule's origin is fixed for the rest of the game.
        if (s.weatherFromS === null) s.weatherFromS = delta.playedSeconds;
        break;
    }

    for (const listener of this.listeners) listener(delta);
  }
}
