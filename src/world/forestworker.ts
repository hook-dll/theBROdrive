import { Road } from './road';
import type { RoadSpine } from './roadspine';
import { RoadDistance } from './roaddistance';
import {
  MAX_TILE_TREES,
  TREE_STRIDE,
  plantTrees,
  sampleGroundHeight,
  type DesertTileGenerationContext,
  type GroundHeightSample,
} from './deserttiledata';
import { newCoverSample } from './landcover';
import { Terrain } from './terrain';

/**
 * Plants the trees of the far forest (world/forest.ts): every tile out to the
 * impostor radius, trees only — no ground mesh, no collider. The planting is the very
 * function the near tiles use (`plantTrees`), so a far tree is the same tree, at the
 * same spot and size, that a near tile will plant there when the player arrives.
 * Heights come from the exact ground function rather than a tile lattice; the two
 * differ by centimetres, which at impostor distance is nothing.
 */

export interface ForestWorkerInit {
  readonly type: 'init';
  readonly seed: number;
  readonly spine: RoadSpine;
}

export interface ForestWorkerTileRequest {
  readonly type: 'tile';
  readonly tx: number;
  readonly tz: number;
}

export type ForestWorkerRequest = ForestWorkerInit | ForestWorkerTileRequest;

export interface ForestWorkerTileResult {
  readonly type: 'tile';
  readonly tx: number;
  readonly tz: number;
  readonly trees: Float32Array;
  readonly count: number;
}

export type ForestWorkerResponse = { readonly type: 'ready' } | ForestWorkerTileResult;

interface ForestWorkerScope {
  onmessage: ((event: MessageEvent<ForestWorkerRequest>) => void) | null;
  postMessage(message: ForestWorkerResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as ForestWorkerScope;
let context: DesertTileGenerationContext | null = null;
const ground: GroundHeightSample = { height: 0, detail: 0 };
const cover = newCoverSample();
const scratch = new Float32Array(MAX_TILE_TREES * TREE_STRIDE);

scope.onmessage = (event: MessageEvent<ForestWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    const road = new Road(request.seed, request.spine);
    const terrain = new Terrain(request.seed, road);
    context = { seed: request.seed, road, terrain, roadDistance: new RoadDistance(road) };
    scope.postMessage({ type: 'ready' });
    return;
  }
  if (!context) return;
  const ctx = context;
  const count = plantTrees(
    ctx,
    request.tx,
    request.tz,
    (_lx, _lz, x, z) => {
      sampleGroundHeight(ctx, x, z, false, ground);
      return ground.height;
    },
    scratch,
    cover,
  );
  const trees = scratch.slice(0, count * TREE_STRIDE);
  scope.postMessage({ type: 'tile', tx: request.tx, tz: request.tz, trees, count }, [trees.buffer]);
};
