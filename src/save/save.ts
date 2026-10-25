import { hash } from '../core/rng';
import { parseCalendarEpoch } from '../game/calendar';
import { DAY_LENGTH, MIRROR_FIELD, newWorldState, PLAYER_SEATS, SAVE_VERSION, type PlayerSeat } from '../game/state';
import type {
  CarState,
  HaulState,
  HeadlightMode,
  PlayerState,
  StickerState,
  TrailerState,
  TrailerLoad,
  WorldState,
  GameWorld,
} from '../game/state';
import { COLD_SOAK_C } from '../vehicle/cooling';
import { sanitizeSettings } from '../game/settings';
import { hasVariant, type PartInstance } from '../parts/registry';
import { carPrice } from '../economy/economy';
import {
  CAMERA_FRAME_LIMIT,
  isHaul,
  SPONGE_CAPACITY_MAX,
  SPONGE_CAPACITY_MIN,
  type ContractCargoItem,
  type Item,
} from '../items/items';
import { isHaulThing, isThingId, thingDef } from '../items/things';
import { isStickerKind, STICKER_SCALE_MAX, STICKER_SCALE_MIN } from '../items/stickercatalog';
import { isContractKind } from '../contracts/registry';
import type { ContractKind, ContractProgress } from '../contracts/types';
import {
  AIR_FILTER_CELL,
  createBonnetStorage,
  factoryAirFilter,
  normalizeBonnetStorage,
  BONNET_SLOT_COUNT,
} from '../vehicle/bonnet';
import { CAR_MODELS, carModel, DEFAULT_CAR_MODEL_ID, hasCarModel } from '../vehicle/carmodels';
import { bootFreeAnchor, normalizeBoot, trunkCellCount } from '../vehicle/trunk';
import { carPaintSwatch, visiblePaintHex, type CarPaint } from '../vehicle/carpaint';
import { CABIN_PLACE_COUNT } from '../vehicle/cabin';
import { weatherBeginS } from '../world/weather';

/** A post's saved stock (contracts/offers.ts `postStock`): fixed, no car's boot. */
const POST_STOCK_CELL_COUNT = 8;

/**
 * Save files, as both IndexedDB records and shareable text codes.
 *
 * A save holds only `WorldState` — the player's mutations of an otherwise
 * procedural world. Generated road, terrain, POIs and chunks remain a pure
 * function of `seed`; physical photographs are embedded because their pixels
 * cannot be regenerated from procedural state.
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

/**
 * What a save row and the pause sheet show about a drive, beyond the stored metadata:
 * the car, its colour and the in-game clock, which are what tell two drives apart.
 *
 * Read from the snapshot rather than stored beside it, so every save already written
 * has one, and nothing about the save format changes to add a line to a menu.
 */
export interface DriveSummary {
  readonly km: number;
  /** The car being driven, else the one parked nearest the player; null with no car. */
  readonly carLabel: string | null;
  /** That car's visible colour, 0xRRGGBB. */
  readonly paintHex: number | null;
  /** Whole in-game days elapsed; day one is 0. */
  readonly dayIndex: number;
  /** How far through the in-game day, 0 at midnight and 0.5 at noon. */
  readonly dayFraction: number;
}

export interface SaveListing {
  readonly meta: SaveMeta;
  /** Null when the snapshot is too broken to summarise; the row falls back to `meta`. */
  readonly drive: DriveSummary | null;
}

export interface SaveBackend {
  list(): Promise<SaveListing[]>;
  load(id: string): Promise<WorldState | null>;
  save(id: string, name: string, state: WorldState): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * The summary of a live or stored state. Defensive on every field: stored snapshots
 * are not migrated before listing, and a save older than a field must still list.
 */
export function summarizeDrive(state: WorldState): DriveSummary {
  const player = state.player;
  const cars = Object.values(state.cars ?? {});
  let car = player.drivingCarId ? state.cars[player.drivingCarId] : undefined;
  if (car === undefined) {
    let best = Infinity;
    for (const candidate of cars) {
      const d = (candidate.x - player.x) ** 2 + (candidate.z - player.z) ** 2;
      if (d < best) {
        best = d;
        car = candidate;
      }
    }
  }
  // The body the save will load on (`worldModelId`), not the one it names.
  const modelId = car !== undefined ? worldModelId(car.modelId) : null;
  return {
    km: numOr(player.s, 0) / 1000,
    carLabel: modelId !== null ? carModel(modelId).label : null,
    paintHex: car !== undefined && modelId !== null ? visiblePaintHex(migrateCarPaint(car.paint), modelId, car.id) : null,
    dayIndex: Math.max(0, Math.trunc(numOr(state.dayIndex, 0))),
    dayFraction: (((numOr(state.timeOfDay, 0) / DAY_LENGTH) % 1) + 1) % 1,
  };
}

/**
 * Saves after vehicle entry/exit and discrete mutations made while on foot. The
 * microtask is load-bearing: exit teleports the player and trunk transfers update
 * inventory immediately before storage, so the save must observe the completed
 * interaction rather than the first delta in it.
 *
 * Nothing that happens behind the wheel is a trigger — not a crash, not the
 * headlights. A save booked mid-drive can capture the fatal crash, and the reload then
 * drops the player into a wreck they can no longer avoid. Wear and the rest live in
 * state and ride along with the next exit; a player who wrecks the car can reload the
 * drive from where they got in.
 *
 * `stateForSave` lets the runtime flush physics-owned car/trailer transforms and
 * throttled vehicle values — among them the shell's dirt, which accumulates every
 * tick and is written through on every save — before the backend snapshots the
 * serialisable state.
 *
 * `onSaved` is called with the slot id as each autosave is BOOKED, not when it lands,
 * and deliberately: it exists so a reload can find the drive that was in progress (see
 * save/resume.ts), and a resumed session whose slot id was never written simply falls
 * back to the title screen. Waiting for the write would add an await to the crash it is
 * meant to survive, and a caller with nothing to remember simply omits it.
 */
export function installVehicleAutosave(
  backend: Pick<SaveBackend, 'save'>,
  world: GameWorld,
  stateForSave: () => WorldState,
  nameForState: (state: WorldState) => string,
  onError: (error: unknown) => void,
  onSaved?: (slotId: string) => void,
): () => void {
  return world.onDelta((delta) => {
    switch (delta.t) {
      // Listeners run after the reducer: on entry the player is already driving.
      case 'enter_car':
      case 'exit_car':
        break;
      case 'car_storage':
      case 'car_cabin':
      case 'car_bonnet':
      case 'car_lights':
      // A post's offer released, or cargo posted (world/post.ts).
      case 'courier_storage':
      case 'trailer_hitch':
      case 'trailer_cargo':
      case 'sticker_place':
      case 'inventory':
      // A purchase (world/vending.ts, world/keybox.ts): the money and what it bought.
      case 'vend_sold':
      case 'lot_pay':
      case 'car_buy':
      // A car into or out of the toy box (world/toybox.ts).
      case 'car_box':
      case 'car_unbox':
      // A haul card taken at a post, or its load handed in (contracts/haulbays.ts).
      case 'haul_take':
      case 'haul_close':
      // A teddy seated on a shelter's bench (contracts/shelters.ts).
      case 'teddy_seat':
        if (world.state.player.drivingCarId) return;
        break;
      default:
        return;
    }
    queueMicrotask(() => {
      autosaveNow(backend, stateForSave, nameForState, onError, onSaved);
    });
  });
}

/**
 * Writes the autosave slot now: the booking every autosave trigger shares, and what
 * the runtime calls when the page is hidden, so a drive left mid-road keeps its dust,
 * fuel and position rather than those of the last discrete event.
 */
export function autosaveNow(
  backend: Pick<SaveBackend, 'save'>,
  stateForSave: () => WorldState,
  nameForState: (state: WorldState) => string,
  onError: (error: unknown) => void,
  onSaved?: (slotId: string) => void,
): void {
  const state = stateForSave();
  const slotId = `slot-${state.seed}`;
  onSaved?.(slotId);
  void backend.save(slotId, nameForState(state), state).catch(onError);
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

  async list(): Promise<SaveListing[]> {
    const db = await this.open();
    return new Promise<SaveListing[]>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, 'readonly');
      } catch (err) {
        reject(err instanceof Error ? new Error(`Failed to list saves: ${err.message}`) : new Error('Failed to list saves'));
        return;
      }
      tx.onabort = () => reject(new Error('Save list read aborted'));
      const listings: SaveListing[] = [];
      const request = tx.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const record = cursor.value as StoredRecord;
          if (record && record.meta && record.state) {
            // A snapshot too broken to summarise still lists, by its stored name and
            // distance: the row is how the player finds out it no longer loads.
            let drive: DriveSummary | null;
            try {
              drive = summarizeDrive(record.state);
            } catch {
              drive = null;
            }
            listings.push({ meta: record.meta, drive });
          }
          cursor.continue();
        } else {
          listings.sort((a, b) => b.meta.savedAt - a.meta.savedAt);
          resolve(listings);
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
 * remain synchronous per the public signature.
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
  // `wreckStorage`/`wreckBonnet` of saves from the roadside-shell days are ignored: the
  // shells are gone, and nothing they held can be reached any more.
  const courierStorageRaw = recordField(obj.courierStorage, 'courierStorage');

  const seed = seedRaw >>> 0;
  const version = numOr(obj.saveVersion, 1);
  const defaults = newWorldState(seed);
  const dp = defaults.player;

  // Removed item kinds cannot remain in the current inventory union. Drop only
  // those explicitly retired by the game; malformed current items still reject
  // the save instead of being silently lost.
  const carriedRaw = Array.isArray(playerRaw.carried) ? playerRaw.carried : [];
  const carried: Item[] = [];
  for (let i = 0; i < carriedRaw.length; i++) {
    const value = carriedRaw[i];
    if (isRemovedLegacyItem(value)) continue;
    carried.push(migrateItem(value, `carried slot ${i}`));
  }
  const wornRaw = playerRaw.wornSunShades;
  const wornItem = wornRaw == null ? null : migrateItem(wornRaw, 'worn sun shades');
  if (wornItem !== null && wornItem.type !== 'sun_shades') {
    throw new Error('Save data is malformed: worn item is not sun shades');
  }

  // Only the fields named here are read. A save from the police days (2026-10-18 to
  // 10-21) also carries `player.police` (heat, heatUntil); the police are gone and it
  // is dropped.
  const player: PlayerState = {
    x: numOr(playerRaw.x, dp.x),
    y: numOr(playerRaw.y, dp.y),
    z: numOr(playerRaw.z, dp.z),
    yaw: numOr(playerRaw.yaw, dp.yaw),
    pitch: numOr(playerRaw.pitch, dp.pitch),
    health: Math.min(1, Math.max(0, numOr(playerRaw.health, dp.health))),
    s: numOr(playerRaw.s, dp.s),
    drivingCarId: typeof playerRaw.drivingCarId === 'string' ? playerRaw.drivingCarId : null,
    // Saves from before seats were always in the driver's.
    seat: PLAYER_SEATS.includes(playerRaw.seat as PlayerSeat) ? (playerRaw.seat as PlayerSeat) : 'driver',
    lastDrivenCarId: typeof playerRaw.lastDrivenCarId === 'string' ? playerRaw.lastDrivenCarId : null,
    carried,
    carriedSelected: Math.min(
      Math.max(0, Math.trunc(numOr(playerRaw.carriedSelected, 0))),
      Math.max(0, carried.length - 1),
    ),
    wornSunShades: wornItem,
    // A save from the coin days carries its coins instead (`legacyCoinRubles`); one
    // from the kopeck days, kopecks.
    money: version < 3
      ? legacyCoinRubles(carriedRaw, looseItemsRaw, carsRaw, courierStorageRaw)
      : legacyRubles(numOr(playerRaw.money, 0), version),
  };

  const cars: Record<string, CarState> = {};
  for (const [id, value] of Object.entries(carsRaw)) {
    cars[id] = migrateCar(asRecord(value, `car "${id}"`), version);
  }
  // The last driven car must still be out in the world: gone or boxed, it is forgotten.
  if (player.lastDrivenCarId !== null && !cars[player.lastDrivenCarId]) player.lastDrivenCarId = null;
  // A tow bar needs both ends and only one end per car. Checked here, where the
  // whole car set is known: a save naming a tower that is gone (or claiming a
  // second car on one tower, or a three-car chain) loads with the bar off rather
  // than with a coupling the runtime would have to hallucinate.
  for (const car of Object.values(cars)) {
    const towerId = car.towedBy ?? null;
    if (towerId === null) continue;
    const tower = cars[towerId];
    if (
      towerId === car.id ||
      !tower ||
      tower.towedBy != null
    ) {
      car.towedBy = null;
    }
  }
  const towedIds = new Set<string>();
  for (const car of Object.values(cars)) {
    const towerId = car.towedBy ?? null;
    if (towerId !== null && towedIds.has(towerId)) car.towedBy = null;
    else if (towerId !== null) towedIds.add(towerId);
  }
  // The boxed cars (world/toybox.ts): the player's own, out of the world, off any bar.
  const toyBox: Record<string, CarState> = {};
  for (const [id, value] of Object.entries(recordField(obj.toyBox, 'toyBox'))) {
    const car = migrateCar(asRecord(value, `boxed car "${id}"`), version);
    if (!car.papers || cars[id]) continue;
    car.towedBy = null;
    toyBox[id] = car;
  }

  const trailers: Record<string, TrailerState> = {};
  for (const [id, value] of Object.entries(trailersRaw)) {
    trailers[id] = migrateTrailer(asRecord(value, `trailer "${id}"`));
  }

  const courierStorage: Record<string, (Item | null)[]> = {};
  for (const [id, value] of Object.entries(courierStorageRaw)) {
    // A post's stock (contracts/offers.ts `postStock`); a courier-era boot of eight
    // cells reads the same way, its leftovers handed back through the post's tray.
    courierStorage[id] = migrateStorage(value, POST_STOCK_CELL_COUNT, `post "${id}" stock`);
  }

  const looseParts: Record<string, { part: PartInstance; x: number; y: number; z: number }> = {};
  for (const [id, value] of Object.entries(loosePartsRaw)) {
    const raw = asRecord(value, `loose part "${id}"`);
    // A part whose variant left the catalogue (the diesel engines, the fuel tanks) is dropped with it.
    try {
      looseParts[id] = migrateLoosePart(raw);
    } catch {
      continue;
    }
  }

  const looseItems: Record<string, { item: Item; x: number; y: number; z: number }> = {};
  for (const [id, value] of Object.entries(looseItemsRaw)) {
    const raw = asRecord(value, `loose item "${id}"`);
    if (isRemovedLegacyItem(raw.item)) continue;
    looseItems[id] = migrateLooseItem(raw);
  }

  const completedContractIds = migrateStringArray(obj.completedContractIds);

  return {
    seed,
    saveVersion: SAVE_VERSION,
    calendarEpoch,
    timeOfDay: numOr(obj.timeOfDay, defaults.timeOfDay),
    playedSeconds: numOr(obj.playedSeconds, defaults.playedSeconds),
    // Absent in a save written before the sky had per-day twilight moods; day zero
    // is correct for those.
    dayIndex: Math.max(0, Math.floor(numOr(obj.dayIndex, defaults.dayIndex))),
    recordS: numOr(obj.recordS, defaults.recordS),
    weatherFromS: migrateWeatherFromS(obj.weatherFromS, seed, numOr(obj.recordS, defaults.recordS)),
    // A save written before settings existed has no field here; sanitizeSettings
    // accepts anything (including undefined) and yields a valid Settings. Desktop
    // presentation for a missing frame height: a save's settings never reach a phone's
    // renderer, because stored preferences and `PHONE_FIRST_LAUNCH` outrank them (main.ts).
    settings: sanitizeSettings(obj.settings, false),
    player,
    cars,
    toyBox,
    courierStorage,
    completedContractIds,
    deliveriesByKind: migrateDeliveriesByKind(obj.deliveriesByKind),
    hauls: migrateHauls(obj.hauls, cars, trailers),
    handedInLoads: migrateHandedInLoads(obj.handedInLoads, cars, trailers),
    shelterRounds: migrateShelterRounds(obj.shelterRounds),
    trailers,
    looseParts,
    looseItems,
    flattenedProps: migrateNumberArray(obj.flattenedProps),
    vendingSold: migrateVendingSold(obj.vendingSold),
  };
}

/**
 * The hauls taken (game-design2.md §7.8), each its card and the load it is bound to. One
 * whose card does not read as a haul, or whose load is no longer in the world, is
 * dropped: there is nothing left to hand in.
 */
function migrateHauls(
  raw: unknown,
  cars: Readonly<Record<string, CarState>>,
  trailers: Readonly<Record<string, TrailerState>>,
): Record<string, HaulState> {
  const out: Record<string, HaulState> = {};
  for (const [id, value] of Object.entries(recordField(raw, 'hauls'))) {
    const obj = asRecord(value, `haul "${id}"`);
    let contract: Item;
    try {
      contract = migrateItem(obj.contract, `haul "${id}"`);
    } catch {
      continue;
    }
    const loadId = obj.loadId;
    if (contract.type !== 'contract_cargo' || contract.id !== id || !isHaul(contract)) continue;
    if (typeof loadId !== 'string' || (!cars[loadId] && !trailers[loadId])) continue;
    out[id] = { contract, loadId };
  }
  return out;
}

/** The loads handed in, by load id: the post whose bay each stands in. One no longer in the world is dropped. */
function migrateHandedInLoads(
  raw: unknown,
  cars: Readonly<Record<string, CarState>>,
  trailers: Readonly<Record<string, TrailerState>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, index] of Object.entries(recordField(raw, 'handedInLoads'))) {
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && (cars[id] || trailers[id])) out[id] = index;
  }
  return out;
}

/** The teddy shelters' rounds, by post index: whole numbers from 0, anything else dropped. */
function migrateShelterRounds(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [index, round] of Object.entries(recordField(raw, 'shelterRounds'))) {
    if (/^\d+$/.test(index) && typeof round === 'number' && Number.isInteger(round) && round >= 0) out[index] = round;
  }
  return out;
}

/**
 * Played second the weather schedule began. A save from before the clear start has no
 * field: one already past the gate keeps the schedule it was driving under (from zero),
 * any other starts on clear sky like a new game.
 */
function migrateWeatherFromS(value: unknown, seed: number, recordS: number): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (value === null) return null;
  return recordS >= weatherBeginS(seed) ? 0 : null;
}

/**
 * Vending slots sold, by machine id. Absent on every save from before the machines:
 * nothing sold. A malformed entry drops that machine's record, which only restocks it.
 */
function migrateVendingSold(value: unknown): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out;
  for (const [id, slots] of Object.entries(value as Record<string, unknown>)) {
    const sold = migrateNumberArray(slots).filter((slot) => Number.isInteger(slot) && slot >= 0);
    if (sold.length > 0) out[id] = sold;
  }
  return out;
}

function migrateTrailer(raw: Record<string, unknown>): TrailerState {
  if (typeof raw.id !== 'string') {
    throw new Error('Save data is malformed: trailer is missing an id');
  }
  const trailer: TrailerState = {
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
  // Bounded rather than trusted, like the load below; the trailer clamps it again to
  // what keeps the crate on the bed.
  if (typeof raw.cargoZ === 'number' && Number.isFinite(raw.cargoZ)) {
    trailer.cargoZ = Math.min(1, Math.max(-1, raw.cargoZ));
  }
  const load = migrateTrailerLoad(raw.load);
  if (load !== null) trailer.load = load;
  if (isThingId(raw.loadThing)) {
    trailer.loadThing = raw.loadThing;
    // A contract thing's long load is the catalogue's shape, not the save's: a bed
    // saved before 2026-10-25 was a 3.2 x 1.6 m box across the tops of the sides, which
    // stood against the headboard now would put the trailer on its tail.
    const shape = thingDef(raw.loadThing).trailerLoad;
    if (shape) trailer.load = { halfExtents: shape };
  }
  return trailer;
}

/**
 * A trailer's long load. `halfExtents` sizes a real collider, so they are bounded
 * rather than trusted: a corrupt save must not hand Rapier a 40 m box.
 */
function migrateTrailerLoad(raw: unknown): TrailerLoad | null {
  if (raw === null || raw === undefined) return null;
  const obj = asRecord(raw, 'trailer load');
  const ext = obj.halfExtents;
  if (!Array.isArray(ext) || ext.length !== 3) return null;
  const half: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const value = ext[i];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    half[i] = Math.min(6, value);
  }
  return { halfExtents: half };
}

/** Where a version 1 bonnet kept its fuel tank, between the radiator and the air filter. */
const LEGACY_TANK_CELL = 3;

/**
 * A saved bonnet in the current cell layout. Before `SAVE_VERSION` 2 the fuel tank had
 * a cell; the tank is the body's own now, so that cell goes with whatever was in it and
 * the air filter moves up into it. A bonnet saved before the filter had a cell ends at
 * the tank and comes out three long, which `migrateCar` reads as filterless.
 */
function migrateBonnetLayout(raw: unknown, version: number): unknown {
  if (version >= 2 || !Array.isArray(raw)) return raw;
  return raw.filter((_, cell) => cell !== LEGACY_TANK_CELL);
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

/** A saved respray, or null (factory colour) when absent or not three numbers. */
function migrateCarPaint(raw: unknown): CarPaint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const colour = (value: unknown): number | null =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff
      ? value
      : null;
  const base = colour(obj.base);
  const coat = colour(obj.coat);
  if (base === null || coat === null) return null;
  return { base, coat, cover: clamp01(numOr(obj.cover, 1)) };
}

/**
 * Bodies the catalogue dropped for a new body of the same car: the save keeps the car,
 * running gear and all, on the body that replaced it. The GTA SA Oka gave way to the
 * carforge one (2026-10-12); the 2105 rally car has no kit body and becomes the kit 2105;
 * the pack Nivas, whose ids do not name the model, load on the kit 2121 and 2131; the
 * police UAZ-469 went with the police (2026-10-21) and loads as the plain 469.
 */
const RETIRED_MODEL_IDS: Readonly<Record<string, string>> = {
  sa_oka: 'cf_vaz1111',
  sv_vaz2105r: 'kit_vaz2105',
  sv_niva: 'kit_vaz2121',
  sv_niva_long: 'kit_vaz2131',
  kit_uaz469_police: 'kit_uaz469',
};

/**
 * The world's body for a saved model id. Only kit bodies drive in the world now
 * (2026-10-13, `CAR_MODELS`): a car saved on a pack body (`sv_vaz2101`, `sa_vaz2109`,
 * `gt_vaz2110`, `sa_azlk2141`, …) loads on the kit body of the same car (`kit_vaz2101`,
 * `kit_azlk2141`, …), and one with no kit twin (the UAZs, the GAZ-21, …) on the default.
 * The carforge Oka (`cf_vaz1111`, and the retired `sa_oka` through it) loads on
 * `kit_vaz1111`, the carforge Volga (`cf_gaz31029`) on `kit_gaz31029`.
 */
function worldModelId(saved: unknown): string {
  if (typeof saved !== 'string') return DEFAULT_CAR_MODEL_ID;
  const id = RETIRED_MODEL_IDS[saved] ?? saved;
  if (CAR_MODELS.some((model) => model.id === id)) return id;
  const twin = `kit_${id.slice(id.indexOf('_') + 1)}`;
  return CAR_MODELS.some((model) => model.id === twin) ? twin : DEFAULT_CAR_MODEL_ID;
}

function migrateCar(raw: Record<string, unknown>, version: number): CarState {
  if (typeof raw.id !== 'string') throw new Error('Save data is malformed: car is missing an id');

  // A pre-cutover save carries a bodyId and a part layout that has no meaning
  // against a finished model, so it is not translated part-for-part: the car
  // becomes the default model. Any `gizmos` map it also carries is dropped with the
  // mechanic — the anchors and the mounting interaction are gone, so there is
  // nowhere for those parts to be, and inventing loose parts for them would put
  // scrap in the world the player never dropped.
  const modelId = worldModelId(raw.modelId);

  // Stickers are the car's whole history, so a malformed one is dropped rather than
  // failing the load: losing a mark is bad, losing the save is worse.
  const stickers: StickerState[] = [];
  if (Array.isArray(raw.stickers)) {
    for (let index = 0; index < raw.stickers.length; index++) {
      const value = raw.stickers[index];
      if (typeof value !== 'object' || value === null) continue;
      const s = value as Record<string, unknown>;
      // Saves before the catalog have no kind worth reading: they are all stars.
      const kind = s.kind === undefined ? 'star' : s.kind;
      if (!isStickerKind(kind)) continue;
      stickers.push({
        id: typeof s.id === 'string' ? s.id : `legacy:${raw.id}:sticker:${index}`,
        kind,
        x: numOr(s.x, 0),
        y: numOr(s.y, 0),
        z: numOr(s.z, 0),
        nx: numOr(s.nx, 0),
        ny: numOr(s.ny, 1),
        nz: numOr(s.nz, 0),
        roll: numOr(s.roll, 0),
        scale: Math.min(STICKER_SCALE_MAX, Math.max(STICKER_SCALE_MIN, numOr(s.scale, 1))),
        mirror: s.mirror === true,
      });
    }
  }

  // Reservoirs and boot cells are absent on every save written before fluids
  // existed. Those cars load with EMPTY reservoirs on purpose rather than full:
  // arriving at a mysteriously dry engine is a smaller surprise than the game
  // silently gifting fluids it never tracked, and the first can fixes it.
  const storageCells = hasCarModel(modelId) ? trunkCellCount(carModel(modelId).trunkGrid) : 0;
  const storage = withoutHaulPapers(migrateStorage(raw.storage, storageCells, `car "${raw.id}" boot`));
  // Each thing at its anchor, fitting its cells (vehicle/trunk.ts); a misfit is dropped.
  if (hasCarModel(modelId)) normalizeBoot(storage, carModel(modelId).trunkGrid);
  const def = carModel(modelId);
  const savedBonnet = migrateBonnetLayout(raw.bonnet, version);
  const bonnet = savedBonnet === undefined
    ? createBonnetStorage(raw.id, def.engineId)
    : normalizeBonnetStorage(migrateStorage(savedBonnet, BONNET_SLOT_COUNT, `car "${raw.id}" bonnet`));
  // A bonnet saved before the air filter had its cell gets the factory filter: the car
  // ran without one only because the game did not model it.
  if (Array.isArray(savedBonnet) && savedBonnet.length <= AIR_FILTER_CELL) {
    bonnet[AIR_FILTER_CELL] = factoryAirFilter(raw.id);
  }
  // There is one fuel. A tank saved holding diesel or a mixture keeps its litres as it.
  // The tank is the body's own now, so a level saved against a bigger fitted tank is
  // cut to what this body holds.
  const fuelLitres = Math.min(def.tankLitres, Math.max(0, numOr(raw.fuelLitres, 0)));

  const headlightMode: HeadlightMode =
    raw.headlightMode === 'low' || raw.headlightMode === 'high' ? raw.headlightMode : 'off';
  const taillightsOn = raw.taillightsOn === true;
  const reverseLightsOn = raw.reverseLightsOn === true;

  const car: CarState = {
    id: raw.id,
    modelId,
    stickers,
    headlightMode,
    taillightsOn,
    reverseLightsOn,
    fuelLitres,
    // `coolantLitres` is the pre-rename tag for the same reservoir (now the
    // radiator's water), so an old save keeps exactly what it had in it.
    waterLitres: Math.max(0, numOr(raw.waterLitres ?? raw.coolantLitres, 0)),
    oilLitres: Math.max(0, numOr(raw.oilLitres, 0)),
    // Absent on every save written before the engine had a temperature. Those cars
    // load COLD rather than at their operating temperature: a saved car has been
    // parked, and a cold engine is both the safe assumption and the one the player
    // can see is right on the gauge.
    engineTempC: Math.min(400, Math.max(-60, numOr(raw.engineTempC, COLD_SOAK_C))),
    storage,
    bonnet,
    // Absent on saves written before things could lie in the cabin: an empty one.
    cabin: withoutHaulPapers(migrateStorage(raw.cabin, CABIN_PLACE_COUNT, `car "${raw.id}" cabin`)),
    // Absent on every save written before the body had a condition. A car loaded
    // from one of those arrives clean rather than randomly weathered: the player
    // parked it, the game just was not looking.
    dirt: clamp01(numOr(raw.dirt, 0)),
    scratches: clamp01(numOr(raw.scratches, 0)),
    // Absent on every save written before spray paint: the factory colour.
    paint: migrateCarPaint(raw.paint),
    // `dents` (shell deformation) and the older `damage` list (shader marks) are both
    // removed systems; a save that carries either loads the car straight.
    odometer: numOr(raw.odometer, 0),
    x: numOr(raw.x, 0),
    y: numOr(raw.y, 0),
    z: numOr(raw.z, 0),
    qx: numOr(raw.qx, 0),
    qy: numOr(raw.qy, 0),
    qz: numOr(raw.qz, 0),
    qw: numOr(raw.qw, 1),
  };
  // The towed car's own field only; the tower carries no mirror. Whether the named
  // car exists is decided once the whole car set is known, in `fromSaveData`.
  if (typeof raw.towedBy === 'string' && raw.towedBy.length > 0) car.towedBy = raw.towedBy;
  // Bought or started in: the player's papers. A lot car still for sale keeps its price.
  if (raw.papers === true) car.papers = true;
  if (typeof raw.lotPrice === 'number' && Number.isFinite(raw.lotPrice) && raw.lotPrice > 0) {
    // A save from the coin days priced in coins: the lot asks the model's price now,
    // and what was fed into its box counts `RUBLES_PER_COIN` a coin. One from the kopeck
    // days priced in kopecks.
    const coins = version < 3;
    car.lotPrice = coins ? carPrice(car.modelId) : legacyRubles(raw.lotPrice, version);
    // Already in its key box; a save from before the key boxes has none.
    if (typeof raw.lotPaid === 'number' && Number.isFinite(raw.lotPaid) && raw.lotPaid > 0) {
      car.lotPaid = Math.min(car.lotPrice, coins ? Math.round(raw.lotPaid) * RUBLES_PER_COIN : legacyRubles(raw.lotPaid, version));
    }
  }
  // The mirrors' hand-set aims (inside and door mirrors); anything malformed leaves the
  // built aim.
  for (const field of Object.values(MIRROR_FIELD)) {
    const mirror = raw[field];
    if (Array.isArray(mirror) && mirror.length === 2 && mirror.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      car[field] = [mirror[0] as number, mirror[1] as number];
    }
  }
  return car;
}

/**
 * Legacy variant ids. The coolant tank became the radiator it always was, and the
 * four radiator sizes became the one radiator. `variant()` throws on an id it does not
 * know — so an unmapped save would fail to load rather than lose one part.
 */
const LEGACY_VARIANT_IDS: Readonly<Record<string, string>> = {
  coolant_tank_standard: 'radiator',
  radiator_small: 'radiator',
  radiator_lada: 'radiator',
  radiator_standard: 'radiator',
  radiator_copper: 'radiator',
};

/**
 * Throws on a variant the catalogue no longer has (the diesel engines went with the
 * fuel, the fuel tanks into the bodies), so every caller drops that one part rather
 * than the save: storage cells catch it per cell, loose parts per part, carried items
 * through `isRemovedLegacyItem`.
 */
function migratePart(raw: unknown, where: string): PartInstance {
  const obj = asRecord(raw, `part at ${where}`);
  if (typeof obj.id !== 'string' || typeof obj.variantId !== 'string') {
    throw new Error(`Save data is malformed: part at ${where} is missing id/variantId`);
  }
  const variantId = LEGACY_VARIANT_IDS[obj.variantId] ?? obj.variantId;
  if (!hasVariant(variantId)) {
    throw new Error(`Save data names a removed part at ${where}: ${variantId}`);
  }
  const part: PartInstance = {
    id: obj.id,
    variantId,
    dirt: numOr(obj.dirt, 0),
    rust: numOr(obj.rust, 0),
    destroyed: obj.destroyed === true || undefined,
    // Absent on every save written before a detached container held its fluid. Those
    // parts load dry, which is what the old game modelled anyway.
    litres: Math.max(0, numOr(obj.litres, 0)),
  };
  if (variantId === 'air_filter') part.clog = Math.max(0, numOr(obj.clog, 0));
  return part;
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

/**
 * Item kinds deliberately removed from the current game. They have no honest
 * runtime representation, so retaining the rest of the save is safer than
 * failing the whole load. The hand winch's anchors and constraint were removed
 * with the mechanic; converting it to an unrelated item would invent progress.
 * The wrench never had an action of its own and was taken out of the loot. Diesel
 * went with every diesel engine: its cans, and any part that is no longer in the
 * catalogue (the fuel tanks too, now the body's own), are dropped. So is the postcard
 * from home (and the folded `letter` it replaced): the prototype's start item. And a
 * haul's papers: a haul is its load now (game-design2.md §7.8), handed in in a post's bay.
 */
function isRemovedLegacyItem(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  // The coin item went with the purse: its value is counted into the balance first
  // (`legacyCoinRubles`).
  if (obj.type === 'hand_winch' || obj.type === 'postcard' || obj.type === 'letter' || obj.type === 'coin') return true;
  if (obj.type === 'contract_cargo' && isThingId(obj.thing) && isHaulThing(thingDef(obj.thing))) return true;
  if (obj.type === 'tool' && obj.tool === 'wrench') return true;
  if ((obj.type === 'fluid_can' && obj.fluid === 'diesel') || (obj.type === 'fuel_can' && obj.fuel === 'diesel')) {
    return true;
  }
  if (obj.type === 'part' && typeof obj.part === 'object' && obj.part !== null) {
    const variantId = (obj.part as Record<string, unknown>).variantId;
    return typeof variantId === 'string' && !hasVariant(LEGACY_VARIANT_IDS[variantId] ?? variantId);
  }
  return false;
}

/** A boot's or a cabin's cells with any haul's papers taken out (`isRemovedLegacyItem`). */
function withoutHaulPapers(cells: (Item | null)[]): (Item | null)[] {
  return cells.map((item) => (item?.type === 'contract_cargo' && isHaul(item) ? null : item));
}

/** A coin of the coin days in today's rubles: it was a ruble of the kopeck days. */
const RUBLES_PER_COIN = 10;
/** Kopecks of a version 3 save in one of today's rubles: money went ×10 and lost its kopecks. */
const V3_KOPECKS_PER_RUBLE = 10;

/** A saved amount in today's whole rubles: a version 3 save wrote kopecks. */
function legacyRubles(amount: number, version: number): number {
  return Math.max(0, Math.round(version < 4 ? amount / V3_KOPECKS_PER_RUBLE : amount));
}

/**
 * The coin days' money, rubles: every coin item of a version 2 save, wherever it lay —
 * the pack, the ground, a boot, a cabin, a post's stock — at `RUBLES_PER_COIN` a coin,
 * for the purse. The coins themselves are then dropped (`isRemovedLegacyItem`).
 */
function legacyCoinRubles(
  carried: readonly unknown[],
  looseItems: Record<string, unknown>,
  cars: Record<string, unknown>,
  courierStorage: Record<string, unknown>,
): number {
  let coins = 0;
  const count = (raw: unknown): void => {
    if (typeof raw !== 'object' || raw === null) return;
    const obj = raw as Record<string, unknown>;
    if (obj.type === 'coin') coins += Math.max(0, Math.trunc(numOr(obj.value, 0)));
  };
  const countAll = (raw: unknown): void => {
    if (Array.isArray(raw)) for (const item of raw) count(item);
  };
  countAll(carried);
  for (const loose of Object.values(looseItems)) {
    if (typeof loose === 'object' && loose !== null) count((loose as Record<string, unknown>).item);
  }
  for (const car of Object.values(cars)) {
    if (typeof car !== 'object' || car === null) continue;
    countAll((car as Record<string, unknown>).storage);
    countAll((car as Record<string, unknown>).cabin);
  }
  for (const cells of Object.values(courierStorage)) countAll(cells);
  return coins * RUBLES_PER_COIN;
}

/**
 * Rebuilds a contract's saved progress: `started`, a thing's `condition` and `broken`,
 * and a passenger's ride (`comfort`, `harsh`, harsh moments scaled by the car's comfort),
 * and an urgent contract's clock (`elapsedS`)
 * when it has them. Older saves also carry heat, violated and status fields from when
 * deliveries were scored; they are dropped.
 */
function sanitizeContractProgress(raw: unknown): ContractProgress {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const progress: ContractProgress = { started: obj.started === true };
  if (typeof obj.condition === 'number' && Number.isFinite(obj.condition)) {
    progress.condition = Math.min(1, Math.max(0, obj.condition));
  }
  if (obj.broken === true) progress.broken = true;
  if (typeof obj.comfort === 'number' && Number.isFinite(obj.comfort)) {
    progress.comfort = Math.min(1, Math.max(0, obj.comfort));
  }
  if (typeof obj.harsh === 'number' && Number.isFinite(obj.harsh) && obj.harsh > 0) {
    progress.harsh = obj.harsh;
  }
  if (typeof obj.elapsedS === 'number' && Number.isFinite(obj.elapsedS) && obj.elapsedS > 0) {
    progress.elapsedS = obj.elapsedS;
  }
  return progress;
}

/** The delivery ledger: counts by contract kind, unknown kinds dropped. */
function migrateDeliveriesByKind(raw: unknown): Partial<Record<ContractKind, number>> {
  const ledger: Partial<Record<ContractKind, number>> = {};
  if (typeof raw !== 'object' || raw === null) return ledger;
  for (const [kind, count] of Object.entries(raw as Record<string, unknown>)) {
    if (!isContractKind(kind) || typeof count !== 'number' || !Number.isFinite(count)) continue;
    const n = Math.max(0, Math.trunc(count));
    if (n > 0) ledger[kind] = n;
  }
  return ledger;
}

function migrateItem(raw: unknown, where: string): Item {
  const obj = asRecord(raw, `item at ${where}`);
  if (typeof obj.id !== 'string') {
    throw new Error(`Save data is malformed: item at ${where} is missing an id`);
  }
  switch (obj.type) {
    case 'tool': {
      const tool = obj.tool;
      if (tool !== 'brush' && tool !== 'sponge') {
        throw new Error(`Save data is malformed: item at ${where} has an invalid tool`);
      }
      // The brush is gone: an old save's brush comes back as a sponge with the same
      // life left, so nothing a player carried simply vanishes.
      return {
        type: 'tool',
        id: obj.id,
        tool: 'sponge',
        integrity: Math.min(1, Math.max(0, numOr(obj.integrity, 1))),
        capacity: numOr(obj.capacity, (SPONGE_CAPACITY_MIN + SPONGE_CAPACITY_MAX) / 2),
      };
    }
    case 'part':
      return { type: 'part', id: obj.id, part: migratePart(obj.part, `item at ${where}`) };
    // `fuel_can` is the pre-fluids tag; its petrol maps straight across and keeps its
    // contents (diesel ones are dropped above, by `isRemovedLegacyItem`).
    case 'fuel_can':
    case 'fluid_can': {
      const saved = obj.type === 'fuel_can' ? obj.fuel : obj.fluid;
      // `coolant` is the pre-rename tag for the same green can, now water.
      const fluid = saved === 'coolant' ? 'water' : saved;
      if (fluid !== null && fluid !== 'petrol' && fluid !== 'water' && fluid !== 'oil') {
        throw new Error(`Save data is malformed: item at ${where} has an invalid fluid`);
      }
      const capacity = numOr(obj.capacity, 0);
      const litres = fluid === null ? 0 : Math.min(capacity, Math.max(0, numOr(obj.litres, 0)));
      // An empty can holds no fluid (items/items.ts): one saved empty before cans took
      // any fluid still names the fluid it was sold for, and forgets it here.
      return {
        type: 'fluid_can',
        id: obj.id,
        fluid: litres > 0 ? fluid : null,
        capacity,
        litres,
      };
    }
    case 'spray_can': {
      const paint = obj.paint;
      if (typeof paint !== 'number' || carPaintSwatch(paint) === undefined) {
        throw new Error(`Save data is malformed: spray can at ${where} has an invalid paint`);
      }
      return { type: 'spray_can', id: obj.id, paint, charge: clamp01(numOr(obj.charge, 1)) };
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
    case 'medicine':
      return { type: 'medicine', id: obj.id };
    case 'binoculars':
      return { type: 'binoculars', id: obj.id };
    case 'torchlight':
      return { type: 'torchlight', id: obj.id };
    case 'sun_shades': {
      const tint = obj.tint;
      if (tint !== 'green' && tint !== 'yellow' && tint !== 'red') {
        throw new Error(`Save data is malformed: item at ${where} has an invalid shade tint`);
      }
      return { type: 'sun_shades', id: obj.id, tint };
    }
    case 'camera':
      return {
        type: 'camera',
        id: obj.id,
        framesRemaining: Math.min(
          CAMERA_FRAME_LIMIT,
          Math.max(0, Math.trunc(numOr(obj.framesRemaining, CAMERA_FRAME_LIMIT))),
        ),
      };
    case 'photograph': {
      const imageDataUrl = obj.imageDataUrl;
      if (
        typeof imageDataUrl !== 'string'
        || !imageDataUrl.startsWith('data:image/jpeg;base64,')
        || imageDataUrl.length > 1_000_000
      ) {
        throw new Error(`Save data is malformed: photograph at ${where} has invalid image data`);
      }
      return { type: 'photograph', id: obj.id, imageDataUrl };
    }
    case 'football':
      return { type: 'football', id: obj.id };
    case 'pocket_watch':
      return { type: 'pocket_watch', id: obj.id };
    case 'contract_cargo': {
      const sourceCourierIndex = Math.trunc(numOr(obj.sourceCourierIndex, -1));
      if (sourceCourierIndex < 0 || !isThingId(obj.thing)) {
        throw new Error(`Save data is malformed: contract cargo at ${where} is invalid`);
      }
      const item: ContractCargoItem = {
        type: 'contract_cargo',
        id: obj.id,
        sourceCourierIndex,
        thing: obj.thing,
        generatedSeed: numOr(obj.generatedSeed, 0) >>> 0,
        progress: sanitizeContractProgress(obj.progress),
        ...(typeof obj.destination === 'string' ? { destination: obj.destination } : {}),
        ...(typeof obj.urgentS === 'number' && Number.isFinite(obj.urgentS) && obj.urgentS > 0 ? { urgentS: obj.urgentS } : {}),
      };
      if (obj.raceLegs === 1 || obj.raceLegs === 2) item.raceLegs = obj.raceLegs;
      // A passenger's party: its contract id and 1–3 teddies. Anything else is dropped,
      // and the teddy then delivers as a party of its own.
      const party = typeof obj.party === 'object' && obj.party !== null ? (obj.party as Record<string, unknown>) : null;
      const partySize = typeof party?.size === 'number' ? Math.trunc(party.size) : 0;
      if (party && typeof party.id === 'string' && partySize >= 1 && partySize <= 3) {
        item.party = { id: party.id, size: partySize };
      }
      return item;
    }
    case 'sticker_envelope':
      if (!isStickerKind(obj.stickerKind)) {
        throw new Error(`Save data is malformed: sticker envelope at ${where} is invalid`);
      }
      return {
        type: 'sticker_envelope',
        id: obj.id,
        stickerKind: obj.stickerKind,
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

function migrateStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && !out.includes(item)) out.push(item);
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

/** Body-condition fractions; a hand-edited or older save may hold anything. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
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
