/**
 * AUTO-RESUME ACROSS A PAGE RELOAD.
 *
 * A phone that is left to drive itself goes to sleep, and a sleeping tab is a tab
 * Chrome may discard; a discarded tab that is restored comes back as a fresh document,
 * which means booting into the title screen and losing the drive. The same reload
 * arrives from anything else that replaces the document — a crash, or the development
 * server's own client reloading the page when its socket comes back.
 *
 * Autosave already writes the state to IndexedDB, so the drive is not LOST. What is
 * missing is knowing it was mid-drive: nothing in a save says "the player was sitting in
 * this car when the document died", and the title screen has no way to tell a deliberate
 * quit from an interrupted one. So this holds the one bit that makes the distinction, and
 * nothing else.
 *
 * SESSION STORAGE, NOT LOCAL. Its lifetime is exactly the lifetime of the question:
 * a marker surviving the tab's closing would resume a drive the player deliberately
 * ended, and a marker in local storage would outlive the browser session entirely. It
 * does survive a reload and a discard-restore, which is the whole requirement.
 *
 * THE ATTEMPT BUDGET IS THE POINT OF THE POLICY, not a safety afterthought. A reload
 * that resumes into a world that immediately reloads again is an unbreakable loop the
 * player cannot escape, because the title screen — the one place with a way out — is
 * exactly what resuming skips. So each resume spends one of a small number of attempts,
 * and a session that survives long enough to prove it is working hands them all back.
 */
const STORAGE_KEY = 'thebrodrive.resume';

/**
 * Consecutive resumes allowed before the title screen is shown instead.
 *
 * Two, not one: a single sleep-and-wake reload is the ordinary case this exists for, and
 * a phone that is picked up twice in a row must not be handed a menu on the second time.
 * The third reload without a healthy session in between is a loop, and the menu is the
 * way out of it.
 */
export const RESUME_ATTEMPT_LIMIT = 2;

/** A resumed session that survives this long is working; see `confirmResumeHealthy`. */
export const RESUME_HEALTHY_SECONDS = 20;

interface ResumeMarker {
  /** Save slot to resume, as `IndexedDbSaves` names it (`slot-<seed>`). */
  readonly slotId: string;
  /** Resumes spent since the last healthy session, against `RESUME_ATTEMPT_LIMIT`. */
  readonly attempts: number;
}

/**
 * Session storage, or null where it is unavailable.
 *
 * A browser with storage disabled or a full quota throws on access rather than merely
 * returning null, and every caller here is on a path where failing to remember is
 * survivable — the worst case is the title screen the player would have seen before this
 * module existed. So it degrades to "no marker" instead of propagating.
 */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function read(): ResumeMarker | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<ResumeMarker>;
    if (typeof candidate.slotId !== 'string' || candidate.slotId.length === 0) return null;
    if (typeof candidate.attempts !== 'number' || !Number.isFinite(candidate.attempts)) return null;
    return { slotId: candidate.slotId, attempts: candidate.attempts };
  } catch {
    // Unparseable or unreadable is the same answer as absent.
    return null;
  }
}

function write(marker: ResumeMarker | null): void {
  const store = storage();
  if (!store) return;
  try {
    if (marker === null) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // See `storage`: remembering is best-effort by design.
  }
}

/**
 * Records that a drive is in progress in `slotId`, and may be resumed after a reload.
 *
 * Called from the one place an autosave is booked, so the marker can never name a slot
 * the autosave does not write. `attempts` is carried over rather than reset: this runs
 * again on every later autosave, and clearing the budget there would let a world that
 * reloads a few seconds after each of them loop forever.
 */
export function markResumeTarget(slotId: string): void {
  const existing = read();
  write({ slotId, attempts: existing?.attempts ?? 0 });
}

/**
 * Takes the pending resume, if there is one and its budget allows.
 *
 * The attempt is spent HERE, before the slot is even looked up, because the failure this
 * bounds is a crash during the boot that follows — a crash that never reaches a caller who
 * could spend it afterwards.
 */
export function claimResumeSlot(): string | null {
  const marker = read();
  if (!marker) return null;
  if (marker.attempts >= RESUME_ATTEMPT_LIMIT) {
    write(null);
    return null;
  }
  write({ slotId: marker.slotId, attempts: marker.attempts + 1 });
  return marker.slotId;
}

/** Drops the pending resume: the drive ended on purpose, or could not be restored. */
export function clearResumeSlot(): void {
  write(null);
}

/**
 * Hands the attempt budget back: the resumed session has run long enough without
 * reloading to be worth resuming again.
 */
export function confirmResumeHealthy(): void {
  const marker = read();
  if (marker && marker.attempts !== 0) write({ slotId: marker.slotId, attempts: 0 });
}
