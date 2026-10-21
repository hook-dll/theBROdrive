import { dieCastArrays, type DieCastRequest, type DieCastResponse } from './diecast';

/**
 * Worker entry for the title room's die-cast models (ui/diecast.ts): one kit car per
 * message, built where the title screen cannot feel it. The arrays go back as
 * transferable buffers, so they are moved rather than cloned.
 */

/**
 * The worker's own global, typed by hand: `tsconfig.json` loads the DOM lib, so bare
 * `self` is a `Window` (see world/spineworker.ts).
 */
interface DieCastWorkerScope {
  onmessage: ((event: MessageEvent<DieCastRequest>) => void) | null;
  postMessage(message: DieCastResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as DieCastWorkerScope;

scope.onmessage = (event: MessageEvent<DieCastRequest>) => {
  let arrays;
  try {
    arrays = dieCastArrays(event.data);
  } catch (error) {
    scope.postMessage({ error: String((error as Error)?.stack ?? error) }, []);
    return;
  }
  const response = {
    position: arrays.position.buffer as ArrayBuffer,
    normal: arrays.normal.buffer as ArrayBuffer,
    color: arrays.color.buffer as ArrayBuffer,
  };
  scope.postMessage(response, [response.position, response.normal, response.color]);
};
