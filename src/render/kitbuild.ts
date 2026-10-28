import type { KitWire } from '../carkit/wire';

/**
 * The traffic's kit cars built off the main thread: render/carmodel.ts `loadModel` asks
 * for a car here, render/kitbuildworker.ts builds it (carkit/kit.ts `buildKitCar`) and
 * sends it back as a wire (carkit/wire.ts), and the loader reads it into the scene on a
 * frame of its own. Building a car is 45-85 ms in bun on the M2 Pro (2026-10-28; 75-195 ms
 * before that day's speedups), several times that on a mini-PC, and a new model appears
 * mid-drive whenever the stream first draws it: on the main thread every one was a hitch.
 * The wire reads back to the very scene the build made (carkit/wire.ts).
 *
 * One worker, made on the first request, builds the cars in the order asked. Where there
 * is none (no `window` or no `Worker`), or it cannot start, or a build fails in it, the
 * answer is null and the loader builds the car on the main thread as before.
 */

export interface KitBuildRequest {
  readonly id: number;
  /** The kit car's id (carkit/specs.ts `KIT_SPECS`). */
  readonly kit: string;
}

export type KitBuildResponse = { readonly id: number; readonly wire: KitWire } | { readonly id: number; readonly error: string };

/** Undefined until the first request; null when there is none (or it failed). */
let worker: Worker | null | undefined;
const waiting = new Map<number, (wire: KitWire | null) => void>();
let nextId = 0;

/**
 * A Worker under bun or node (the headless tools, whose asset shim makes a `window`)
 * keeps the process alive while it is referenced: the worker is held only while a build
 * is waiting, so a tool exits when it is done. A browser's Worker has neither method.
 */
function holdProcess(target: Worker, hold: boolean): void {
  const method = hold ? 'ref' : 'unref';
  if (method in target) {
    const call: unknown = Reflect.get(target, method);
    if (typeof call === 'function') call.call(target);
  }
}

function kitWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  try {
    const started = new Worker(new URL('./kitbuildworker.ts', import.meta.url), { type: 'module' });
    started.onmessage = (event: MessageEvent<KitBuildResponse>) => {
      const response = event.data;
      const done = waiting.get(response.id);
      if (!done) return;
      waiting.delete(response.id);
      if (waiting.size === 0) holdProcess(started, false);
      if ('error' in response) {
        console.error('Kit car build failed in the worker, building on the main thread', response.error);
        done(null);
      } else {
        done(response.wire);
      }
    };
    started.onerror = (event) => {
      event.preventDefault();
      console.error('Kit build worker failed, building kit cars on the main thread', event.message);
      started.terminate();
      worker = null;
      for (const done of waiting.values()) done(null);
      waiting.clear();
    };
    holdProcess(started, false);
    worker = started;
  } catch (error) {
    console.error('No kit build worker, building kit cars on the main thread', error);
  }
  return worker;
}

/**
 * The kit car `kit` built in the worker, as a wire for carkit/wire.ts `readKitWire`; null
 * where there is no worker or the build failed in it (the caller builds it itself).
 */
export function buildKitWire(kit: string): Promise<KitWire | null> {
  const target = kitWorker();
  if (!target) return Promise.resolve(null);
  const id = nextId++;
  const { promise, resolve } = Promise.withResolvers<KitWire | null>();
  waiting.set(id, resolve);
  holdProcess(target, true);
  const request: KitBuildRequest = { id, kit };
  target.postMessage(request);
  return promise;
}
