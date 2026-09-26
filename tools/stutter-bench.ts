/**
 * tools/stutter-bench.ts
 *
 * The micro-stutter bench from docs/research-2026-09-26.md, «Дёрганье»: drive on the
 * autopilot and look at the DISTRIBUTION of frame times, not at their mean, with every
 * WebGL upload the frame makes attributed to the frame it happened in.
 *
 * It is loaded from the dev server in a browser, so it runs as:
 *
 *   const { runStutterBench } = await import('/tools/stutter-bench.ts');
 *   await runStutterBench({ label: 'village, rain', startS: 2750, seconds: 20 });
 *
 * WHAT IT MEASURES, AND WHY NOT THE PRESENTED INTERVAL.
 *
 * The first version of this bench (the doc's) timed `requestAnimationFrame` callbacks and
 * reported the interval between them. That interval is what a 144 Hz monitor shows, but it
 * is also the refresh rate's, not the game's: under vsync every frame is quantised to the
 * next vblank, so a 6 ms frame and a 14 ms frame both read as 16.7 ms and the peaks are
 * exactly what a vsync-locked bench cannot see. Measured here (headless Chromium at
 * 60 Hz), the interval bench reported a median of 16.7 ms and could not resolve anything
 * under it.
 *
 * So the frame time is the WALL TIME INSIDE the game's own rAF callback, captured by
 * wrapping `requestAnimationFrame` before the session under test starts. That is the
 * frame's CPU work — simulation, streaming and the render submission — and it is the same
 * thing on a 60 Hz and a 144 Hz display. It excludes the GPU, which is why the bench also
 * reports what the renderer knows about it (`gpuFrameMs`, when the device can time it);
 * a hitch that is entirely on the GPU is not in these numbers.
 *
 * A frame's uploads are the WebGL calls it made (`bufferData`, `bufferSubData`,
 * `texImage2D`, `texSubImage2D`, `generateMipmap`, compile/link), timed individually. The
 * doc's platform finding — on ANGLE over Metal a `bufferSubData` into a buffer the GPU may
 * still be reading waits for it — is why they are reported per frame alongside the frame
 * time rather than as a total.
 *
 * Nothing here is part of the game bundle.
 */

/** Calls the bench times. Each returns the bytes it pushed, or null when that is not a byte count. */
const UPLOAD_CALLS: readonly string[] = [
  'bufferData',
  'bufferSubData',
  'texImage2D',
  'texSubImage2D',
  'generateMipmap',
  'compileShader',
  'linkProgram',
  'readPixels',
];

/** An upload slower than this is worth a stack, to name the code that made it. */
const STACK_FROM_MS = 0.6;
/** Events kept per run before the oldest are dropped. */
const EVENT_CAP = 200_000;

interface UploadEvent {
  t: number;
  kind: string;
  bytes: number;
  ms: number;
  stack: string | null;
}

interface FrameSample {
  t0: number;
  ms: number;
  uploadsMs: number;
  uploadBytes: number;
  uploadCalls: number;
}

interface BenchState {
  frames: FrameSample[];
  uploads: UploadEvent[];
  consoleLines: string[];
  installed: boolean;
  /** The game's own rAF, unwrapped, for the bench's own waiting. */
  rawRaf: ((cb: FrameRequestCallback) => number) | null;
}

interface DevHandle {
  world: { apply(delta: unknown): void; state?: unknown };
  state(): DevState;
  road: {
    offsetPoint(s: number, lateral: number, out?: { x: number; y: number; z: number }): { x: number; y: number; z: number };
    sampleAt(s: number): { heading: number };
  };
  terrain: { heightAt(x: number, z: number, hintS?: number): number };
  player: {
    teleport(x: number, y: number, z: number, knownRoadS?: number): void;
    pushState(): void;
    absolutePosition: { x: number; y: number; z: number };
  };
  vehicles: Map<string, { rescueTo(x: number, y: number, z: number, yaw: number, speed: number): void; pushTransform(): void; contactPlaneLocalY: number }>;
  camera: { setYaw(yaw: number): void };
  autopilot: { setEngaged(on: boolean): void; setMode(mode: string): void; engaged: boolean; mode: string };
  renderer: { resolutionScale: number; renderedPixels: number; drawCalls: number; drawnTriangles: number; gpuFrameMs: number | null; renderer?: unknown };
  weather(state: Partial<Record<string, number>> | null): void;
  worldWork: { frameWorkMs: number };
}

interface DevState {
  settings: Record<string, unknown>;
  player: { drivingCarId: string | null };
  timeOfDay: number;
}

const KEY = '__broStutterBench';

function state(): BenchState {
  const holder = window as unknown as Record<string, BenchState | undefined>;
  let existing = holder[KEY];
  if (!existing) {
    existing = { frames: [], uploads: [], consoleLines: [], installed: false, rawRaf: null };
    holder[KEY] = existing;
  }
  return existing;
}

function dev(): DevHandle {
  const bro = (window as unknown as Record<string, DevHandle | undefined>)['__bro'];
  if (!bro) {
    throw new Error('stutter bench: window.__bro is missing — run this from a dev session of the game');
  }
  return bro;
}

/** Bytes of a texture upload shaped as (width, height, format, type). */
function bytesPerPixel(format: number, type: number): number {
  // Component counts of the formats three actually uploads with, and the size of a
  // component in the types it uploads them as. Anything else counts as unknown-but-large.
  const components = format === 0x1908 ? 4 : format === 0x1907 ? 3 : format === 0x1909 ? 1 : 4;
  const width = type === 0x1406 ? 4 : type === 0x140b ? 2 : type === 0x1401 ? 1 : 4;
  return components * width;
}

function byteLengthOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return 0;
  const view = value as ArrayBufferView;
  if (typeof view.byteLength === 'number') return view.byteLength;
  const image = value as { width?: number; height?: number; data?: ArrayBufferView };
  if (typeof image.width === 'number' && typeof image.height === 'number') {
    return image.width * image.height * 4;
  }
  return 0;
}

function uploadBytes(kind: string, args: readonly unknown[]): number {
  switch (kind) {
    case 'bufferData':
      return byteLengthOf(args[1]);
    case 'bufferSubData':
      return byteLengthOf(args[2]);
    case 'texImage2D':
      // Nine-argument form uploads a typed array of a stated size; six-argument form
      // takes an image. Both are the same texture in the end.
      return args.length >= 9
        ? (args[3] as number) * (args[4] as number) * bytesPerPixel(args[6] as number, args[7] as number)
        : byteLengthOf(args[5]);
    case 'texSubImage2D':
      return args.length >= 9
        ? (args[3] as number) * (args[4] as number) * bytesPerPixel(args[5] as number, args[6] as number)
        : byteLengthOf(args[5]);
    default:
      return 0;
  }
}

/**
 * Times every upload call on the context prototypes and records it against the clock.
 *
 * The prototypes rather than one context's own object: three looks the method up on the
 * context each call, so a prototype write reaches it, and the bench may be installed
 * after the game's context already exists.
 */
function installUploadTiming(): void {
  const prototypes: object[] = [];
  const globals = globalThis as unknown as Record<string, { prototype: object } | undefined>;
  for (const name of ['WebGL2RenderingContext', 'WebGLRenderingContext']) {
    const ctor = globals[name];
    if (ctor) prototypes.push(ctor.prototype);
  }
  if (prototypes.length === 0) {
    throw new Error('stutter bench: no WebGL context class in this window');
  }
  const record = state();
  for (const prototype of prototypes) {
    const holder = prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const kind of UPLOAD_CALLS) {
      const original = holder[kind];
      if (typeof original !== 'function') continue;
      holder[kind] = function timed(this: unknown, ...args: unknown[]): unknown {
        const started = performance.now();
        const result = original.apply(this, args);
        const elapsed = performance.now() - started;
        if (record.uploads.length < EVENT_CAP) {
          record.uploads.push({
            t: started,
            kind,
            bytes: uploadBytes(kind, args),
            ms: elapsed,
            stack: elapsed >= STACK_FROM_MS ? (new Error().stack ?? null) : null,
          });
        }
        return result;
      };
    }
  }
}

/** Wraps `requestAnimationFrame`: every callback the game schedules is timed. */
function installFrameTiming(): void {
  const record = state();
  const raw = window.requestAnimationFrame.bind(window);
  if (!record.rawRaf) record.rawRaf = raw;
  window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    raw((timestamp: number) => {
      const t0 = performance.now();
      callback(timestamp);
      const ms = performance.now() - t0;
      if (record.frames.length < EVENT_CAP) {
        record.frames.push({ t0, ms, uploadsMs: 0, uploadBytes: 0, uploadCalls: 0 });
      }
    });
}

/**
 * The frame profiler prints its window to `console.debug`; the bench keeps those lines,
 * which is where the per-section breakdown of the run comes from.
 */
function installConsoleCapture(): void {
  const record = state();
  const original = console.debug;
  console.debug = (...args: unknown[]): void => {
    const line = args.map((value) => String(value)).join(' ');
    if (line.startsWith('[perf]')) record.consoleLines.push(line);
    original.apply(console, args);
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

export interface StutterOptions {
  /** Name for the report. */
  label?: string;
  /**
   * Absolute arclength to start the leg from, or null to drive on from wherever the car
   * already is. The car and the player are moved together, as the lake jump does.
   */
  startS?: number | null;
  /** Lateral offset of the start position, metres from the centreline. */
  lateral?: number;
  /** Seconds of measured driving. */
  seconds?: number;
  /** Seconds of streaming between arriving and measuring. The world has to catch up. */
  settleSeconds?: number;
  /** Weather channels to hold, or null to leave the road's own. See `world/weather.ts`. */
  weather?: Partial<Record<'overcast' | 'precip' | 'snowing' | 'fog' | 'wet', number>> | null;
  /** Time of day in hours, or null to leave it. */
  hour?: number | null;
  /** Autopilot mode. `sleeper` unless a leg is about traffic or a hurry. */
  mode?: 'sleeper' | 'hurried' | 'frantic';
}

export interface StutterFrame {
  /** Start time of the frame on the page clock, ms. */
  t0: number;
  /** Wall time inside the game's callback, ms. */
  ms: number;
  uploadsMs: number;
  uploadBytes: number;
}

export interface StutterReport {
  label: string;
  seconds: number;
  frames: number;
  fpsPresented: number;
  medianMs: number;
  meanMs: number;
  p95Ms: number;
  p99Ms: number;
  worstMs: number;
  /** Frames longer than 1.6 × the median: one visible judder each on a 144 Hz display. */
  hitches: number;
  /** Share of frames outside ±25% of the median. */
  unevenShare: number;
  uploadMsPerFrame: number;
  uploadBytesPerFrame: number;
  uploadsByKind: { kind: string; calls: number; ms: number; bytes: number }[];
  worstFrames: StutterFrame[];
  /** Uploads at least `STACK_FROM_MS` slow, named by the code that made them. */
  slowUploads: { kind: string; ms: number; bytes: number; stack: string | null }[];
  slowestStacks: { stack: string; calls: number; ms: number }[];
  /** The frame profiler's own windows seen during the run. */
  profile: string[];
  /** What the renderer was doing: the numbers the adaptor moves. */
  render: { resolutionScale: number; renderedPixels: number; drawCalls: number; drawnTriangles: number; gpuMs: number | null };
  /** Streaming work the scheduler did, from its own dev log. */
  streaming: { frames: number; totalMs: number; worstMs: number; worstJob: string | null };
}

/** The three lines of state the bench changes, so a leg leaves the session as it found it. */
function topOfStack(stack: string | null): string | null {
  if (!stack) return null;
  const lines = stack.split('\n').slice(1);
  for (const line of lines) {
    const match = /\(?(https?:\/\/[^):]+|file:\/\/[^):]+):(\d+):(\d+)/.exec(line);
    if (match) return `${match[1]}:${match[2]}`;
  }
  return lines[1]?.trim() ?? null;
}

function summarise(
  label: string,
  seconds: number,
  frames: readonly FrameSample[],
  uploads: readonly UploadEvent[],
  consoleLines: readonly string[],
  renderedNow: StutterReport['render'],
): StutterReport {
  const times = frames.map((frame) => frame.ms).sort((a, b) => a - b);
  const median = percentile(times, 0.5);
  const mean = times.length === 0 ? 0 : times.reduce((sum, value) => sum + value, 0) / times.length;
  const first = frames[0]?.t0 ?? 0;
  const last = frames.length === 0 ? first : frames[frames.length - 1]!.t0;
  const presentedSeconds = Math.max(0.001, (last - first) / 1000);

  // Every upload is charged to the frame whose callback ran when it happened — the
  // interval [t0, t0 + ms). An upload outside every frame (a `setTimeout` path) is left
  // in the totals and out of the per-frame figures.
  const byKind = new Map<string, { kind: string; calls: number; ms: number; bytes: number }>();
  let cursor = 0;
  const charged = frames.map((frame) => ({ ...frame }));
  let uploadMs = 0;
  let uploadBytes = 0;
  let unchargedMs = 0;
  for (const event of uploads) {
    const entry = byKind.get(event.kind) ?? { kind: event.kind, calls: 0, ms: 0, bytes: 0 };
    entry.calls++;
    entry.ms += event.ms;
    entry.bytes += event.bytes;
    byKind.set(event.kind, entry);
    uploadMs += event.ms;
    uploadBytes += event.bytes;
    while (cursor < charged.length && charged[cursor]!.t0 + charged[cursor]!.ms < event.t) cursor++;
    const frame = charged[cursor];
    if (frame && event.t >= frame.t0) {
      frame.uploadsMs += event.ms;
      frame.uploadBytes += event.bytes;
      frame.uploadCalls++;
    } else {
      unchargedMs += event.ms;
    }
  }
  void unchargedMs;

  const hitches = times.filter((value) => value > median * 1.6).length;
  const uneven = times.filter((value) => Math.abs(value - median) > median * 0.25).length;

  const slow = uploads
    .filter((event) => event.ms >= STACK_FROM_MS)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 25)
    .map((event) => ({ kind: event.kind, ms: event.ms, bytes: event.bytes, stack: topOfStack(event.stack) }));
  const stacks = new Map<string, { stack: string; calls: number; ms: number }>();
  for (const event of uploads) {
    if (event.ms < STACK_FROM_MS) continue;
    const name = topOfStack(event.stack) ?? event.kind;
    const entry = stacks.get(name) ?? { stack: name, calls: 0, ms: 0 };
    entry.calls++;
    entry.ms += event.ms;
    stacks.set(name, entry);
  }

  const worstFrames = [...charged].sort((a, b) => b.ms - a.ms).slice(0, 12);

  // The streaming scheduler's own dev log: per-frame world work and the worst job in it.
  let streamingFrames = 0;
  let streamingTotal = 0;
  let streamingWorst = 0;
  let streamingWorstJob: string | null = null;
  for (const line of consoleLines) {
    const match = /^\[perf\] streaming frame=\d+ work=([\d.]+)ms worst=([\d.]+)ms job=(\S+)/.exec(line);
    if (!match) continue;
    streamingFrames++;
    streamingTotal += Number(match[1]);
    if (Number(match[2]) > streamingWorst) {
      streamingWorst = Number(match[2]);
      streamingWorstJob = match[3]!;
    }
  }

  return {
    label,
    seconds,
    frames: frames.length,
    fpsPresented: frames.length / presentedSeconds,
    medianMs: median,
    meanMs: mean,
    p95Ms: percentile(times, 0.95),
    p99Ms: percentile(times, 0.99),
    worstMs: times.length === 0 ? 0 : times[times.length - 1]!,
    hitches,
    unevenShare: times.length === 0 ? 0 : uneven / times.length,
    uploadMsPerFrame: frames.length === 0 ? 0 : uploadMs / frames.length,
    uploadBytesPerFrame: frames.length === 0 ? 0 : uploadBytes / frames.length,
    uploadsByKind: [...byKind.values()].sort((a, b) => b.ms - a.ms),
    worstFrames,
    slowUploads: slow,
    slowestStacks: [...stacks.values()].sort((a, b) => b.ms - a.ms).slice(0, 12),
    profile: consoleLines.filter((line) => !line.startsWith('[perf] streaming')),
    render: renderedNow,
    streaming: { frames: streamingFrames, totalMs: streamingTotal, worstMs: streamingWorst, worstJob: streamingWorstJob },
  };
}

/**
 * Puts the car and the player at an arclength on the road, facing forward.
 *
 * The driven car comes along through `rescueTo`, the same door the underworld recovery
 * uses, so the car and the arclength hint cannot end up in different counties.
 */
function placeAt(bro: DevHandle, s: number, lateral: number): void {
  const point = bro.road.offsetPoint(s, lateral);
  const y = bro.terrain.heightAt(point.x, point.z, s);
  const yaw = bro.road.sampleAt(s).heading;
  const drivingId = bro.state().player.drivingCarId;
  const driven = drivingId ? bro.vehicles.get(drivingId) : undefined;
  if (driven) {
    driven.rescueTo(point.x, y - driven.contactPlaneLocalY, point.z, yaw, 0);
    driven.pushTransform();
  }
  bro.player.teleport(point.x, y + 1.2, point.z, s);
  bro.player.pushState();
  // Onto the road's own centreline, nose down it: the autopilot's line picker starts from
  // wherever the car is pointing.
  bro.camera.setYaw(yaw);
}

/** Seats the player in the nearest car when standing beside one. */
function enterNearestCar(bro: DevHandle): void {
  if (bro.state().player.drivingCarId) return;
  const here = bro.player.absolutePosition;
  let nearestId: string | null = null;
  let nearest = Infinity;
  for (const [id] of bro.vehicles) {
    const vehicle = bro.vehicles.get(id)!;
    const distance = (vehicle as unknown as { absoluteTranslation(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } })
      .absoluteTranslation({ x: 0, y: 0, z: 0 });
    const dx = distance.x - here.x;
    const dz = distance.z - here.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < nearest) {
      nearest = d2;
      nearestId = id;
    }
  }
  if (!nearestId) throw new Error('stutter bench: no car is loaded to drive');
  bro.world.apply({ t: 'enter_car', carId: nearestId });
}

/**
 * One leg: settle, then measure `seconds` of driving and report the distribution.
 *
 * The instrumentation is installed once and kept: wrapping `requestAnimationFrame` twice
 * would time the bench's own callbacks into the game's sample.
 */
export async function runStutterBench(options: StutterOptions = {}): Promise<StutterReport> {
  const bro = dev();
  const record = state();
  if (!record.installed) {
    installUploadTiming();
    installFrameTiming();
    installConsoleCapture();
    record.installed = true;
  }
  const rawRaf = record.rawRaf ?? window.requestAnimationFrame.bind(window);

  const seconds = options.seconds ?? 20;
  const settleSeconds = options.settleSeconds ?? 4;

  enterNearestCar(bro);
  bro.autopilot.setMode(options.mode ?? 'sleeper');
  bro.autopilot.setEngaged(true);
  if (options.weather !== undefined) bro.weather(options.weather);
  if (options.hour !== undefined && options.hour !== null) {
    bro.world.apply({ t: 'time_of_day', timeOfDay: (options.hour / 24) * 1440 });
  }
  // Settle from before the start: the pre-roll is not part of the sample.
  await sleep(500);
  if (options.startS !== undefined && options.startS !== null) {
    placeAt(bro, options.startS, options.lateral ?? 0);
  }
  await sleep(settleSeconds * 1000);

  record.frames.length = 0;
  record.uploads.length = 0;
  record.consoleLines.length = 0;
  const startS = options.startS ?? null;
  await sleep(seconds * 1000);
  const endS = (window as unknown as Record<string, DevHandle>)['__bro']!.state().timeOfDay;

  const render = {
    resolutionScale: bro.renderer.resolutionScale,
    renderedPixels: bro.renderer.renderedPixels,
    drawCalls: bro.renderer.drawCalls,
    drawnTriangles: bro.renderer.drawnTriangles,
    gpuMs: bro.renderer.gpuFrameMs,
  };
  void endS;
  void rawRaf;
  return summarise(
    options.label ?? 'leg',
    seconds,
    record.frames,
    record.uploads,
    record.consoleLines,
    render,
  );
}

/** One line of the bench's table, for the console and for a copy-paste into a doc. */
export function formatStutterReport(report: StutterReport): string {
  return (
    `${report.label.padEnd(26)} ` +
    `median ${report.medianMs.toFixed(2).padStart(6)}  p95 ${report.p95Ms.toFixed(2).padStart(6)}  ` +
    `p99 ${report.p99Ms.toFixed(2).padStart(6)}  worst ${report.worstMs.toFixed(2).padStart(7)}  ` +
    `hitches ${String(report.hitches).padStart(3)}  uneven ${(report.unevenShare * 100).toFixed(1).padStart(4)}%  ` +
    `upload ${report.uploadMsPerFrame.toFixed(2).padStart(5)} ms/frame  ${(report.uploadBytesPerFrame / 1024).toFixed(0).padStart(5)} KiB/frame  ` +
    `stream ${report.streaming.worstMs.toFixed(2)} ms worst (${report.streaming.worstJob ?? 'none'})`
  );
}

/** The bench's whole table, worst-frame first, as text. */
export function formatStutterReports(reports: readonly StutterReport[]): string {
  const lines = reports.map(formatStutterReport);
  lines.push('');
  for (const report of reports) {
    const kinds = report.uploadsByKind
      .slice(0, 6)
      .map((entry) => `${entry.kind} ${entry.ms.toFixed(1)}ms/${(entry.bytes / 1024).toFixed(0)}KiB/${entry.calls}`)
      .join('  ');
    lines.push(`${report.label}: uploads ${kinds || 'none'}`);
    for (const stack of report.slowestStacks.slice(0, 4)) {
      lines.push(`    ${stack.ms.toFixed(1)} ms in ${stack.calls} calls from ${stack.stack}`);
    }
    for (const frame of report.worstFrames.slice(0, 4)) {
      lines.push(
        `    worst frame ${frame.ms.toFixed(1)} ms, uploads ${frame.uploadsMs.toFixed(1)} ms / ` +
          `${(frame.uploadBytes / 1024).toFixed(0)} KiB`,
      );
    }
  }
  return lines.join('\n');
}
