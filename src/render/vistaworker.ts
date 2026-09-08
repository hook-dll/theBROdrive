import { Road } from '../world/road';
import type { RoadSpine } from '../world/roadspine';
import { Terrain } from '../world/terrain';

/**
 * Terrain sampling for the distant vista disc.
 *
 * The vista's cost is `Terrain.horizonHeight`/`baseHeight` over every vertex of a
 * polar disc, four times per interpolation cell. On the main thread that is the
 * 70-130 ms hitch measured by tools/vista-check.ts. Only the noise sampling moves
 * here: bias, the road underlay, colours, normals and every Three.js object stay on
 * the main thread, so the authored look is produced by exactly the same code.
 *
 * The disc layout (local ring positions and their radii) is sent once per view
 * distance, so a per-cell request is four numbers rather than a vertex stream.
 */

export interface VistaWorkerInit {
  readonly type: 'init';
  readonly seed: number;
  readonly spine: RoadSpine;
}

/** Local disc vertices and ring radii, valid until the view distance changes. */
export interface VistaWorkerLayout {
  readonly type: 'layout';
  readonly layoutId: number;
  readonly positions: ArrayBuffer;
  readonly radii: ArrayBuffer;
}

export interface VistaWorkerSampleRequest {
  readonly type: 'sample';
  readonly requestId: number;
  readonly layoutId: number;
  /** Cell corner in vista-local coordinates, plus the origin it was taken under. */
  readonly cornerX: number;
  readonly cornerZ: number;
  readonly originX: number;
  readonly originZ: number;
}

export type VistaWorkerRequest =
  | VistaWorkerInit
  | VistaWorkerLayout
  | VistaWorkerSampleRequest;

export interface VistaWorkerReady {
  readonly type: 'ready';
}

export interface VistaWorkerSampleResult {
  readonly type: 'sample';
  readonly requestId: number;
  readonly layoutId: number;
  readonly cornerX: number;
  readonly cornerZ: number;
  readonly originX: number;
  readonly originZ: number;
  /** Raw field values per disc vertex; the main thread shapes them into a sample. */
  readonly horizon: ArrayBuffer;
  readonly base: ArrayBuffer;
}

export type VistaWorkerResponse = VistaWorkerReady | VistaWorkerSampleResult;

/**
 * `tsconfig.json` intentionally uses DOM rather than WebWorker globals. This is the
 * minimal worker surface we need, without mis-typing the module as a Window script.
 */
interface VistaWorkerScope {
  onmessage: ((event: MessageEvent<VistaWorkerRequest>) => void) | null;
  postMessage(message: VistaWorkerResponse, transfer?: Transferable[]): void;
}

/** Must match SECTORS in vista.ts: the layout is laid out ring-major. */
const SECTORS = 160;
/** Relief fade band, mirroring vista.ts so the sampled field is identical. */
const RELIEF_FADE_START = 2500;
const RELIEF_FADE_END = 7000;

const scope = self as unknown as VistaWorkerScope;
let terrain: Terrain | null = null;
let layoutId = -1;
let positions: Float32Array | null = null;
let radii: Float32Array | null = null;

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

scope.onmessage = (event: MessageEvent<VistaWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    const road = new Road(request.seed, request.spine);
    terrain = new Terrain(request.seed, road);
    scope.postMessage({ type: 'ready' });
    return;
  }

  if (request.type === 'layout') {
    layoutId = request.layoutId;
    positions = new Float32Array(request.positions);
    radii = new Float32Array(request.radii);
    return;
  }

  if (terrain === null || positions === null || radii === null) return;
  // A layout change invalidates every in-flight request: the vertex count itself
  // moved, so answering with the old disc would corrupt the caller's buffers.
  if (request.layoutId !== layoutId) return;

  const rings = radii.length;
  const horizon = new Float32Array(rings * SECTORS);
  const base = new Float32Array(rings * SECTORS);
  for (let r = 0; r < rings; r++) {
    const radius = radii[r]!;
    const reliefWeight =
      1 - smoothstep01((radius - RELIEF_FADE_START) / (RELIEF_FADE_END - RELIEF_FADE_START));
    for (let a = 0; a < SECTORS; a++) {
      const i = r * SECTORS + a;
      const vi = i * 3;
      const absoluteX = request.cornerX + positions[vi]! + request.originX;
      const absoluteZ = request.cornerZ + positions[vi + 2]! + request.originZ;
      horizon[i] = terrain.horizonHeight(absoluteX, absoluteZ, radius, reliefWeight);
      base[i] = terrain.baseHeight(absoluteX, absoluteZ, radius);
    }
  }

  const response: VistaWorkerSampleResult = {
    type: 'sample',
    requestId: request.requestId,
    layoutId: request.layoutId,
    cornerX: request.cornerX,
    cornerZ: request.cornerZ,
    originX: request.originX,
    originZ: request.originZ,
    horizon: horizon.buffer,
    base: base.buffer,
  };
  scope.postMessage(response, [response.horizon, response.base]);
};
