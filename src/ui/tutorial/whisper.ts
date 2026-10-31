/**
 * VARIANT A, THE WHISPER: one quiet line low on the screen, only where it helps and only
 * after the player has had time to find it alone (`Lesson.dwell`). It fades in slowly,
 * lights its F key when the crosshair is on the thing, thanks the player with a tick
 * when he does it, and fades out. Ignored, it steps back: each lesson waits longer to
 * come again and gives up after three tries. Never two at once, and a pause between
 * any two. H hushes them all.
 *
 * After the "just in time" prompts of Half-Life 2 and God of War: text only at the
 * moment of need, gone the moment the thing is done.
 */
import { LESSONS, type Lesson, type LessonTracker, type TutorialFrame } from './lessons';
import { writeHint, type KeyCodes } from './glyphs';

/** Seconds of nothing between one whisper leaving and the next arriving. */
const QUIET_AFTER_DONE_S = 3.5;
const QUIET_AFTER_IGNORED_S = 8;
/** Seconds a whisper stays after its context is gone, so a glance away does not end it. */
const GRACE_S = 1.6;
/** Seconds the tick stays on a done lesson. */
const THANKS_S = 1.5;
/** A lesson's dwell grows each time it went unanswered; past the last it is not whispered again. */
const BACKOFF = [1, 2.5, 6] as const;
/** The CSS fade-out, before the line is emptied. */
const LEAVE_S = 0.9;

export class Whisper {
  readonly root: HTMLElement;
  private readonly line: HTMLElement;
  private current: Lesson | null = null;
  private phase: 'idle' | 'shown' | 'thanks' | 'leaving' = 'idle';
  private clock = 0;
  private quietS = 1.5;
  private readonly tries = new Map<string, number>();
  private hushed = false;

  constructor(parent: HTMLElement, private readonly keys: KeyCodes) {
    this.root = document.createElement('div');
    this.root.className = 'tut-whisper';
    this.line = document.createElement('div');
    this.line.className = 'tut-whisper-line';
    this.root.append(this.line);
    parent.append(this.root);
  }

  /** H: hush or bring back. Returns the toast to say so. */
  toggleHush(): string {
    this.hushed = !this.hushed;
    return this.hushed ? 'hints hushed — H to bring them back' : 'hints back on';
  }

  update(f: TutorialFrame, tracker: LessonTracker): void {
    const dt = f.dt;
    // Fast, a hint is a glance: it fades to a ghost above 60 km/h.
    const dim = f.speedKmh > 60 ? 0.45 : f.speedKmh > 30 ? 0.7 : 1;
    this.root.style.setProperty('--tut-dim', String(dim));
    const lesson = this.current;
    if (lesson !== null) {
      this.clock -= dt;
      if (this.phase === 'leaving') {
        if (this.clock <= 0) this.clear();
        return;
      }
      if (f.blocked || this.hushed) {
        this.leave(QUIET_AFTER_IGNORED_S);
        return;
      }
      if (this.phase === 'shown' && tracker.done.has(lesson.id)) {
        this.phase = 'thanks';
        this.clock = THANKS_S;
        this.root.classList.add('is-done');
        return;
      }
      if (this.phase === 'thanks') {
        if (this.clock <= 0) this.leave(QUIET_AFTER_DONE_S);
        return;
      }
      if (lesson.when(f, tracker.signals)) this.clock = GRACE_S;
      else if (this.clock <= 0) {
        this.leave(QUIET_AFTER_IGNORED_S);
        return;
      }
      this.root.classList.toggle('is-ready', lesson.interact === true && f.actionable);
      return;
    }
    if (f.blocked || this.hushed) return;
    this.quietS -= dt;
    if (this.quietS > 0) return;
    const next = this.pick(f, tracker);
    if (next !== null) this.show(next);
  }

  private pick(f: TutorialFrame, tracker: LessonTracker): Lesson | null {
    for (const lesson of LESSONS) {
      if (tracker.done.has(lesson.id)) continue;
      if (lesson.applies && !lesson.applies(f)) continue;
      const tries = this.tries.get(lesson.id) ?? 0;
      const factor = BACKOFF[tries];
      if (factor === undefined) continue;
      if (tracker.held(lesson.id) >= lesson.dwell * factor) return lesson;
    }
    return null;
  }

  private show(lesson: Lesson): void {
    this.current = lesson;
    this.phase = 'shown';
    this.clock = GRACE_S;
    this.tries.set(lesson.id, (this.tries.get(lesson.id) ?? 0) + 1);
    writeHint(this.line, lesson.hint, this.keys);
    this.root.classList.remove('is-done', 'is-ready');
    // One frame shown at opacity 0 so the fade-in runs from it.
    requestAnimationFrame(() => {
      if (this.current === lesson && this.phase === 'shown') this.root.classList.add('is-shown');
    });
  }

  private leave(quiet: number): void {
    this.phase = 'leaving';
    this.clock = LEAVE_S;
    this.quietS = quiet;
    this.root.classList.remove('is-shown', 'is-ready');
  }

  private clear(): void {
    this.current = null;
    this.phase = 'idle';
    this.root.classList.remove('is-done');
    this.line.replaceChildren();
  }

  dispose(): void {
    this.root.remove();
  }
}
