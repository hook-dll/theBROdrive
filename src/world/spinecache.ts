import { buildSpine, SPINE_FORMAT, type RoadSpine } from './roadspine';
import type { SpineRequest, SpineResponse } from './spineworker';

/**
 * Getting the road spine without making the player wait for it twice.
 *
 * Three tiers, in order, and each one exists because the tier after it is worse:
 *
 *  1. INDEXED DB. The spine is a pure function of (seed, length), so it is worth
 *     storing: 3.3 MB of typed arrays keyed by seed. A returning player pays a disk
 *     read instead of a ten-million-step walk, which is the common case for a game
 *     played across thousands of sessions.
 *  2. A WORKER. First visit to a seed. Six tenths of a second at 40 000 km, off the
 *     main thread, then written to (1) so it is never paid again.
 *  3. SYNCHRONOUS. No worker, no IndexedDB, or either one failed. Correct but blocking.
 *     Dev tools land here by simply constructing a `Road` without a spine.
 *
 * Nothing here throws. A cache that fails is a cache that is skipped: the spine is
 * always obtainable, because it can always just be computed.
 */

const DB_NAME = 'brodrive-spine';
const STORE = 'spine';
const DB_VERSION = 1;

interface StoredSpine {
  readonly format: number;
  readonly length: number;
  readonly checkpointX: ArrayBuffer;
  readonly checkpointZ: ArrayBuffer;
  readonly coarseX: ArrayBuffer;
  readonly coarseZ: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase | null> {
  const { promise, resolve } = Promise.withResolvers<IDBDatabase | null>();
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  let request: IDBOpenDBRequest;
  try {
    request = indexedDB.open(DB_NAME, DB_VERSION);
  } catch {
    return Promise.resolve(null);
  }
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) {
      request.result.createObjectStore(STORE);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => resolve(null);
  request.onblocked = () => resolve(null);
  return promise;
}

/**
 * Cache key. It carries the format tag as well as the seed and length because a
 * change to what the tables MEAN must invalidate them — a stale table of the right
 * size is far worse than no table, since it would silently generate a different road
 * from the one the checkpoints describe.
 */
function cacheKey(seed: number, length: number): string {
  return `${SPINE_FORMAT}:${seed >>> 0}:${length}`;
}

function readStored(db: IDBDatabase, key: string): Promise<StoredSpine | null> {
  const { promise, resolve } = Promise.withResolvers<StoredSpine | null>();
  let request: IDBRequest<StoredSpine | undefined>;
  try {
    request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
  } catch {
    return Promise.resolve(null);
  }
  request.onsuccess = () => resolve(request.result ?? null);
  request.onerror = () => resolve(null);
  return promise;
}

function writeStored(db: IDBDatabase, key: string, value: StoredSpine): void {
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
  } catch {
    // A spine that cannot be cached is still a spine. Nothing to recover.
  }
}

/** Rebuilds the typed-array views over buffers that came from a worker or from disk. */
function fromBuffers(stored: Omit<StoredSpine, 'format'>): RoadSpine {
  return {
    length: stored.length,
    checkpointX: new Float64Array(stored.checkpointX),
    checkpointZ: new Float64Array(stored.checkpointZ),
    coarseX: new Float64Array(stored.coarseX),
    coarseZ: new Float64Array(stored.coarseZ),
  };
}

function buildInWorker(seed: number, length: number): Promise<RoadSpine | null> {
  const { promise, resolve } = Promise.withResolvers<RoadSpine | null>();
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./spineworker.ts', import.meta.url), { type: 'module' });
  } catch {
    return Promise.resolve(null);
  }
  const finish = (spine: RoadSpine | null): void => {
    worker.terminate();
    resolve(spine);
  };
  worker.onmessage = (event: MessageEvent<SpineResponse>) => finish(fromBuffers(event.data));
  worker.onerror = () => finish(null);
  const request: SpineRequest = { seed, length };
  worker.postMessage(request);
  return promise;
}

/**
 * The spine for a road, from cache if possible, from a worker if not, from this thread
 * if neither is available.
 *
 * Awaiting this before constructing the `Road` is what keeps the walk off the first
 * frame. `main.ts` already awaits physics, so the spine costs no extra load step.
 */
export async function loadSpine(seed: number, length: number): Promise<RoadSpine> {
  const key = cacheKey(seed, length);
  const db = await openDb();

  if (db) {
    const stored = await readStored(db, key);
    // The length check is belt and braces: the key already carries it, but a table of
    // the wrong length would corrupt every position in the world rather than fail.
    if (stored && stored.format === SPINE_FORMAT && stored.length === length) {
      db.close();
      return fromBuffers(stored);
    }
  }

  const built = (await buildInWorker(seed, length)) ?? buildSpine(seed, length);

  if (db) {
    writeStored(db, key, {
      format: SPINE_FORMAT,
      length: built.length,
      checkpointX: built.checkpointX.buffer as ArrayBuffer,
      checkpointZ: built.checkpointZ.buffer as ArrayBuffer,
      coarseX: built.coarseX.buffer as ArrayBuffer,
      coarseZ: built.coarseZ.buffer as ArrayBuffer,
    });
    db.close();
  }

  return built;
}
