import { hash } from '../core/rng';
import type { Item } from '../items/items';
import type { PartInstance } from '../parts/registry';
import { TRUNK_CELL_COUNT } from '../vehicle/trunk';
import { DEFAULT_SETTINGS } from './settings';
import { localSolarDateAt } from './calendar';
import type { Settings } from './settings';

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

/**
 * A sticker on a car's bodywork: the record of one completed haul.
 *
 * Position and normal are in the car's own local space, taken from where the player
 * aimed on the actual mesh, so it survives a save and stays exactly where it was
 * put. There is deliberately no removal delta — a sticker cannot be scratched off,
 * and it does not follow the player to another car. The car IS the save file.
 */
export interface StickerState {
  /** Sticker design id, from the built-in pack. */
  readonly kind: string;
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
}

/**
 * The haul in progress. At most one, and that is a design constraint, not a
 * simplification: the destination is communicated by a single lit sign with no
 * number and no name on it, so two simultaneous destinations would be
 * indistinguishable.
 */
export interface JobState {
  readonly fromPoi: number;
  readonly toPoi: number;
  readonly cargoKg: number;
}

export interface CarState {
  readonly id: string;
  /** Complete car model id from the catalogue (vehicle/carmodels.ts). */
  readonly modelId: string;
  /** Anchor id -> mounted gizmo, or absent when the anchor is bare. */
  readonly gizmos: Record<string, PartInstance>;
  /** Earned stickers, in the order they were placed. Append-only, permanent. */
  readonly stickers: StickerState[];
  fuelLitres: number;
  /**
   * Coolant and oil in the engine, litres.
   *
   * Unlike fuel these are not consumed by driving — an old engine SEEPS them, and
   * that is the whole mechanic: a slow drift downward that eventually makes you
   * stop and look for a can. Capacities come from the engine's cylinder count (see
   * `coolantCapacity` / `oilCapacity` in parts/registry.ts) rather than a table,
   * because a bigger engine holding more of both needs no authoring.
   */
  coolantLitres: number;
  oilLitres: number;
  /**
   * Boot cells. `null` is an empty cell; the array's LENGTH is the car's capacity,
   * fixed at spawn from the model, so a save carries the layout it was created with.
   */
  readonly storage: (Item | null)[];
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
}

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Arclength hint for road projection; also what save files display. */
  s: number;
  /** Car the player is currently driving, or null when on foot. */
  drivingCarId: string | null;
  /**
   * The pack, in slot order. `Inventory` is authoritative in-session and mirrors
   * itself here through the `inventory` delta; this array holds the same item
   * objects, so in-place changes (ammo counts, can litres) need no delta.
   */
  carried: Item[];
  /** Index into `carried` of the held item; clamped on restore. */
  carriedSelected: number;
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
  x: number;
  y: number;
  z: number;
  /** Quaternion. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface WorldState {
  readonly seed: number;
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
  /** Player preferences; defaulted on load so old saves keep working. */
  settings: Settings;
  player: PlayerState;
  cars: Record<string, CarState>;
  /** Persistent contents of deterministic static wreck trunks, keyed by wreck id. */
  wreckStorage: Record<string, (Item | null)[]>;
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
   * world/props.ts). Presence means "do not stand this one up again".
   *
   * The same guard `lootedPois` is, for the same reason: a chunk is rebuilt every time
   * it crosses the physics radius, so without a record every cactus you flattened would
   * be standing again the next time you drove past. Numbers rather than strings so it
   * migrates through `migrateNumberArray` like every other index list in the save.
   */
  flattenedProps: number[];
  /**
   * The haul in progress, or null. One at a time by design: the destination is a
   * single lit sign with no text on it, and two would be indistinguishable.
   */
  job: JobState | null;
  /**
   * Stickers earned but not yet stuck on. Deliveries pay in these; placing one is a
   * separate, deliberate act, so finishing a run with a pocketful is legal.
   */
  stickersUnplaced: number;
  /** POI slots already delivered to, so a stop cannot be farmed twice. */
  deliveredPois: number[];
}

export type WorldDelta =
  | { t: 'time'; timeOfDay: number; playedSeconds: number }
  | { t: 'time_of_day'; timeOfDay: number }
  | { t: 'settings'; settings: Settings }
  | { t: 'player_move'; x: number; y: number; z: number; yaw: number; pitch: number; s: number }
  | { t: 'enter_car'; carId: string }
  | { t: 'exit_car' }
  | { t: 'car_add'; car: CarState }
  | { t: 'car_transform'; carId: string; x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }
  | { t: 'car_odometer'; carId: string; metres: number }
  | { t: 'car_fuel'; carId: string; litres: number }
  | { t: 'car_fluid'; carId: string; fluid: 'coolant' | 'oil'; litres: number }
  | { t: 'car_storage'; carId: string; cell: number; item: Item | null }
  | { t: 'wreck_storage'; wreckId: string; cell: number; item: Item | null }
  | { t: 'trailer_add'; trailer: TrailerState }
  | { t: 'trailer_transform'; trailerId: string; x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }
  | { t: 'trailer_hitch'; trailerId: string; carId: string | null }
  | { t: 'trailer_cargo'; trailerId: string; cargoKg: number }
  | { t: 'gizmo_attach'; carId: string; anchor: string; part: PartInstance }
  | { t: 'gizmo_detach'; carId: string; anchor: string }
  | { t: 'part_drop'; part: PartInstance; x: number; y: number; z: number }
  | { t: 'part_pickup'; partId: string }
  | { t: 'part_condition'; partId: string; dirt: number; rust: number }
  | { t: 'item_drop'; item: Item; x: number; y: number; z: number }
  | { t: 'item_pickup'; itemId: string }
  | { t: 'poi_looted'; poiIndex: number }
  | { t: 'prop_flatten'; propId: number }
  | { t: 'job_accept'; job: JobState }
  | { t: 'job_complete'; poiIndex: number }
  | { t: 'job_abandon' }
  | { t: 'sticker_place'; carId: string; sticker: StickerState }
  | { t: 'inventory'; items: readonly Item[]; selected: number }
  | { t: 'record'; s: number };

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
    calendarEpoch: localSolarDateAt(),
    // Start mid-morning: the garage should be lit on a new game.
    timeOfDay: DAY_LENGTH * 0.36,
    playedSeconds: 0,
    dayIndex: 0,
    recordS: 0,
    settings: DEFAULT_SETTINGS,
    player: { x: 0, y: 1.7, z: -14, yaw: 0, pitch: 0, s: 0, drivingCarId: null, carried: [], carriedSelected: 0 },
    cars: {},
    wreckStorage: {},
    trailers: {},
    looseParts: {},
    looseItems: {},
    lootedPois: [],
    flattenedProps: [],
    job: null,
    stickersUnplaced: 0,
    deliveredPois: [],
  };
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

  constructor(state: WorldState) {
    this.state = state;
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
    for (const car of Object.values(state.cars)) {
      bump(car.id);
      for (const part of Object.values(car.gizmos)) bump(part.id);
      for (const item of car.storage) {
        if (item) bump(item.id);
      }
    }
    for (const storage of Object.values(state.wreckStorage)) {
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
      case 'player_move':
        s.player.x = delta.x;
        s.player.y = delta.y;
        s.player.z = delta.z;
        s.player.yaw = delta.yaw;
        s.player.pitch = delta.pitch;
        s.player.s = delta.s;
        break;
      case 'enter_car':
        s.player.drivingCarId = delta.carId;
        break;
      case 'exit_car':
        s.player.drivingCarId = null;
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
      case 'car_fuel': {
        const car = s.cars[delta.carId];
        if (car) car.fuelLitres = Math.max(0, delta.litres);
        break;
      }
      case 'car_fluid': {
        const car = s.cars[delta.carId];
        if (!car) break;
        const level = Math.max(0, delta.litres);
        if (delta.fluid === 'coolant') car.coolantLitres = level;
        else car.oilLitres = level;
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
      case 'wreck_storage': {
        if (delta.cell < 0 || delta.cell >= TRUNK_CELL_COUNT) break;
        const storage =
          s.wreckStorage[delta.wreckId] ??
          (s.wreckStorage[delta.wreckId] = new Array<Item | null>(TRUNK_CELL_COUNT).fill(null));
        storage[delta.cell] = delta.item;
        break;
      }
      case 'trailer_add':
        s.trailers[delta.trailer.id] = delta.trailer;
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
      case 'gizmo_attach': {
        const car = s.cars[delta.carId];
        if (car) car.gizmos[delta.anchor] = delta.part;
        break;
      }
      case 'gizmo_detach': {
        const car = s.cars[delta.carId];
        if (car) delete car.gizmos[delta.anchor];
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
        // Condition can live on a loose part or a fitted one; update wherever it is.
        const loose = s.looseParts[delta.partId];
        if (loose) {
          loose.part.dirt = delta.dirt;
          loose.part.rust = delta.rust;
          break;
        }
        for (const car of Object.values(s.cars)) {
          for (const part of Object.values(car.gizmos)) {
            if (part.id === delta.partId) {
              part.dirt = delta.dirt;
              part.rust = delta.rust;
            }
          }
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
      case 'job_accept':
        s.job = delta.job;
        break;
      case 'job_complete': {
        // The sticker is minted here, not on placement: the reward is earned by
        // arriving, and where it goes on the car is a separate decision.
        //
        // Both ends are recorded as cleared. The destination stops a stop being
        // delivered to twice; the ORIGIN is what stops the same pallet being hauled
        // again and again, which it otherwise would be the moment `job` went null.
        const origin = s.job?.fromPoi ?? -1;
        s.job = null;
        s.stickersUnplaced += 1;
        for (const index of [delta.poiIndex, origin]) {
          if (index >= 0 && !s.deliveredPois.includes(index)) s.deliveredPois.push(index);
        }
        break;
      }
      case 'job_abandon':
        s.job = null;
        break;
      case 'sticker_place': {
        const car = s.cars[delta.carId];
        if (car && s.stickersUnplaced > 0) {
          car.stickers.push(delta.sticker);
          s.stickersUnplaced -= 1;
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
      case 'record':
        // Monotonic: the personal-record marker must never move backwards.
        if (delta.s > s.recordS) s.recordS = delta.s;
        break;
    }

    for (const listener of this.listeners) listener(delta);
  }
}
