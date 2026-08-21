import { hash } from '../core/rng';
import { newWorldState } from '../game/state';
import type { CarState, PlayerState, WorldState } from '../game/state';
import type { Item } from '../items/items';
import type { PartInstance } from '../parts/registry';

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

const DB_NAME = 'thebrodrive-saves';
const DB_VERSION = 1;
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
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
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

/** Version tag prefixing every code; identifies the format for `decodeSaveCode`. */
const CODE_TAG = 'BRO1.';

/**
 * Encodes a state to a pasteable string: JSON -> UTF-8 bytes -> base64url.
 *
 * No compression: `CompressionStream` is asynchronous and this function must
 * remain synchronous per the public signature, so a compact non-stream encoding
 * is used instead. That is a deliberate tradeoff and a cheap one — a save is only
 * the player's mutations, already small. If a compressed variant is ever added,
 * it must carry its own tag (e.g. `BRO1C.`) so decoding stays unambiguous.
 */
export function encodeSaveCode(state: WorldState): string {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  return CODE_TAG + bytesToBase64Url(bytes);
}

/** Decodes a save code, validating the tag, payload and resulting structure. */
export function decodeSaveCode(code: string): WorldState {
  if (typeof code !== 'string' || !code.startsWith(CODE_TAG)) {
    throw new Error('Save code is malformed: missing version tag');
  }
  const payload = code.slice(CODE_TAG.length);
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
  const playerRaw = asRecord(obj.player, 'player');
  const carsRaw = recordField(obj.cars, 'cars');
  const loosePartsRaw = recordField(obj.looseParts, 'looseParts');
  const looseItemsRaw = recordField(obj.looseItems, 'looseItems');

  const seed = seedRaw >>> 0;
  const defaults = newWorldState(seed);
  const dp = defaults.player;

  const player: PlayerState = {
    x: numOr(playerRaw.x, dp.x),
    y: numOr(playerRaw.y, dp.y),
    z: numOr(playerRaw.z, dp.z),
    yaw: numOr(playerRaw.yaw, dp.yaw),
    pitch: numOr(playerRaw.pitch, dp.pitch),
    s: numOr(playerRaw.s, dp.s),
    drivingCarId: typeof playerRaw.drivingCarId === 'string' ? playerRaw.drivingCarId : null,
  };

  const cars: Record<string, CarState> = {};
  for (const [id, value] of Object.entries(carsRaw)) {
    cars[id] = migrateCar(asRecord(value, `car "${id}"`));
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
    timeOfDay: numOr(obj.timeOfDay, defaults.timeOfDay),
    playedSeconds: numOr(obj.playedSeconds, defaults.playedSeconds),
    recordS: numOr(obj.recordS, defaults.recordS),
    player,
    cars,
    looseParts,
    looseItems,
    lootedPois: migrateNumberArray(obj.lootedPois),
    consumedParts: migrateStringArray(obj.consumedParts),
  };
}

function migrateCar(raw: Record<string, unknown>): CarState {
  if (typeof raw.id !== 'string') throw new Error('Save data is malformed: car is missing an id');
  if (typeof raw.bodyId !== 'string') throw new Error(`Save data is malformed: car "${raw.id}" is missing a bodyId`);

  const slots: Record<string, PartInstance> = {};
  const rawSlots = raw.slots;
  // Slots are optional on very old saves; a non-object slots value is treated as
  // empty rather than fatal.
  if (typeof rawSlots === 'object' && rawSlots !== null && !Array.isArray(rawSlots)) {
    for (const [slot, value] of Object.entries(rawSlots as Record<string, unknown>)) {
      slots[slot] = migratePart(value, `car "${raw.id}" slot "${slot}"`);
    }
  }

  return {
    id: raw.id,
    bodyId: raw.bodyId,
    slots,
    fuelLitres: numOr(raw.fuelLitres, 0),
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
    wear: numOr(obj.wear, 0),
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
    case 'fuel_can': {
      const fuel = obj.fuel;
      if (fuel !== 'petrol' && fuel !== 'diesel') {
        throw new Error(`Save data is malformed: item at ${where} has an invalid fuel`);
      }
      return { type: 'fuel_can', id: obj.id, fuel, capacity: numOr(obj.capacity, 0), litres: numOr(obj.litres, 0) };
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

function migrateStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
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
