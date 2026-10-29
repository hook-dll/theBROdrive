import * as THREE from 'three';
import { dieCastArrays, type DieCastArrays, type DieCastRequest, type DieCastResponse } from './diecast';

/**
 * THE DIE-CAST WORKSHOP: each kit car asked for is built, flattened and painted in a
 * worker (ui/diecastworker.ts, ui/diecast.ts `dieCastArrays`), one at a time and in the
 * order asked, and handed back as arrays. A kit car is 100-300 ms of building: the
 * title room (ui/roomscene.ts) orders 28 of them, and on the main thread every one was
 * a frozen frame of the title screen. The toy box's stands (world/toybox.ts) order the
 * boxed car they show on their turntable the same way, mid-drive.
 *
 * A worker that cannot start or load leaves the rest of the orders to the main thread
 * (`mainThreadFallback`), one per pause between frames: the title room's case still
 * fills, only less smoothly. A shop without the fallback (the world's) drops them
 * instead: a frozen fifth of a second at the wheel is worse than an empty turntable.
 *
 * Browser only: it needs `Worker` or `window`. A headless caller checks
 * `dieCastShopAvailable` first.
 */

/** One kit car to be built, and what becomes of it. */
export interface DieCastOrder extends DieCastRequest {
  readonly done: (arrays: DieCastArrays) => void;
}

/** Whether a shop can work here: a browser with a window (the headless tools have none). */
export function dieCastShopAvailable(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined';
}

export class DieCastShop {
  private worker: Worker | null = null;
  private readonly queue: DieCastOrder[] = [];
  private current: DieCastOrder | null = null;
  private timer = 0;
  private closed = false;

  /**
   * `who` names the shop in its console messages; `mainThreadFallback` builds on the
   * main thread once the worker has failed, else the orders are dropped.
   */
  constructor(private readonly who: string, private readonly mainThreadFallback: boolean) {
    try {
      const worker = new Worker(new URL('./diecastworker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<DieCastResponse>) => this.receive(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        console.error(`${who}: die-cast worker failed${mainThreadFallback ? ', building on the main thread' : ''}`, event.message);
        this.dropWorker();
      };
      this.worker = worker;
    } catch (error) {
      console.error(`${who}: no die-cast worker${mainThreadFallback ? ', building on the main thread' : ''}`, error);
    }
  }

  order(order: DieCastOrder): void {
    if (!this.worker && !this.mainThreadFallback) return;
    this.queue.push(order);
    this.pump();
  }

  /** Move the order for `modelId` to the front of the queue, if it is still waiting. */
  hurry(modelId: string): void {
    const i = this.queue.findIndex((order) => order.modelId === modelId);
    if (i > 0) this.queue.unshift(...this.queue.splice(i, 1));
  }

  /** Drops `order` if it is still waiting: it will not be built, nor `done` called. False when it is not waiting. */
  cancel(order: DieCastOrder): boolean {
    const i = this.queue.indexOf(order);
    if (i < 0) return false;
    this.queue.splice(i, 1);
    return true;
  }

  close(): void {
    this.closed = true;
    this.queue.length = 0;
    this.current = null;
    window.clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
  }

  private pump(): void {
    if (this.closed || this.current || this.queue.length === 0) return;
    const order = this.queue.shift()!;
    this.current = order;
    if (this.worker) {
      const request: DieCastRequest = { modelId: order.modelId, color: order.color, scale: order.scale };
      this.worker.postMessage(request);
      return;
    }
    this.timer = window.setTimeout(() => {
      if (this.closed) return;
      this.current = null;
      try {
        order.done(dieCastArrays(order));
      } catch (error) {
        console.error(`${this.who}: die-cast ${order.modelId} failed`, error);
      }
      this.pump();
    }, 60);
  }

  private receive(response: DieCastResponse): void {
    const order = this.current;
    if (this.closed || !order) return;
    this.current = null;
    if ('error' in response) console.error(`${this.who}: die-cast ${order.modelId} failed`, response.error);
    else order.done({ position: new Float32Array(response.position), normal: new Float32Array(response.normal), color: new Float32Array(response.color) });
    this.pump();
  }

  private dropWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    if (!this.mainThreadFallback) {
      this.queue.length = 0;
      this.current = null;
      return;
    }
    if (this.current) this.queue.unshift(this.current);
    this.current = null;
    this.pump();
  }
}

/** A die-cast's arrays as a geometry: position, normal and its colours in the vertices. */
export function dieCastGeometry(arrays: DieCastArrays): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(arrays.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(arrays.color, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
