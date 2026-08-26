import { buildSpine } from './roadspine';

/**
 * Worker entry for the road spine walk.
 *
 * The walk is ten million iterations at 40 000 km. On the main thread that is six
 * tenths of a second of a frozen tab before the menu even hands over, and it would
 * land again on every session that does not hit the persisted cache. Here it lands
 * nowhere the player can see.
 *
 * The five tables go back as transferable buffers, so the 3.3 MB is moved rather than
 * structured-cloned. That also means this worker's copies are detached afterwards,
 * which is fine: it is done with them, and it is torn down immediately.
 */

export interface SpineRequest {
  readonly seed: number;
  readonly length: number;
}

export interface SpineResponse {
  readonly length: number;
  readonly checkpointX: ArrayBuffer;
  readonly checkpointZ: ArrayBuffer;
  readonly checkpointHeading: ArrayBuffer;
  readonly coarseX: ArrayBuffer;
  readonly coarseZ: ArrayBuffer;
}

/**
 * The worker's own global, typed by hand.
 *
 * `tsconfig.json` loads the DOM lib, so bare `self` resolves to `Window`, whose
 * `postMessage` takes a target origin rather than a transfer list. Adding the
 * WebWorker lib instead is not an option — it collides with DOM across the rest of
 * the source. A local interface naming only the two members this file touches is the
 * honest way to say "this module runs somewhere else".
 */
interface SpineWorkerScope {
  onmessage: ((event: MessageEvent<SpineRequest>) => void) | null;
  postMessage(message: SpineResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as SpineWorkerScope;

scope.onmessage = (event: MessageEvent<SpineRequest>) => {
  const { seed, length } = event.data;
  const spine = buildSpine(seed, length);
  const response: SpineResponse = {
    length: spine.length,
    checkpointX: spine.checkpointX.buffer as ArrayBuffer,
    checkpointZ: spine.checkpointZ.buffer as ArrayBuffer,
    checkpointHeading: spine.checkpointHeading.buffer as ArrayBuffer,
    coarseX: spine.coarseX.buffer as ArrayBuffer,
    coarseZ: spine.coarseZ.buffer as ArrayBuffer,
  };
  scope.postMessage(response, [
    response.checkpointX,
    response.checkpointZ,
    response.checkpointHeading,
    response.coarseX,
    response.coarseZ,
  ]);
};
