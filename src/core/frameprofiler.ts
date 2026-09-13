/**
 * Dev-only rolling frame timings.
 *
 * The question this answers is not "how long is a frame" — that is visible on screen —
 * but "how much work is being done, and where". A frame presented at 30 FPS can still be
 * spending 400 ms of CPU every second, and on a phone that sustained work is what makes
 * it hot rather than slow. So the headline number is BUSY MILLISECONDS PER SECOND, and
 * the sections underneath say which of it is worth attacking.
 *
 * Sections accumulate rather than replace: the simulation runs several times per
 * presented frame, so `sim` and `physics` are sums over every tick in the frame while the
 * render sections are single measurements. Cheap enough to leave on in development —
 * a dozen clock reads per frame.
 *
 * Nothing here is part of a production bundle; every caller is behind `import.meta.env.DEV`.
 */

/** Named cost centres. Keep them coarse: a section per function measures nothing useful. */
export type FrameSection =
  | 'sim'
  | 'physics'
  | 'agents'
  | 'streaming'
  | 'inventory'
  | 'sky'
  | 'vehicles'
  | 'effects'
  | 'vista'
  | 'lights'
  | 'hud'
  | 'draw';

const SECTIONS: readonly FrameSection[] = [
  'sim',
  'physics',
  'agents',
  'streaming',
  'inventory',
  'sky',
  'vehicles',
  'effects',
  'vista',
  'lights',
  'hud',
  'draw',
];

/** Frames kept for the report. About two seconds at 120 FPS, eight at 30. */
const WINDOW_FRAMES = 240;

/** Sections under this many milliseconds per second are noise, not findings. */
const REPORT_FLOOR_MS_PER_SECOND = 1;

export interface ReportOptions {
  /** Simulation rate, for the split between the fixed half and the presented half. */
  readonly simulationHz?: number;
  /** Mean measured GPU duration, where the device can measure it at all. */
  readonly gpuMs?: number | null;
  /**
   * Whether the presentation is deliberately capped.
   *
   * The "halving the frame rate" line is advice about a cap, so it is printed only where a
   * cap exists. On a desktop presenting uncapped it was noise that read as a suggestion.
   */
  readonly presentationCapped?: boolean;
}

/** A named section, plus the render call itself, which is not a section of its own. */
type SampleKey = FrameSection | 'renderWall';

/**
 * The clock is a parameter, defaulted to the real one.
 *
 * Not for the game — one caller, one clock. It is because this class is ARITHMETIC on
 * timings, and arithmetic that can only be exercised with real elapsed time can only be
 * tested by waiting, which makes a wrong divisor or a double-counted section invisible
 * until it has already misled somebody's optimisation. `tools/frame-report.ts` drives it
 * with a clock it controls.
 */
export type ProfileClock = () => number;

export class FrameProfiler {
  constructor(private readonly clock: ProfileClock = () => performance.now()) {}

  private readonly samples = new Map<SampleKey, number[]>();
  private readonly open = new Map<SampleKey, number>();
  private readonly current = new Map<SampleKey, number>();
  private renderStart = 0;
  private windowStartMs = 0;
  private windowFrames = 0;

  /** Length of the current window, seconds. The divisor for every per-second figure. */
  private elapsedSeconds = 0;

  /**
   * Starts the window at the first work of ANY kind, not at the first presented frame.
   *
   * A frame's simulation runs BEFORE its `beginFrame`, several ticks of it, so opening the
   * window there left that work outside the elapsed time the report divides by: the window
   * then described less time than it contained work, and `busy` could exceed the interval
   * it was supposed to fit inside — measured, 13.00 ms of work against a 12.79 ms interval,
   * which makes the waiting clamp to zero and hides the very figure the report exists to
   * show. Opening on the first sample of either kind makes the span exact by construction.
   */
  private ensureWindowStarted(): number {
    const now = this.clock();
    if (this.windowStartMs === 0) this.windowStartMs = now;
    return now;
  }

  beginFrame(): void {
    this.renderStart = this.ensureWindowStarted();
  }

  begin(section: SampleKey): void {
    this.open.set(section, this.ensureWindowStarted());
  }

  end(section: SampleKey): void {
    const started = this.open.get(section);
    if (started === undefined) return;
    this.open.delete(section);
    this.current.set(section, (this.current.get(section) ?? 0) + (this.clock() - started));
  }

  endFrame(): void {
    // The render call itself, so that whatever the named sections do not cover is
    // still accounted for instead of looking like free time.
    this.current.set('renderWall', this.clock() - this.renderStart);
    for (const [section, ms] of this.current) {
      const list = this.samples.get(section) ?? [];
      list.push(ms);
      if (list.length > WINDOW_FRAMES) list.shift();
      this.samples.set(section, list);
    }
    this.current.clear();
    this.windowFrames++;
    const now = this.clock();
    this.elapsedSeconds = (now - this.windowStartMs) / 1000;
    if (this.windowFrames >= WINDOW_FRAMES) this.roll(now);
  }

  private roll(now: number): void {
    const report = this.report();
    this.windowFrames = 0;
    this.windowStartMs = now;
    for (const list of this.samples.values()) list.length = 0;
    console.debug(report);
  }

  /**
   * The readout, formatted for a person to read off a screen or a console.
   *
   * Percentiles rather than means for the total: a frame that is usually fine and
   * occasionally stalls is a different problem from one that is uniformly slow, and the
   * mean cannot tell them apart.
   */
  report(options: ReportOptions = {}): string {
    const simulationHz = options.simulationHz ?? 60;
    const gpuMs = options.gpuMs ?? null;
    const lines: string[] = [];
    const mean = (values: readonly number[]): number =>
      values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
    const percentile = (values: readonly number[], fraction: number): number => {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
    };

    const seconds = Math.max(0.001, this.elapsedSeconds);
    const framesPerSecond = this.windowFrames / seconds;

    // Busy milliseconds per second: the number that maps to heat.
    //
    // THE SECTIONS NEST, and the total must respect that or it counts the same work
    // twice. `sim` contains the physics, agents and streaming of every tick in the frame;
    // the render call contains every render section. So the total is the two OUTER
    // measurements — the tick and the render — and the sections underneath are a
    // breakdown of those two, never a sum of their own.
    const simMs = mean(this.samples.get('sim') ?? []);
    const renderWallMs = mean(this.samples.get('renderWall') ?? []);
    const busyMsPerFrame = simMs + renderWallMs;
    const busyMsPerSecond = busyMsPerFrame * framesPerSecond;

    lines.push(
      `[perf] ${framesPerSecond.toFixed(1)} fps presented, ${busyMsPerSecond.toFixed(0)} ms of CPU per second`,
    );
    lines.push(
      `[perf] per frame: simulation ${simMs.toFixed(2)} ms + render ${renderWallMs.toFixed(2)} ms ` +
        `= ${busyMsPerFrame.toFixed(2)} ms of work`,
    );

    // THE FRAME BUDGET: the interval, the CPU work inside it, and what is left.
    //
    // IT DOES NOT MEASURE THE GPU, and the difference matters. An earlier version of this
    // comment claimed the remainder was "the CPU blocked, most often on the GPU" — which
    // the first machine able to check it disproved. Measured on a 4090 at 144 Hz: the
    // remainder was 1.63 ms while the GPU was busy 6.94 ms. The CPU is not blocked for the
    // GPU's duration, because submission is pipelined — the CPU is already assembling the
    // next frame while this one is still being drawn. So the remainder bounds the CPU and
    // nothing else, and reading it as "the GPU is the constraint" is wrong.
    //
    // What it IS good for: a machine whose CPU work fills its interval is CPU-bound and no
    // pixel budget will help, and shrinking the remainder across a change in the settings
    // says the change moved something. Attribution needs the GPU number below, or an
    // intervention.
    const intervalMs = framesPerSecond > 0 ? 1000 / framesPerSecond : 0;
    const waitingMs = Math.max(0, intervalMs - busyMsPerFrame);
    lines.push(
      `[perf] frame budget: ${intervalMs.toFixed(2)} ms per presented frame = ` +
        `${busyMsPerFrame.toFixed(2)} ms of CPU work + ${waitingMs.toFixed(2)} ms not CPU`,
    );
    // How much of the simulation this frame actually contains. On a desktop presenting
    // uncapped this is well under one tick — the loop steps whole ticks and most frames
    // carry none — which is worth showing rather than stating as a constant.
    if (intervalMs > 0) {
      lines.push(
        `[perf] simulation ticks per presented frame ${(simulationHz / framesPerSecond).toFixed(2)}`,
      );
    }

    // THE VERDICT, where there is a GPU number to give one. The frame time is set by
    // whichever half is larger, so that is the comparison, and the answer decides whether
    // to go after pixels or after CPU work. Measured on a 4090 at 144 Hz: `GPU 6.94 ms
    // against a 6.81 ms interval` — the GPU is the constraint and there is nothing left to
    // win on the CPU side of that frame.
    if (gpuMs !== null && intervalMs > 0) {
      lines.push(
        `[perf] GPU ${gpuMs.toFixed(2)} ms against a ${intervalMs.toFixed(2)} ms interval: ` +
          (gpuMs >= intervalMs * 0.98
            ? `the GPU sets the frame time, CPU has ${waitingMs.toFixed(2)} ms spare`
            : `the GPU has ${(intervalMs - gpuMs).toFixed(2)} ms spare — the limit is not fill`),
      );
    } else if (intervalMs > 0) {
      lines.push(
        '[perf] no GPU timer on this device, so the budget above bounds the CPU only and ' +
          'does NOT say whether the GPU is the constraint',
      );
    }

    // WHICH HALF A FRAME RATE CAN REACH.
    //
    // The simulation is fixed at `simulationHz` whatever the display does, so its cost
    // per second is the same at every frame rate — presenting less often does not make
    // the car cheaper to step. The render half is the opposite: it is paid once per
    // PRESENTED frame, so it scales exactly with frame rate. That is the whole reason
    // lowering the cap cools a device down, and it also says where the bottom is: the
    // floor is the simulation, and no frame-rate cap can go below it.
    const simPerSecond = simMs * framesPerSecond;
    const renderPerSecond = renderWallMs * framesPerSecond;
    lines.push(
      `[perf] per second: simulation ${simPerSecond.toFixed(0)} ms (fixed at ${simulationHz} Hz, ` +
        `a frame rate cannot change it) + render ${renderPerSecond.toFixed(0)} ms (scales with ` +
        `${framesPerSecond.toFixed(0)} FPS)`,
    );
    if (framesPerSecond > 1 && options.presentationCapped) {
      const atHalf = simPerSecond + renderPerSecond / 2;
      lines.push(
        `[perf] halving the frame rate would cost ${atHalf.toFixed(0)} ms/s ` +
          `(floor ${simPerSecond.toFixed(0)} ms/s, reached only at zero frames)`,
      );
    }

    // WHICH HALF EACH SECTION BELONGS TO, and a share measured against that half.
    //
    // A share of the WHOLE frame would be a lie: the sections nest, so adding them up
    // gives more than the frame contains — measured, the shares came to 120%. A section's
    // share of its own half is both true and the more useful question, because it says
    // where the work sits within the part you can actually do something about.
    const TICK_SECTIONS: readonly FrameSection[] = ['physics', 'agents', 'streaming', 'inventory'];
    const groupOf = (section: FrameSection): 'tick' | 'render' =>
      section === 'sim' || TICK_SECTIONS.includes(section) ? 'tick' : 'render';
    const groupTotal: Record<'tick' | 'render', number> = {
      tick: simPerSecond,
      render: renderPerSecond,
    };
    const ranked = SECTIONS.map((section) => ({
      section,
      group: groupOf(section),
      msPerSecond: mean(this.samples.get(section) ?? []) * framesPerSecond,
      meanMs: mean(this.samples.get(section) ?? []),
      worstMs: percentile(this.samples.get(section) ?? [], 0.95),
    }))
      .filter((entry) => entry.msPerSecond >= REPORT_FLOOR_MS_PER_SECOND)
      .sort((a, b) => b.msPerSecond - a.msPerSecond);

    for (const entry of ranked) {
      const total = groupTotal[entry.group];
      // The group total has no share of itself.
      const share = entry.section === 'sim'
        ? '     '
        : `${(total > 0 ? (entry.msPerSecond / total) * 100 : 0).toFixed(0).padStart(3)}% of ${entry.group}`;
      lines.push(
        `[perf]   ${entry.section.padEnd(10)} ${entry.msPerSecond.toFixed(0).padStart(5)} ms/s  ` +
          `${share.padEnd(16)}(${entry.meanMs.toFixed(2)} ms/frame, p95 ${entry.worstMs.toFixed(2)})`,
      );
    }
    lines.push(
      '[perf]   sections nest: the tick ones sit inside the simulation, the rest inside the render call',
    );

    if (ranked.length === 0) lines.push('[perf]   no section above the reporting floor');
    return lines.join('\n');
  }
}
