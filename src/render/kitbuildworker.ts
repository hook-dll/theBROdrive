import { buildKitCar } from '../carkit/kit';
import { writeKitWire } from '../carkit/wire';
import type { KitBuildRequest, KitBuildResponse } from './kitbuild';

/**
 * Worker entry for the traffic's kit cars (render/kitbuild.ts): one car per message, built
 * (carkit/kit.ts `buildKitCar`) where the drive cannot feel it, and sent back as a wire
 * (carkit/wire.ts) whose vertex arrays are transferred, not copied.
 */

/**
 * The worker's own global, typed by hand: `tsconfig.json` loads the DOM lib, so bare
 * `self` is a `Window` (see world/spineworker.ts).
 */
interface KitBuildWorkerScope {
  onmessage: ((event: MessageEvent<KitBuildRequest>) => void) | null;
  postMessage(message: KitBuildResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as KitBuildWorkerScope;

scope.onmessage = (event: MessageEvent<KitBuildRequest>) => {
  const { id, kit } = event.data;
  let built;
  try {
    built = writeKitWire(buildKitCar(kit));
  } catch (error) {
    scope.postMessage({ id, error: String((error as Error)?.stack ?? error) }, []);
    return;
  }
  scope.postMessage({ id, wire: built.wire }, built.transfer);
};
