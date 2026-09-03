/**
 * Shared, frame-scoped main-thread budget for indivisible world-streaming jobs.
 *
 * Streamers may be called several times from fixed updates before one render. The
 * caller supplies that render's stable `frameId`; `beginFrame` resets the budget
 * only when that id changes.
 */
export class WorldWorkScheduler {
  private readonly pendingOwners = new Set<string>();
  private activeFrame = Number.NaN;
  private worked = false;
  private workMs = 0;
  private jobsRun = 0;
  private lastTag: string | null = null;

  constructor(
    private readonly budgetMs = 3,
    private readonly maxJobsPerFrame = Number.POSITIVE_INFINITY,
  ) {}

  beginFrame(frameId: number): void {
    if (frameId === this.activeFrame) return;
    this.activeFrame = frameId;
    this.worked = false;
    this.workMs = 0;
    this.jobsRun = 0;
    this.lastTag = null;
  }

  tryRun(frameId: number, tag: string, work: () => void): boolean {
    this.beginFrame(frameId);
    if (this.workMs >= this.budgetMs || this.jobsRun >= this.maxJobsPerFrame) return false;

    const started = performance.now();
    this.worked = true;
    this.jobsRun++;
    this.lastTag = tag;
    try {
      work();
    } finally {
      this.workMs += performance.now() - started;
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
