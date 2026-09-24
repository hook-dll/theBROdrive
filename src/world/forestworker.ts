import { Road } from './road';
import type { RoadSpine } from './roadspine';
import { RoadDistance } from './roaddistance';
import {
  DESERT_TILE_SIZE,
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
 *
 * Each tree is flagged OPEN when it stands outside a wood — a shelter belt, a copse,
 * a wood's thin edge, a lone tree. Past the woods' impostor reach a wood is the
 * canopy blanket (world/vistaground.ts), but a belt is narrower than the far ground's
 * mesh and exists only as trees; without these the farmland horizon was bare.
 */

/** Wood density below which a tree is drawn as a tree out to the open reach. */
const OPEN_FOREST_MAX = 0.5;

export interface ForestWorkerInit {
  readonly type: 'init';
  readonly seed: number;
  readonly spine: RoadSpine;
}

export interface ForestWorkerTileRequest {
  readonly type: 'tile';
  readonly tx: number;
  readonly tz: number;
  /** Only the trees standing outside a wood: a tile past the woods' impostor reach. */
  readonly openOnly: boolean;
}

export type ForestWorkerRequest = ForestWorkerInit | ForestWorkerTileRequest;

export interface ForestWorkerTileResult {
  readonly type: 'tile';
  readonly tx: number;
  readonly tz: number;
  readonly trees: Float32Array;
  readonly count: number;
  /** Per tree, 1 when it stands outside a wood (belt, copse, edge, lone tree). */
  readonly open: Uint8Array;
  readonly openOnly: boolean;
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
  const centreX = (request.tx + 0.5) * DESERT_TILE_SIZE;
  const centreZ = (request.tz + 0.5) * DESERT_TILE_SIZE;
  const flags = new Uint8Array(count);
  let kept = 0;
  for (let i = 0; i < count; i++) {
    const o = i * TREE_STRIDE;
    const isOpen = ctx.terrain.cover.forestAt(centreX + scratch[o]!, centreZ + scratch[o + 2]!, 1e6) < OPEN_FOREST_MAX;
    if (request.openOnly && !isOpen) continue;
    if (kept !== i) scratch.copyWithin(kept * TREE_STRIDE, o, o + TREE_STRIDE);
    flags[kept++] = isOpen ? 1 : 0;
  }
  const trees = scratch.slice(0, kept * TREE_STRIDE);
  const open = flags.slice(0, kept);
  scope.postMessage(
    { type: 'tile', tx: request.tx, tz: request.tz, trees, count: kept, open, openOnly: request.openOnly },
    [trees.buffer, open.buffer],
  );
};
