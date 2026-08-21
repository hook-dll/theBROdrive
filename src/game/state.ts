import { hash } from '../core/rng';
import type { Item } from '../items/items';
import type { PartInstance, SlotId } from '../parts/registry';
import { DEFAULT_SETTINGS } from './settings';
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

export interface CarState {
  readonly id: string;
  /** Body definition id from the parts registry. */
  readonly bodyId: string;
  /** Body paint as 0xRRGGBB; old saves default to the body's stock colour. */
  readonly paintColor: number;
  /** Slot id -> fitted part, or absent when empty. */
  readonly slots: Record<string, PartInstance>;
  fuelLitres: number;
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
}

export interface WorldState {
  readonly seed: number;
  /** Seconds since midnight of the in-game clock. */
  timeOfDay: number;
  /** Total real seconds played, for the save list. */
  playedSeconds: number;
  /** Furthest arclength ever reached, for the personal-record monument. */
  recordS: number;
  /** Player preferences; defaulted on load so old saves keep working. */
  settings: Settings;
  player: PlayerState;
  cars: Record<string, CarState>;
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
  /** Part ids consumed or destroyed, so generators skip them. */
  consumedParts: string[];
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
  | { t: 'part_attach'; carId: string; slot: SlotId; part: PartInstance }
  | { t: 'part_detach'; carId: string; slot: SlotId }
  | { t: 'part_drop'; part: PartInstance; x: number; y: number; z: number }
  | { t: 'part_pickup'; partId: string }
  | { t: 'part_condition'; partId: string; dirt: number; rust: number }
  | { t: 'item_drop'; item: Item; x: number; y: number; z: number }
  | { t: 'item_pickup'; itemId: string }
  | { t: 'poi_looted'; poiIndex: number }
  | { t: 'record'; s: number };

/** Seconds in an in-game day. A 24-minute day makes night frequent but not tedious. */
export const DAY_LENGTH = 24 * 60;

export function newWorldState(seed: number): WorldState {
  return {
    seed: seed >>> 0,
    // Start mid-morning: the garage should be lit on a new game.
    timeOfDay: DAY_LENGTH * 0.36,
    playedSeconds: 0,
    recordS: 0,
    settings: DEFAULT_SETTINGS,
    player: { x: 0, y: 1.7, z: -14, yaw: 0, pitch: 0, s: 0, drivingCarId: null },
    cars: {},
    looseParts: {},
    looseItems: {},
    lootedPois: [],
    consumedParts: [],
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
    // Continue part ids past anything already in the save, so ids stay unique.
    this.partCounter = Object.keys(state.looseParts).length + state.consumedParts.length + 1;
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
    return `rt:${(this.partCounter++).toString(36)}`;
  }

  apply(delta: WorldDelta): void {
    const s = this.state;
    switch (delta.t) {
      case 'time':
        s.timeOfDay = delta.timeOfDay % DAY_LENGTH;
        s.playedSeconds = delta.playedSeconds;
        break;
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
      case 'part_attach': {
        const car = s.cars[delta.carId];
        if (car) car.slots[delta.slot] = delta.part;
        break;
      }
      case 'part_detach': {
        const car = s.cars[delta.carId];
        if (car) delete car.slots[delta.slot];
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
          for (const part of Object.values(car.slots)) {
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
      case 'record':
        // Monotonic: the personal-record marker must never move backwards.
        if (delta.s > s.recordS) s.recordS = delta.s;
        break;
    }

    for (const listener of this.listeners) listener(delta);
  }
}
