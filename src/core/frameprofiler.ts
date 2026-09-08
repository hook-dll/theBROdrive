const SAMPLE_COUNT = 120;

interface TimingSample {
  total: number;
  vista: number;
  streaming: number;
}

/** Dev-only rolling frame timings; production callers are erased by the DEV guard. */
export class FrameProfiler {
  private readonly samples: TimingSample[] = [];
  private active: { total: number; vista: number; streaming: number } | null = null;
  private sectionStart = 0;
  private frameCount = 0;

  beginFrame(): void {
    this.active = { total: performance.now(), vista: 0, streaming: 0 };
  }

  begin(section: 'vista' | 'streaming'): void {
    if (this.active === null) return;
    this.sectionStart = performance.now();
    this.active[section] -= this.sectionStart;
  }

  end(section: 'vista' | 'streaming'): void {
    if (this.active === null) return;
    this.active[section] += performance.now();
  }

  endFrame(): void {
    if (this.active === null) return;
    const total = performance.now() - this.active.total;
    this.samples.push({ total, vista: this.active.vista, streaming: this.active.streaming });
    if (this.samples.length > SAMPLE_COUNT) this.samples.shift();
    this.active = null;
    this.frameCount++;
    if (this.frameCount % SAMPLE_COUNT !== 0) return;
    const totals = this.samples.map((sample) => sample.total).sort((a, b) => a - b);
    const p95 = totals[Math.min(totals.length - 1, Math.floor(totals.length * 0.95))] ?? 0;
    const worst = totals[totals.length - 1] ?? 0;
    const vistaWorst = Math.max(...this.samples.map((sample) => sample.vista));
    const streamingWorst = Math.max(...this.samples.map((sample) => sample.streaming));
    console.debug(
      `[perf] frame p95=${p95.toFixed(2)}ms worst=${worst.toFixed(2)}ms `
      + `vista=${vistaWorst.toFixed(2)}ms streaming=${streamingWorst.toFixed(2)}ms`,
    );
  }
}
