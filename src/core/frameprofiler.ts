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

  beginFrame(): void {
    this.renderStart = this.clock();
    if (this.windowStartMs === 0) this.windowStartMs = this.renderStart;
  }

  begin(section: SampleKey): void {
    this.open.set(section, this.clock());
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
  report(): string {
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

    const TICK_SECTIONS: readonly FrameSection[] = ['physics', 'agents', 'streaming', 'inventory'];
    const ranked = SECTIONS.map((section) => ({
      section,
      group: TICK_SECTIONS.includes(section) ? 'tick' : 'render',
      msPerSecond: mean(this.samples.get(section) ?? []) * framesPerSecond,
      meanMs: mean(this.samples.get(section) ?? []),
      worstMs: percentile(this.samples.get(section) ?? [], 0.95),
    }))
      .filter((entry) => entry.msPerSecond >= REPORT_FLOOR_MS_PER_SECOND)
      .sort((a, b) => b.msPerSecond - a.msPerSecond);

    for (const entry of ranked) {
      const share = busyMsPerSecond > 0 ? (entry.msPerSecond / busyMsPerSecond) * 100 : 0;
      lines.push(
        `[perf]   ${entry.section.padEnd(10)} ${entry.group.padEnd(6)} ` +
          `${entry.msPerSecond.toFixed(0).padStart(5)} ms/s ${share.toFixed(1).padStart(5)}%  ` +
          `(${entry.meanMs.toFixed(2)} ms/frame, p95 ${entry.worstMs.toFixed(2)})`,
      );
    }
    lines.push('[perf]   sections are nested: tick ones sit inside the simulation, render ones inside the render');

    if (ranked.length === 0) lines.push('[perf]   no section above the reporting floor');
    return lines.join('\n');
  }
}
