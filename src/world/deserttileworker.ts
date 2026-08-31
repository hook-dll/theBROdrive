import { Road } from './road';
import type { RoadSpine } from './roadspine';
import { RoadDistance } from './roaddistance';
import {
  desertTileDataTransfers,
  generateDesertTileData,
  type DesertTileData,
  type DesertTileGenerationContext,
} from './deserttiledata';
import { Terrain } from './terrain';

/** The main thread clones the live road spine into the worker during initialization. */
export interface DesertTileWorkerInit {
  readonly type: 'init';
  readonly seed: number;
  readonly spine: RoadSpine;
}

export interface DesertTileWorkerTileRequest {
  readonly type: 'tile';
  readonly requestId: number;
  readonly tx: number;
  readonly tz: number;
  readonly farFromRoad: boolean;
  /**
   * Buffers from a tile the main thread has finished with, moved back here to be
   * written over. Absent on the first requests, before anything has been unloaded.
   */
  readonly recycle?: DesertTileData;
}

export type DesertTileWorkerRequest = DesertTileWorkerInit | DesertTileWorkerTileRequest;

export interface DesertTileWorkerReady {
  readonly type: 'ready';
}

export interface DesertTileWorkerTileResult {
  readonly type: 'tile';
  readonly requestId: number;
  readonly tx: number;
  readonly tz: number;
  readonly data: DesertTileData;
}

export type DesertTileWorkerResponse = DesertTileWorkerReady | DesertTileWorkerTileResult;

/**
 * `tsconfig.json` intentionally uses DOM rather than WebWorker globals. This is the
 * minimal worker surface we need, without mis-typing the module as a Window script.
 */
interface DesertTileWorkerScope {
  onmessage: ((event: MessageEvent<DesertTileWorkerRequest>) => void) | null;
  postMessage(message: DesertTileWorkerResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as DesertTileWorkerScope;
let context: DesertTileGenerationContext | null = null;

scope.onmessage = (event: MessageEvent<DesertTileWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    const road = new Road(request.seed, request.spine);
    const terrain = new Terrain(request.seed, road);
    context = {
      seed: request.seed,
      road,
      terrain,
      roadDistance: new RoadDistance(road),
    };
    scope.postMessage({ type: 'ready' });
    return;
  }

  if (!context) return;
  const data = generateDesertTileData(
    context,
    request.tx,
    request.tz,
    request.farFromRoad,
    request.recycle,
  );
  const response: DesertTileWorkerTileResult = {
    type: 'tile',
    requestId: request.requestId,
    tx: request.tx,
    tz: request.tz,
    data,
  };
  scope.postMessage(response, desertTileDataTransfers(data));
};
