import { hash } from '../core/rng';
import { parseCalendarEpoch } from '../game/calendar';
import { newWorldState } from '../game/state';
import type {
  CarState,
  JobState,
  PlayerState,
  StickerState,
  TrailerState,
  WorldState,
  GameWorld,
} from '../game/state';
import { sanitizeSettings } from '../game/settings';
import type { Item } from '../items/items';
import { variant, type PartInstance } from '../parts/registry';
import { createBonnetStorage, normalizeBonnetStorage, BONNET_SLOT_COUNT } from '../vehicle/bonnet';
import { carModel, DEFAULT_CAR_MODEL_ID, hasCarModel } from '../vehicle/carmodels';
import { TRUNK_CELL_COUNT } from '../vehicle/trunk';

/**
 * Save files, as both IndexedDB records and shareable text codes.
 *
 * A save holds only `WorldState` — the player's mutations of an otherwise
 * procedural world. Everything generated (road, terrain, POIs, chunks) is a pure
 * function of `seed` and is deliberately never serialised, which is why a save
 * stays a few kB no matter how long the run.
 */

export interface SaveMeta {
  id: string;
  name: string;
  seed: number;
  /** Distance travelled in kilometres, derived from `player.s` (metres). */
  km: number;
  playedSeconds: number;
  savedAt: number;
}

export interface SaveBackend {
  list(): Promise<SaveMeta[]>;
  load(id: string): Promise<WorldState | null>;
  save(id: string, name: string, state: WorldState): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * Saves after vehicle entry/exit and discrete mutations made while on foot. The
 * microtask is load-bearing: exit teleports the player and trunk transfers update
 * inventory immediately before storage, so the save must observe the completed
 * interaction rather than the first delta in it.
 *
 * `stateForSave` lets the runtime flush physics-owned car/trailer transforms and
 * throttled vehicle values before the backend snapshots the serialisable state.
 */
export function installVehicleAutosave(
  backend: Pick<SaveBackend, 'save'>,
  world: GameWorld,
  stateForSave: () => WorldState,
  nameForState: (state: WorldState) => string,
  onError: (error: unknown) => void,
): () => void {
  return world.onDelta((delta) => {
    switch (delta.t) {
      case 'enter_car':
      case 'exit_car':
      case 'car_storage':
      case 'wreck_storage':
      case 'trailer_hitch':
      case 'trailer_cargo':
      case 'gizmo_attach':
      case 'gizmo_detach':
      case 'sticker_place':
        break;
      default:
        return;
    }
    queueMicrotask(() => {
      const state = stateForSave();
      void backend
        .save(`slot-${state.seed}`, nameForState(state), state)
        .catch(onError);
    });
  });
}

const DB_NAME = 'thebrodrive-saves';
const DB_VERSION = 2;
const STORE = 'saves';

/** Record layout in IndexedDB: metadata beside a frozen snapshot of the state. */
interface StoredRecord {
  meta: SaveMeta;
  state: WorldState;
}

export class IndexedDbSaves implements SaveBackend {
  private readonly dbName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName = DB_NAME) {
    this.dbName = dbName;
  }

  /**
   * Opens the database once and caches the connection promise so every call
   * shares it. Every failure path settles the promise: `onerror`, `onblocked`
   * and the synchronous throw are all wired so a private-browsing or quota
   * environment surfaces an Error instead of leaving the promise unresolved —
   * the classic IndexedDB hang.
   */
  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(this.dbName, DB_VERSION);
      } catch (err) {
        reject(err instanceof Error ? new Error(`Failed to open save database: ${err.message}`) : new Error('Failed to open save database'));
        return;
      }
      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = request.result;
        // Version 2 changes the road spine itself. Stored world positions from v1
        // are not on that road and there is deliberately no migration: deleting
        // and recreating the store makes the incompatibility explicit instead of
        // loading a car into empty desert.
        if (event.oldVersion > 0 && db.objectStoreNames.contains(STORE)) {
          db.deleteObjectStore(STORE);
        }
        db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        reject(new Error(`Failed to open save database: ${request.error?.message ?? 'unknown error'}`));
      };
      request.onblocked = () => {
        // An older version is still held open elsewhere; without this handler the
        // promise would never settle.
        reject(new Error('Save database is blocked by another open tab'));
      };
    });
    this.dbPromise = promise;
    // Forget a failed open so a later call retries instead of inheriting a
    // permanently rejected promise. The catch branch keeps this handler silent.
    promise.catch(() => {
      if (this.dbPromise === promise) this.dbPromise = null;
    });
    return promise;
  }

  async list(): Promise<SaveMeta[]> {
    const db = await this.open();
    return new Promise<SaveMeta[]>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, 'readonly');
      } catch (err) {
        reject(err instanceof Error ? new Error(`Failed to list saves: ${err.message}`) : new Error('Failed to list saves'));
        return;
      }
      tx.onabort = () => reject(new Error('Save list read aborted'));
      const metas: SaveMeta[] = [];
      const request = tx.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const record = cursor.value as StoredRecord;
          if (record && record.meta) metas.push(record.meta);
          cursor.continue();
        } else {
          metas.sort((a, b) => b.savedAt - a.savedAt);
          resolve(metas);
        }
      };
      request.onerror = () => reject(new Error(`Failed to list saves: ${request.error?.message ?? 'unknown error'}`));
    });
  }

  async load(id: string): Promise<WorldState | null> {
    const db = await this.open();
    const record = await this.getRecord(db, id);
    if (!record) return null;
    return migrateState(record.state);
  }

  async save(id: string, name: string, state: WorldState): Promise<void> {
    // Snapshot before the first await: `state` is the live world object and the
    // game keeps mutating it after this call returns. Cloning now (IndexedDB also
    // clones on `put`) guarantees the stored copy is frozen at call time.
    const snapshot = structuredClone(state);
    const meta: SaveMeta = {
      id,
      name,
      seed: snapshot.seed,
      km: snapshot.player.s / 1000,
      playedSeconds: snapshot.playedSeconds,
      savedAt: Date.now(),
    };
    const db = await this.open();
    await this.putRecord(db, id, { meta, state: snapshot });
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, 'readwrite');
      } catch (err) {
        reject(err instanceof Error ? new Error(`Failed to delete save: ${err.message}`) : new Error('Failed to delete save'));
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error(`Failed to delete save: ${tx.error?.message ?? 'transaction aborted'}`));
      tx.onerror = () => reject(new Error(`Failed to delete save: ${tx.error?.message ?? 'unknown error'}`));
      tx.objectStore(STORE).delete(id);
    });
  }

  private getRecord(db: IDBDatabase, id: string): Promise<StoredRecord | null> {
    return new Promise<StoredRecord | null>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, 'readonly');
      } catch (err) {
        reject(err instanceof Error ? new Error(`Failed to load save: ${err.message}`) : new Error('Failed to load save'));
        return;
      }
      tx.onabort = () => reject(new Error('Save load aborted'));
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => {
        const value = request.result as StoredRecord | undefined;
        resolve(value ?? null);
      };
      request.onerror = () => reject(new Error(`Failed to load save: ${request.error?.message ?? 'unknown error'}`));
    });
  }

  private putRecord(db: IDBDatabase, id: string, record: StoredRecord): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, 'readwrite');
      } catch (err) {
        reject(err instanceof Error ? new Error(`Failed to save: ${err.message}`) : new Error('Failed to save'));
        return;
      }
      // Resolve on complete, not on the request's success event: the write must
      // actually commit before we report it durable (a quota error surfaces as an
      // abort after the request otherwise succeeds).
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error(`Failed to save: ${tx.error?.message ?? 'transaction aborted'}`));
      tx.onerror = () => reject(new Error(`Failed to save: ${tx.error?.message ?? 'unknown error'}`));
      tx.objectStore(STORE).put(record, id);
    });
  }
}

// ---------------------------------------------------------------------------
// Shareable save codes
// ---------------------------------------------------------------------------

/**
 * Version tag prefixing every code; identifies the road geometry as well as the
 * state layout. BRO3 is a clean cutover to the non-self-intersecting spine. Older
 * coordinates cannot be migrated honestly and are rejected rather than loaded off
 * the road.
 */
const CODE_TAG = 'BRO3.';
const CODE_TAGS: readonly string[] = [CODE_TAG];

/**
 * Encodes a state to a pasteable string: JSON -> UTF-8 bytes -> base64url.
 *
 * No compression: `CompressionStream` is asynchronous and this function must
 * remain synchronous per the public signature, so a compact non-stream encoding
 * is used instead. That is a deliberate tradeoff and a cheap one — a save is only
 * the player's mutations, already small. If a compressed variant is ever added,
 * it must carry its own tag (e.g. `BRO2C.`) so decoding stays unambiguous.
 */
export function encodeSaveCode(state: WorldState): string {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  return CODE_TAG + bytesToBase64Url(bytes);
}

/** Decodes a save code, validating the tag, payload and resulting structure. */
export function decodeSaveCode(code: string): WorldState {
  if (typeof code !== 'string') {
    throw new Error('Save code is malformed: missing version tag');
  }
  const tag = CODE_TAGS.find((t) => code.startsWith(t));
  if (tag === undefined) throw new Error('Save code is malformed: missing version tag');
  const payload = code.slice(tag.length);
  if (payload.length === 0) throw new Error('Save code is malformed: empty payload');

  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(payload);
  } catch (err) {
    throw new Error(`Save code is malformed: ${err instanceof Error ? err.message : 'invalid base64'}`);
  }

  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Save code is malformed: payload is not valid UTF-8');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Save code is malformed: payload is not valid JSON');
  }

  return migrateState(parsed);
}

/**
 * Validates an untyped value and rebuilds it as a `WorldState`, filling any
 * field absent from older saves with the `newWorldState` default. Shared by both
 * `load` and `decodeSaveCode` so an old save never crashes on a newly-added
 * field, while genuinely malformed data throws instead of surfacing later.
 */
export function migrateState(raw: unknown): WorldState {
  const obj = asRecord(raw, 'save data');
  const seedRaw = obj.seed;
  if (typeof seedRaw !== 'number' || !Number.isFinite(seedRaw)) {
    throw new Error('Save data is malformed: seed is missing or not a finite number');
  }
  const calendarEpoch = obj.calendarEpoch;
  if (typeof calendarEpoch !== 'string') {
    throw new Error('Save data is incompatible: calendarEpoch is missing');
  }
  try {
    parseCalendarEpoch(calendarEpoch);
  } catch {
    throw new Error('Save data is malformed: calendarEpoch is not a real ISO date');
  }
  const playerRaw = asRecord(obj.player, 'player');
  const carsRaw = recordField(obj.cars, 'cars');
  const loosePartsRaw = recordField(obj.looseParts, 'looseParts');
  const looseItemsRaw = recordField(obj.looseItems, 'looseItems');
  const trailersRaw = recordField(obj.trailers, 'trailers');
  const wreckStorageRaw = recordField(obj.wreckStorage, 'wreckStorage');

  const seed = seedRaw >>> 0;
  const defaults = newWorldState(seed);
  const dp = defaults.player;

  // A save written before the pack was persisted has no `carried`; an empty pack is
  // the honest reading of that, and matches what those saves loaded as before.
  const carriedRaw = Array.isArray(playerRaw.carried) ? playerRaw.carried : [];
  const carried: Item[] = carriedRaw.map((value, i) => migrateItem(value, `carried slot ${i}`));

  const player: PlayerState = {
    x: numOr(playerRaw.x, dp.x),
    y: numOr(playerRaw.y, dp.y),
    z: numOr(playerRaw.z, dp.z),
    yaw: numOr(playerRaw.yaw, dp.yaw),
    pitch: numOr(playerRaw.pitch, dp.pitch),
    s: numOr(playerRaw.s, dp.s),
    drivingCarId: typeof playerRaw.drivingCarId === 'string' ? playerRaw.drivingCarId : null,
    carried,
    carriedSelected: Math.min(
      Math.max(0, Math.trunc(numOr(playerRaw.carriedSelected, 0))),
      Math.max(0, carried.length - 1),
    ),
  };

  const cars: Record<string, CarState> = {};
  for (const [id, value] of Object.entries(carsRaw)) {
    cars[id] = migrateCar(asRecord(value, `car "${id}"`));
  }

  const trailers: Record<string, TrailerState> = {};
  for (const [id, value] of Object.entries(trailersRaw)) {
    trailers[id] = migrateTrailer(asRecord(value, `trailer "${id}"`));
  }

  const wreckStorage: Record<string, (Item | null)[]> = {};
  for (const [id, value] of Object.entries(wreckStorageRaw)) {
    wreckStorage[id] = migrateStorage(value, TRUNK_CELL_COUNT, `wreck "${id}" trunk`);
  }

  const looseParts: Record<string, { part: PartInstance; x: number; y: number; z: number }> = {};
  for (const [id, value] of Object.entries(loosePartsRaw)) {
    looseParts[id] = migrateLoosePart(asRecord(value, `loose part "${id}"`));
  }

  const looseItems: Record<string, { item: Item; x: number; y: number; z: number }> = {};
  for (const [id, value] of Object.entries(looseItemsRaw)) {
    looseItems[id] = migrateLooseItem(asRecord(value, `loose item "${id}"`));
  }

  return {
    seed,
    calendarEpoch,
    timeOfDay: numOr(obj.timeOfDay, defaults.timeOfDay),
    playedSeconds: numOr(obj.playedSeconds, defaults.playedSeconds),
    // Absent in a save written before the sky had per-day twilight moods; day zero
    // is correct for those.
    dayIndex: Math.max(0, Math.floor(numOr(obj.dayIndex, defaults.dayIndex))),
    recordS: numOr(obj.recordS, defaults.recordS),
    // A save written before settings existed has no field here; sanitizeSettings
    // accepts anything (including undefined) and yields a valid Settings.
    settings: sanitizeSettings(obj.settings),
    player,
    cars,
    wreckStorage,
    trailers,
    looseParts,
    looseItems,
    lootedPois: migrateNumberArray(obj.lootedPois),
    flattenedProps: migrateNumberArray(obj.flattenedProps),
    job: migrateJob(obj.job),
    stickersUnplaced: Math.max(0, Math.trunc(numOr(obj.stickersUnplaced, 0))),
    deliveredPois: migrateNumberArray(obj.deliveredPois),
  };
}

/**
 * The accepted haul. A job whose slots are not both finite integers is dropped:
 * the cargo is already on the trailer either way, and a job pointing at nowhere
 * would light no sign and never complete.
 */
function migrateJob(raw: unknown): JobState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const fromPoi = numOr(obj.fromPoi, -1);
  const toPoi = numOr(obj.toPoi, -1);
  if (fromPoi < 0 || toPoi < 0) return null;
  return {
    fromPoi: Math.trunc(fromPoi),
    toPoi: Math.trunc(toPoi),
    cargoKg: Math.max(0, numOr(obj.cargoKg, 0)),
  };
}

function migrateTrailer(raw: Record<string, unknown>): TrailerState {
  if (typeof raw.id !== 'string') {
    throw new Error('Save data is malformed: trailer is missing an id');
  }
  return {
    id: raw.id,
    // A dangling car id would leave a trailer coupled to nothing; the caller
    // re-hitches from this field, and an unknown car simply leaves it standing.
    hitchedTo: typeof raw.hitchedTo === 'string' ? raw.hitchedTo : null,
    cargoKg: Math.max(0, numOr(raw.cargoKg, 0)),
    x: numOr(raw.x, 0),
    y: numOr(raw.y, 0),
    z: numOr(raw.z, 0),
    qx: numOr(raw.qx, 0),
    qy: numOr(raw.qy, 0),
    qz: numOr(raw.qz, 0),
    qw: numOr(raw.qw, 1),
  };
}

function migrateStorage(raw: unknown, cells: number, where: string): (Item | null)[] {
  const storage = new Array<Item | null>(cells).fill(null);
  if (!Array.isArray(raw)) return storage;
  for (let i = 0; i < Math.min(raw.length, cells); i++) {
    const cell = raw[i];
    if (cell === null || cell === undefined) continue;
    try {
      storage[i] = migrateItem(cell, `${where} cell ${i}`);
    } catch {
      storage[i] = null;
    }
  }
  return storage;
}

function migrateCar(raw: Record<string, unknown>): CarState {
  if (typeof raw.id !== 'string') throw new Error('Save data is malformed: car is missing an id');

  // A pre-cutover save carries a bodyId and a part layout that has no meaning
  // against a finished model, so it is not translated part-for-part: the car
  // becomes the default model with no gizmos.
  const modelId = typeof raw.modelId === 'string' && hasCarModel(raw.modelId)
    ? raw.modelId
    : DEFAULT_CAR_MODEL_ID;

  const gizmos: Record<string, PartInstance> = {};
  const rawGizmos = raw.gizmos;
  // Gizmos are absent on pre-cutover saves; a missing or non-object value is
  // treated as empty rather than fatal. An anchor the model does not have is
  // dropped harmlessly by the vehicle, so it is not validated here.
  if (typeof rawGizmos === 'object' && rawGizmos !== null && !Array.isArray(rawGizmos)) {
    for (const [anchor, value] of Object.entries(rawGizmos as Record<string, unknown>)) {
      gizmos[anchor] = migratePart(value, `car "${raw.id}" gizmo "${anchor}"`);
    }
  }

  // Stickers are the car's whole history, so a malformed one is dropped rather than
  // failing the load: losing a mark is bad, losing the save is worse.
  const stickers: StickerState[] = [];
  if (Array.isArray(raw.stickers)) {
    for (const value of raw.stickers) {
      if (typeof value !== 'object' || value === null) continue;
      const s = value as Record<string, unknown>;
      if (typeof s.kind !== 'string') continue;
      stickers.push({
        kind: s.kind,
        x: numOr(s.x, 0),
        y: numOr(s.y, 0),
        z: numOr(s.z, 0),
        nx: numOr(s.nx, 0),
        ny: numOr(s.ny, 1),
        nz: numOr(s.nz, 0),
        roll: numOr(s.roll, 0),
      });
    }
  }

  // Reservoirs and boot cells are absent on every save written before fluids
  // existed. Those cars load with EMPTY reservoirs on purpose rather than full:
  // arriving at a mysteriously dry engine is a smaller surprise than the game
  // silently gifting fluids it never tracked, and the first can fixes it.
  const storageCells = hasCarModel(modelId) ? carModel(modelId).storageCells : 0;
  const storage = migrateStorage(raw.storage, storageCells, `car "${raw.id}" boot`);
  const def = carModel(modelId);
  const defaultBonnet = createBonnetStorage(raw.id, def.engineId, def.bodyClass, def.tankLitres);
  const bonnet = raw.bonnet === undefined
    ? defaultBonnet
    : normalizeBonnetStorage(migrateStorage(raw.bonnet, BONNET_SLOT_COUNT, `car "${raw.id}" bonnet`));
  const savedFuelKind =
    raw.fuelKind === 'petrol' || raw.fuelKind === 'diesel' || raw.fuelKind === 'mixed'
      ? raw.fuelKind
      : null;
  const fuelLitres = Math.max(0, numOr(raw.fuelLitres, 0));
  const fuelKind = fuelLitres > 0
    ? savedFuelKind ?? variant(def.engineId).engine?.fuel ?? null
    : null;

  return {
    id: raw.id,
    modelId,
    gizmos,
    stickers,
    fuelLitres,
    fuelKind,
    coolantLitres: Math.max(0, numOr(raw.coolantLitres, 0)),
    oilLitres: Math.max(0, numOr(raw.oilLitres, 0)),
    storage,
    bonnet,
    odometer: numOr(raw.odometer, 0),
    x: numOr(raw.x, 0),
    y: numOr(raw.y, 0),
    z: numOr(raw.z, 0),
    qx: numOr(raw.qx, 0),
    qy: numOr(raw.qy, 0),
    qz: numOr(raw.qz, 0),
    qw: numOr(raw.qw, 1),
  };
}

function migratePart(raw: unknown, where: string): PartInstance {
  const obj = asRecord(raw, `part at ${where}`);
  if (typeof obj.id !== 'string' || typeof obj.variantId !== 'string') {
    throw new Error(`Save data is malformed: part at ${where} is missing id/variantId`);
  }
  return {
    id: obj.id,
    variantId: obj.variantId,
    dirt: numOr(obj.dirt, 0),
    rust: numOr(obj.rust, 0),
  };
}

function migrateLoosePart(raw: Record<string, unknown>): { part: PartInstance; x: number; y: number; z: number } {
  return {
    part: migratePart(raw.part, 'loose part'),
    x: numOr(raw.x, 0),
    y: numOr(raw.y, 0),
    z: numOr(raw.z, 0),
  };
}

function migrateLooseItem(raw: Record<string, unknown>): { item: Item; x: number; y: number; z: number } {
  return {
    item: migrateItem(raw.item, 'loose item'),
    x: numOr(raw.x, 0),
    y: numOr(raw.y, 0),
    z: numOr(raw.z, 0),
  };
}

function migrateItem(raw: unknown, where: string): Item {
  const obj = asRecord(raw, `item at ${where}`);
  if (typeof obj.id !== 'string') {
    throw new Error(`Save data is malformed: item at ${where} is missing an id`);
  }
  switch (obj.type) {
    case 'tool': {
      const tool = obj.tool;
      if (tool !== 'brush' && tool !== 'sponge' && tool !== 'wrench') {
        throw new Error(`Save data is malformed: item at ${where} has an invalid tool`);
      }
      return { type: 'tool', id: obj.id, tool, integrity: numOr(obj.integrity, 1) };
    }
    case 'part':
      return { type: 'part', id: obj.id, part: migratePart(obj.part, `item at ${where}`) };
    // `fuel_can` is the pre-fluids tag. Petrol and diesel were the only two kinds
    // then, so an old can maps straight across and keeps its contents.
    case 'fuel_can':
    case 'fluid_can': {
      const fluid = obj.type === 'fuel_can' ? obj.fuel : obj.fluid;
      if (fluid !== 'petrol' && fluid !== 'diesel' && fluid !== 'coolant' && fluid !== 'oil') {
        throw new Error(`Save data is malformed: item at ${where} has an invalid fluid`);
      }
      return {
        type: 'fluid_can',
        id: obj.id,
        fluid,
        capacity: numOr(obj.capacity, 0),
        litres: numOr(obj.litres, 0),
      };
    }
    case 'weapon': {
      const weapon = obj.weapon;
      if (weapon !== 'rifle' && weapon !== 'shotgun') {
        throw new Error(`Save data is malformed: item at ${where} has an invalid weapon`);
      }
      return {
        type: 'weapon',
        id: obj.id,
        weapon,
        loaded: numOr(obj.loaded, 0),
        magazine: numOr(obj.magazine, 0),
        cycleTime: numOr(obj.cycleTime, 0),
        muzzleVelocity: numOr(obj.muzzleVelocity, 0),
        hipSpread: numOr(obj.hipSpread, 0),
      };
    }
    case 'ammo': {
      const forWeapon = obj.forWeapon;
      if (forWeapon !== 'rifle' && forWeapon !== 'shotgun') {
        throw new Error(`Save data is malformed: item at ${where} has an invalid ammo target`);
      }
      return { type: 'ammo', id: obj.id, forWeapon, count: numOr(obj.count, 0) };
    }
    case 'quarry':
      return { type: 'quarry', id: obj.id, species: typeof obj.species === 'string' ? obj.species : 'unknown', mass: numOr(obj.mass, 0) };
    case 'bubble_gum':
      return {
        type: 'bubble_gum',
        id: obj.id,
        charges: Math.min(5, Math.max(1, Math.trunc(numOr(obj.charges, 5)))),
      };
    default:
      throw new Error(`Save data is malformed: item at ${where} has an unknown type`);
  }
}

function migrateNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item)) out.push(item);
  }
  return out;
}


// ---------------------------------------------------------------------------
// Seed parsing
// ---------------------------------------------------------------------------

/**
 * Turns free-form seed input into a uint32. Empty input yields a random seed;
 * a pure decimal integer is coerced to uint32; anything else hashes its
 * characters so words like "cactus" are stable, reproducible seeds.
 */
export function parseSeed(input: string): number {
  const trimmed = input.trim();
  if (trimmed === '') {
    return Math.floor(Math.random() * 0x100000000) >>> 0;
  }
  if (/^[0-9]+$/.test(trimmed)) {
    // BigInt avoids float precision loss for seeds past 2^53 (players do paste
    // large ids), then mod 2^32 keeps the result within uint32.
    return Number(BigInt(trimmed) % 0x1_0000_0000n) >>> 0;
  }
  const chars: number[] = [];
  for (let i = 0; i < trimmed.length; i++) chars.push(trimmed.charCodeAt(i));
  return hash(...chars);
}

// ---------------------------------------------------------------------------
// Codec and validation helpers
// ---------------------------------------------------------------------------

/** Validates a persisted value is a plain object and narrows it to a record. */
function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Save data is malformed: ${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Absent (an older save) -> empty record; present -> must be a plain object.
 * This is how collections that predate a field keep loading without crashing.
 */
function recordField(value: unknown, what: string): Record<string, unknown> {
  return value === undefined ? {} : asRecord(value, what);
}

/** The value if it is a finite number, otherwise the fallback. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // btoa has a bounded argument length; assemble the binary string in chunks.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(input: string): Uint8Array {
  // Reject anything a lenient `atob` might otherwise silently mangle. A valid
  // unpadded base64url string has no length congruent to 1 mod 4.
  if (!/^[A-Za-z0-9_-]*$/.test(input) || input.length % 4 === 1) {
    throw new Error('invalid base64url payload');
  }
  const standard = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
