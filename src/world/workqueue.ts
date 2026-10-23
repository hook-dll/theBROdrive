/**
 * Longest stretch of main thread one streaming job may hold, milliseconds.
 *
 * Not the frame budget: the budget only decides whether ANOTHER job is admitted. A
 * 144 Hz frame is 6.9 ms, and physics and the render submission have to fit beside the
 * streaming work, so one job gets a millisecond whatever the budget says — at boot as
 * in play, where the cover simply admits more jobs per frame instead of longer ones.
 */
export const WORLD_JOB_SLICE_MS = 1;

/**
 * A job past its deadline by more than this is reported (DEV only). The scheduler can
 * not pre-empt: a job's last step always finishes, so a sliver of overrun is the cost of
 * checking the clock between steps rather than inside them.
 */
const OVERRUN_REPORT_MS = 0.5;

/**
 * Shared, frame-scoped main-thread budget for world-streaming work.
 *
 * Streamers may be called several times from fixed updates before one render. The
 * caller supplies that render's stable `frameId`; `beginFrame` resets the budget
 * only when that id changes.
 *
 * THE CONTRACT. `tryRun` admits a job while the rendered frame still has budget and a
 * job slot, and hands it a DEADLINE: an absolute `performance.now()` time at most
 * `WORLD_JOB_SLICE_MS` after the job starts, and never past what remains of the frame
 * budget. Admission is the only thing the scheduler itself can enforce — JavaScript
 * cannot pre-empt — so the deadline is what bounds a job, and every job MUST be one of:
 *
 *  - RESUMABLE: it does at least one bounded step, keeps stepping while the clock is
 *    before the deadline, and leaves its cursor where a later job resumes it (chunk
 *    provider generators, desert tile collider stages);
 *  - ONE BOUNDED STAGE: a unit whose whole cost is known to fit a slice (one collider
 *    slab, one tile attach), split into more stages the moment it stops fitting.
 *
 * Work that does not fit is staged, never handed a larger budget. A job that still
 * outruns its deadline is reported in DEV (`[perf] streaming ... over=`), naming it.
 */
export class WorldWorkScheduler {
  private readonly pendingOwners = new Set<string>();
  private activeFrame = Number.NaN;
  private worked = false;
  private workMs = 0;
  private jobsRun = 0;
  private lastTag: string | null = null;
  private frameWorstMs = 0;
  private frameWorstTag: string | null = null;
  private frameOverrunMs = 0;
  private frameOverrunTag: string | null = null;

  constructor(
    private budgetMs = 3,
    private maxJobsPerFrame = Number.POSITIVE_INFINITY,
  ) {}

  /**
   * Widens or restores the per-frame admission.
   *
   * Play wants one small job per rendered frame; boot wants the whole live window
   * built before the loading cover leaves, and the frame it spends doing that is
   * never seen. The admission is therefore a property of the phase rather than of the
   * scheduler's construction. The per-job slice is not: boot gets more jobs, each
   * still bounded by `WORLD_JOB_SLICE_MS`.
   */
  setFrameBudget(budgetMs: number, maxJobsPerFrame: number): void {
    this.budgetMs = budgetMs;
    this.maxJobsPerFrame = maxJobsPerFrame;
  }

  beginFrame(frameId: number): void {
    if (frameId === this.activeFrame) return;
    if (import.meta.env?.DEV && Number.isFinite(this.activeFrame) && this.frameWorstMs > 0) {
      const over =
        this.frameOverrunMs > OVERRUN_REPORT_MS
          ? ` over=${this.frameOverrunMs.toFixed(2)}ms by=${this.frameOverrunTag ?? 'none'}`
          : '';
      console.debug(
        `[perf] streaming frame=${this.activeFrame} work=${this.workMs.toFixed(2)}ms ` +
        `worst=${this.frameWorstMs.toFixed(2)}ms job=${this.frameWorstTag ?? 'none'}${over}`,
      );
    }
    this.activeFrame = frameId;
    this.worked = false;
    this.workMs = 0;
    this.jobsRun = 0;
    this.lastTag = null;
    this.frameWorstMs = 0;
    this.frameWorstTag = null;
    this.frameOverrunMs = 0;
    this.frameOverrunTag = null;
  }

  /**
   * Runs `work` now if this frame still admits a job; false when it does not.
   *
   * `work` receives its deadline (see the class contract) and must return by it.
   */
  tryRun(frameId: number, tag: string, work: (deadline: number) => void): boolean {
    this.beginFrame(frameId);
    if (this.workMs >= this.budgetMs || this.jobsRun >= this.maxJobsPerFrame) return false;

    const started = performance.now();
    const granted = Math.min(WORLD_JOB_SLICE_MS, this.budgetMs - this.workMs);
    this.worked = true;
    this.jobsRun++;
    this.lastTag = tag;
    try {
      work(started + granted);
    } finally {
      const elapsed = performance.now() - started;
      this.workMs += elapsed;
      if (elapsed > this.frameWorstMs) {
        this.frameWorstMs = elapsed;
        this.frameWorstTag = tag;
      }
      const overrun = elapsed - granted;
      if (overrun > this.frameOverrunMs) {
        this.frameOverrunMs = overrun;
        this.frameOverrunTag = tag;
      }
    }
    return true;
  }

  setPending(owner: string, pending: boolean): void {
    if (pending) this.pendingOwners.add(owner);
    else this.pendingOwners.delete(owner);
  }

  get workedThisFrame(): boolean {
    return this.worked;
  }

  get frameWorkMs(): number {
    return this.workMs;
  }

  get hasPending(): boolean {
    return this.pendingOwners.size > 0;
  }

  get lastJobTag(): string | null {
    return this.lastTag;
  }
}
