import { hash } from '../core/rng';
import type { Item, SunShadesItem } from '../items/items';
import type { FuelType, PartInstance } from '../parts/registry';
import { bonnetAccepts, bonnetSlotFluid, BONNET_SLOT_COUNT } from '../vehicle/bonnet';
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

export type HeadlightMode = 'off' | 'low' | 'high';

/** Eight layered impacts keep the driven-car shader inside a low-end WebGL uniform budget. */
export const MAX_BODY_DAMAGE_IMPACTS = 8;

export type BodyDamageType = 'dent' | 'scratch' | 'chip' | 'heavy';

/**
 * One permanent, localized mark on the shell.
 *
 * Position and direction are chassis-local metres/unit vectors. World-space impact
 * data would slide over a moving car and jump when the floating origin rebases, so
 * the collision is converted once and this stable representation is what gets saved.
 */
export interface BodyDamageImpact {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly radius: number;
  readonly strength: number;
  readonly type: BodyDamageType;
  /** Stable random mask selection and rotation, 0..1. */
  readonly seed: number;
}

export interface CarState {
  readonly id: string;
  /** Complete car model id from the catalogue (vehicle/carmodels.ts). */
  readonly modelId: string;
  /** Anchor id -> mounted gizmo, or absent when the anchor is bare. */
  readonly gizmos: Record<string, PartInstance>;
  /** Earned stickers, in the order they were placed. Append-only, permanent. */
  readonly stickers: StickerState[];
  /** Dipped/high-beam selection, persisted independently of the day/night clock. */
  headlightMode: HeadlightMode;
  /** Last rendered tail-lamp state, including a brake-light flash. */
  taillightsOn: boolean;
  /** Last rendered reverse-lamp state. */
  reverseLightsOn: boolean;
  fuelLitres: number;
  /** Fuel currently in the fitted tank; mixed or wrong fuel cannot run the engine. */
  fuelKind: FuelType | 'mixed' | null;
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
   * Cosmetic body condition of the SHELL, 0..1 each, distinct from the per-part
   * `dirt`/`rust` a `PartInstance` carries: those describe a component that can be
   * removed and carried around, these describe the car.
   *
   * `dirt` is raised by driving — how fast depends on what the tyres are throwing
   * up (see `SURFACES[].dust`) — and taken off with the brush and sponge that
   * already clean parts. `scratches` are raised by impacts and never fully undone:
   * polishing takes them back to a floor, not to zero, because a repaint is not a
   * thing this game has.
   */
  dirt: number;
  scratches: number;
  /** Localized, cumulative collision marks; oldest-first and bounded for real-time shading. */
  readonly damage: BodyDamageImpact[];
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
  /** Shades currently on the player's face; absent from the carried pack while worn. */
  wornSunShades: SunShadesItem | null;
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
  | { t: 'car_fuel'; carId: string; litres: number; fuelKind?: FuelType | 'mixed' | null }
  | { t: 'car_lights'; carId: string; headlightMode: HeadlightMode; taillightsOn: boolean; reverseLightsOn: boolean }
  | { t: 'car_body_condition'; carId: string; dirt: number; scratches: number }
  | { t: 'car_body_impact'; carId: string; impact: BodyDamageImpact }
  | { t: 'car_bonnet'; carId: string; cell: number; item: Item | null }
  | { t: 'car_fluid'; carId: string; fluid: 'water' | 'oil'; litres: number }
  | { t: 'car_engine_temp'; carId: string; celsius: number }
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
  | { t: 'wearable'; shades: SunShadesItem | null }
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
    player: {
      x: 0,
      y: 1.7,
      z: -14,
      yaw: 0,
      pitch: 0,
      s: 0,
      drivingCarId: null,
      carried: [],
      carriedSelected: 0,
      wornSunShades: null,
    },
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
 * Keeps a container's fluid WITH the container across a bonnet swap.
 *
 * The car owns the level while the part is fitted, so a removal has to pour it into
 * the part and an installation has to pour it back out. This lives in the reducer
 * rather than at the interaction site because that makes it unconditional: every
 * path that swaps a bonnet cell goes through this delta. The old code instead zeroed
 * the radiator and the fuel tank at ONE call site, which is why a full tank you
 * unbolted came back dry and the engine's oil silently teleported to whatever engine
 * you fitted next.
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
    if (channel === 'fuel') {
      // A MIXTURE is the one thing that does not travel. Nobody carries a tank of
      // contaminated fuel about, and pulling the tank was already the documented
      // recovery from a mis-fuel (see `pourPrompt` in player/interaction.ts) — if it
      // came out with you, a mis-fuelled car would have no way back at all.
      const contaminated = car.fuelKind === 'mixed';
      outgoing.part.litres = contaminated ? 0 : car.fuelLitres;
      outgoing.part.fuelKind = contaminated ? null : car.fuelKind;
      car.fuelLitres = 0;
      car.fuelKind = null;
    } else if (channel === 'water') {
      outgoing.part.litres = car.waterLitres;
      car.waterLitres = 0;
    } else {
      outgoing.part.litres = car.oilLitres;
      car.oilLitres = 0;
    }
  }

  if (bonnetAccepts(cell, incoming)) {
    const litres = Math.max(0, incoming.part.litres ?? 0);
    if (channel === 'fuel') {
      car.fuelLitres = litres;
      car.fuelKind = litres > 0 ? incoming.part.fuelKind ?? null : null;
      incoming.part.fuelKind = null;
    } else if (channel === 'water') {
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
    if (state.player.wornSunShades) bump(state.player.wornSunShades.id);
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
      case 'car_lights': {
        const car = s.cars[delta.carId];
        if (car) {
          car.headlightMode = delta.headlightMode;
          car.taillightsOn = delta.taillightsOn;
          car.reverseLightsOn = delta.reverseLightsOn;
        }
        break;
      }
      case 'car_body_condition': {
        const car = s.cars[delta.carId];
        if (car) {
          // Clamped here rather than trusted from the caller: the shader reads these
          // as fractions, and both an accumulating simulation and a cleaning tool
          // write them.
          car.dirt = clamp01(delta.dirt);
          car.scratches = clamp01(delta.scratches);
        }
        break;
      }
      case 'car_body_impact': {
        const car = s.cars[delta.carId];
        if (car) {
          const impact = delta.impact;
          const normalLength = Math.hypot(impact.nx, impact.ny, impact.nz);
          if (
            Number.isFinite(impact.x) &&
            Number.isFinite(impact.y) &&
            Number.isFinite(impact.z) &&
            Number.isFinite(impact.radius) &&
            Number.isFinite(impact.strength) &&
            Number.isFinite(impact.seed) &&
            normalLength > 1e-6
          ) {
            if (car.damage.length >= MAX_BODY_DAMAGE_IMPACTS) car.damage.shift();
            car.damage.push({
              x: impact.x,
              y: impact.y,
              z: impact.z,
              nx: impact.nx / normalLength,
              ny: impact.ny / normalLength,
              nz: impact.nz / normalLength,
              radius: Math.max(0.05, Math.min(1.5, impact.radius)),
              strength: clamp01(impact.strength),
              type: impact.type,
              seed: clamp01(impact.seed),
            });
          }
        }
        break;
      }
      case 'car_fuel': {
        const car = s.cars[delta.carId];
        if (car) {
          car.fuelLitres = Math.max(0, delta.litres);
          if (delta.fuelKind !== undefined) car.fuelKind = delta.fuelKind;
          if (car.fuelLitres === 0) car.fuelKind = null;
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
      case 'wearable':
        s.player.wornSunShades = delta.shades;
        break;
      case 'record':
        // Monotonic: the personal-record marker must never move backwards.
        if (delta.s > s.recordS) s.recordS = delta.s;
        break;
    }

    for (const listener of this.listeners) listener(delta);
  }
}
