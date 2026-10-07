/**
 * PERFORMANCE OVERLAY (development only): a live graph of where each presented frame
 * goes, drawn semi-transparent across the top of the screen.
 *
 * The frame report (pause menu) answers "on average, where does the time go" over a
 * few seconds. This answers "what hit the ceiling, and when": one column per presented
 * frame, newest on the right, ~8 seconds of history.
 *
 *   stacked bars   CPU on the main thread, split into the simulation tick (physics,
 *                  traffic, world streaming and agents, the rest of the tick) and the
 *                  render call (draw submission, the rest of it). These nest inside the
 *                  two outer measurements exactly as `FrameProfiler.report` explains.
 *   grey above     the rest of the presented interval: not main-thread work — the
 *                  frame cap or vsync, the GPU, the compositor, or a long task
 *                  outside the profiled sections.
 *   yellow line    the GPU's own time for the frame, where the browser exposes a timer
 *                  query (not on most macOS browsers, nor on Android).
 *   cyan line      the budget the presentation is aiming at (cap or display rate).
 *   red ticks      long tasks (> 50 ms) the browser reported on the main thread.
 *
 * The header names the LIMIT over the last second: GPU when its time fills the
 * interval, CPU (with its biggest section) when main-thread work does, the cap when
 * neither does and the interval sits on the cap, otherwise vsync or the browser.
 * Memory is the JS heap (Chromium only), GPU-side object counts from three.js, and the
 * physics world's body count. Worker threads (terrain, vista, forest) are not visible
 * from the main thread; their cost shows only as what they leave the main thread to do.
 *
 * Its own cost: a few array writes per frame and a 2D redraw at 12 Hz.
 */

import type { FrameProfiler } from '../core/frameprofiler';

/** What the overlay reads each frame; every source is a cheap getter. */
export interface PerfSources {
  readonly profiler: FrameProfiler;
  readonly gpuMs: () => number | null;
  readonly measuresGpu: () => boolean;
  /** The presentation target, FPS: the cap, or null when uncapped. */
  readonly frameCap: () => number | null;
  readonly drawCalls: () => number;
  readonly triangles: () => number;
  readonly programs: () => number;
  readonly textures: () => number;
  readonly geometries: () => number;
  readonly bodies: () => number;
  readonly pixels: () => number;
}

const HISTORY = 480;
const WIDTH = 480;
const GRAPH_H = 110;
const HEADER_H = 60;
const MEMORY_H = 22;
const HEIGHT = HEADER_H + GRAPH_H + MEMORY_H;
/** Milliseconds at the top of the graph. A frame past it is clipped and flagged. */
const SCALE_MS = 50;
const REDRAW_MS = 1000 / 12;
/** Frames the verdict looks back over. */
const VERDICT_FRAMES = 60;
/** A share of the interval at which a resource counts as the ceiling. */
const BOUND_SHARE = 0.85;
const STORAGE_KEY = 'bro.perfOverlay';

/** Stacked bands, bottom up: [label, colour]. Order matches the sample arrays. */
const BANDS: readonly (readonly [string, string])[] = [
  ['physics', '#4f9dff'],
  ['traffic', '#7d6bff'],
  ['world', '#38c7a0'],
  ['tick', '#2f6f95'],
  ['draw', '#ff8a3d'],
  ['render', '#c85a2a'],
];

/** Chromium's non-standard `performance.memory`, where it exists. */
function heapMemory(): { used: number; limit: number } | null {
  if (!('memory' in performance)) return null;
  const memory: unknown = performance.memory;
  if (
    typeof memory === 'object' && memory !== null &&
    'usedJSHeapSize' in memory && typeof memory.usedJSHeapSize === 'number' &&
    'jsHeapSizeLimit' in memory && typeof memory.jsHeapSizeLimit === 'number'
  ) {
    return { used: memory.usedJSHeapSize, limit: memory.jsHeapSizeLimit };
  }
  return null;
}

export class PerfOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  /** Per band, per history slot, ms. */
  private readonly bands = BANDS.map(() => new Float32Array(HISTORY));
  private readonly gap = new Float32Array(HISTORY);
  private readonly gpu = new Float32Array(HISTORY).fill(Number.NaN);
  private readonly longTask = new Uint8Array(HISTORY);
  private head = 0;
  private filled = 0;
  private lastDraw = 0;
  private pendingLongTasks = 0;
  private longTasksTotal = 0;
  private observer: PerformanceObserver | null = null;
  private on = false;

  constructor(
    parent: HTMLElement,
    private readonly sources: PerfSources,
  ) {
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(WIDTH * dpr);
    this.canvas.height = Math.round(HEIGHT * dpr);
    Object.assign(this.canvas.style, {
      position: 'fixed',
      top: '6px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: `${WIDTH}px`,
      height: `${HEIGHT}px`,
      pointerEvents: 'none',
      zIndex: '9999',
      display: 'none',
    });
    parent.appendChild(this.canvas);
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('perf overlay: no 2D context');
    g.scale(dpr, dpr);
    this.g = g;
    this.setEnabled(localStorage.getItem(STORAGE_KEY) === '1');
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    this.canvas.style.display = on ? 'block' : 'none';
    if (on && this.observer === null && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      this.observer = new PerformanceObserver((list) => {
        const n = list.getEntries().length;
        this.pendingLongTasks += n;
        this.longTasksTotal += n;
      });
      this.observer.observe({ type: 'longtask' });
    } else if (!on && this.observer !== null) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /** Once per presented frame, after `FrameProfiler.endFrame`. */
  frame(): void {
    if (!this.on) return;
    const s = this.sources.profiler.last.sections;
    const physics = s.get('physics') ?? 0;
    const traffic = s.get('traffic') ?? 0;
    const world =
      (s.get('streaming') ?? 0) + (s.get('agents') ?? 0) + (s.get('inventory') ?? 0) + (s.get('contracts') ?? 0);
    const sim = s.get('sim') ?? 0;
    const renderWall = s.get('renderWall') ?? 0;
    const draw = s.get('draw') ?? 0;
    const i = this.head;
    this.bands[0]![i] = physics;
    this.bands[1]![i] = traffic;
    this.bands[2]![i] = world;
    this.bands[3]![i] = Math.max(0, sim - physics - traffic - world);
    this.bands[4]![i] = draw;
    this.bands[5]![i] = Math.max(0, renderWall - draw);
    this.gap[i] = this.sources.profiler.last.gapMs;
    this.gpu[i] = this.sources.gpuMs() ?? Number.NaN;
    this.longTask[i] = this.pendingLongTasks > 0 ? 1 : 0;
    this.pendingLongTasks = 0;
    this.head = (i + 1) % HISTORY;
    this.filled = Math.min(HISTORY, this.filled + 1);

    const now = performance.now();
    if (now - this.lastDraw < REDRAW_MS) return;
    this.lastDraw = now;
    this.draw();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.canvas.remove();
  }

  private draw(): void {
    const g = this.g;
    g.clearRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle = 'rgba(8, 10, 14, 0.55)';
    g.fillRect(0, 0, WIDTH, HEIGHT);

    // Over the verdict window: interval, CPU, GPU, biggest band.
    const n = Math.min(VERDICT_FRAMES, this.filled);
    let gapSum = 0;
    let cpuSum = 0;
    let gpuSum = 0;
    let gpuCount = 0;
    let worstGap = 0;
    const bandSum = BANDS.map(() => 0);
    for (let k = 0; k < n; k++) {
      const j = (this.head - 1 - k + HISTORY) % HISTORY;
      gapSum += this.gap[j]!;
      worstGap = Math.max(worstGap, this.gap[j]!);
      for (let b = 0; b < BANDS.length; b++) {
        bandSum[b]! += this.bands[b]![j]!;
        cpuSum += this.bands[b]![j]!;
      }
      const gpu = this.gpu[j]!;
      if (!Number.isNaN(gpu)) {
        gpuSum += gpu;
        gpuCount++;
      }
    }
    const interval = n > 0 ? gapSum / n : 0;
    const cpu = n > 0 ? cpuSum / n : 0;
    const gpu = gpuCount > 0 ? gpuSum / gpuCount : null;
    const cap = this.sources.frameCap();
    const capMs = cap === null ? null : 1000 / cap;
    let top = 0;
    for (let b = 1; b < BANDS.length; b++) if (bandSum[b]! > bandSum[top]!) top = b;
    const limit =
      gpu !== null && gpu > BOUND_SHARE * interval
        ? 'GPU'
        : cpu > BOUND_SHARE * interval
          ? `CPU main (${BANDS[top]![0]})`
          : capMs !== null && interval > 0 && interval < capMs * 1.1
            ? 'frame cap'
            : gpu === null
              ? 'not main thread: GPU, vsync or browser'
              : 'vsync (display rate)';
    const fps = interval > 0 ? 1000 / interval : 0;

    g.font = '11px ui-monospace, Menlo, monospace';
    g.textBaseline = 'top';
    g.fillStyle = '#ffffff';
    g.fillText(
      `${fps.toFixed(0)} fps  ${interval.toFixed(1)} ms (worst ${worstGap.toFixed(0)})  ` +
        `CPU ${cpu.toFixed(1)} ms ${interval > 0 ? ((cpu / interval) * 100).toFixed(0) : 0}%  ` +
        `GPU ${gpu === null ? (this.sources.measuresGpu() ? '…' : 'n/a') : `${gpu.toFixed(1)} ms`}`,
      6,
      4,
    );
    g.fillStyle = limit === 'GPU' || limit.startsWith('CPU') ? '#ffb347' : '#9fe0a0';
    g.fillText(`limit: ${limit}`, 6, 18);
    g.fillStyle = '#c9d1d9';
    g.fillText(
      `draws ${this.sources.drawCalls()}  tris ${(this.sources.triangles() / 1000).toFixed(0)}k  ` +
        `${(this.sources.pixels() / 1e6).toFixed(2)} Mpx  programs ${this.sources.programs()}  ` +
        `long tasks ${this.longTasksTotal}`,
      6,
      32,
    );
    const heap = heapMemory();
    g.fillText(
      `${heap ? `heap ${(heap.used / 1e6).toFixed(0)}/${(heap.limit / 1e6).toFixed(0)} MB  ` : ''}` +
        `tex ${this.sources.textures()}  geo ${this.sources.geometries()}  bodies ${this.sources.bodies()}`,
      6,
      46,
    );

    // The graph.
    const y0 = HEADER_H + GRAPH_H;
    const px = (ms: number): number => Math.min(GRAPH_H, (ms / SCALE_MS) * GRAPH_H);
    const columns = Math.min(this.filled, WIDTH);
    for (let c = 0; c < columns; c++) {
      const j = (this.head - columns + c + HISTORY) % HISTORY;
      const x = WIDTH - columns + c;
      let y = y0;
      for (let b = 0; b < BANDS.length; b++) {
        const h = px(this.bands[b]![j]!);
        if (h <= 0) continue;
        g.fillStyle = BANDS[b]![1];
        g.fillRect(x, y - h, 1, h);
        y -= h;
      }
      const rest = px(this.gap[j]!) - (y0 - y);
      if (rest > 0) {
        g.fillStyle = 'rgba(160, 170, 185, 0.35)';
        g.fillRect(x, y - rest, 1, rest);
      }
      if (this.gap[j]! > SCALE_MS) {
        g.fillStyle = '#ff3b3b';
        g.fillRect(x, HEADER_H, 1, 3);
      }
      if (this.longTask[j]) {
        g.fillStyle = '#ff3b3b';
        g.fillRect(x, y0 - GRAPH_H, 1, GRAPH_H);
      }
    }
    // GPU line.
    g.strokeStyle = '#ffe14d';
    g.lineWidth = 1;
    g.beginPath();
    let pen = false;
    for (let c = 0; c < columns; c++) {
      const j = (this.head - columns + c + HISTORY) % HISTORY;
      const v = this.gpu[j]!;
      if (Number.isNaN(v)) {
        pen = false;
        continue;
      }
      const x = WIDTH - columns + c + 0.5;
      const y = y0 - px(v);
      if (pen) g.lineTo(x, y);
      else g.moveTo(x, y);
      pen = true;
    }
    g.stroke();
    // Budget line and the scale.
    const budget = capMs ?? 1000 / 60;
    g.strokeStyle = '#4de1ff';
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(0, y0 - px(budget) + 0.5);
    g.lineTo(WIDTH, y0 - px(budget) + 0.5);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#8b949e';
    g.fillText(`${SCALE_MS} ms`, WIDTH - 40, HEADER_H + 2);
    g.fillText(`${budget.toFixed(1)}`, 4, y0 - px(budget) - 12);

    // Legend.
    let lx = 6;
    const ly = y0 + 4;
    for (const [label, colour] of BANDS) {
      g.fillStyle = colour;
      g.fillRect(lx, ly + 2, 8, 8);
      g.fillStyle = '#c9d1d9';
      g.fillText(label, lx + 11, ly);
      lx += 11 + g.measureText(label).width + 8;
    }
    g.fillStyle = 'rgba(160, 170, 185, 0.8)';
    g.fillRect(lx, ly + 2, 8, 8);
    g.fillStyle = '#c9d1d9';
    g.fillText('not CPU', lx + 11, ly);
  }
}
