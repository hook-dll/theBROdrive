/**
 * THE WHISPERS: the controls tutorial on screen, in three quiet places.
 *
 *  - The first steps: the movement keys, the arrows and the mouse, no words, low on the
 *    screen while a player who has just appeared on foot finds his feet.
 *  - The aim: the F key beside the crosshair while it rests on something F works that has
 *    not been used yet (a door, the bonnet, a seat...). It comes in once the aim settles
 *    and goes the moment the aim leaves or the thing is used.
 *  - The line: one short whisper where it helps, after the player has had time to find it
 *    alone. Ignored, it steps back: each lesson waits longer to come again and gives up
 *    after three tries. Never two lines at once, and a pause between any two.
 *
 * Every piece fades in and out; nothing ticks, flashes or asks to be dismissed. H hushes
 * the lines and the first steps (not the aim's F, which is only ever where it is looked at).
 */
import { LESSONS, WALK, aimLesson, type AimKind, type Lesson, type LessonTracker, type TutorialFrame } from './lessons';
import { keycap, mouseGlyph, writeHint, type KeyCodes } from './glyphs';

/** Seconds of nothing between one line leaving and the next arriving. */
const QUIET_AFTER_DONE_S = 3.5;
const QUIET_AFTER_IGNORED_S = 8;
/** Seconds a line stays after its context is gone, so a glance away does not end it. */
const GRACE_S = 1.6;
/** A lesson's dwell grows each time it went unanswered; past the last it is not shown again. */
const BACKOFF = [1, 2.5, 6] as const;
/** Seconds on foot before the first steps come in. */
const WALK_DELAY_S = 1.2;
/** Seconds the aim must rest on a thing before its F comes in: a sweep past shows nothing. */
const AIM_SETTLE_S = 0.25;
/** Seconds the aim may leave before its F goes: a wobble does not blink it. */
const AIM_LEAVE_S = 0.15;

/** One element that fades in and out (`.is-shown`), its content swapped only while hidden. */
class Fader {
  readonly el: HTMLElement;
  private key: string | null = null;
  private pending: string | null = null;
  private timer = 0;

  constructor(parent: HTMLElement, className: string) {
    this.el = document.createElement('div');
    this.el.className = className;
    parent.append(this.el);
  }

  get showing(): string | null {
    return this.pending ?? this.key;
  }

  show(key: string, fill: (el: HTMLElement) => void): void {
    if (this.showing === key) return;
    window.clearTimeout(this.timer);
    this.pending = key;
    const swap = (): void => {
      this.key = key;
      this.pending = null;
      fill(this.el);
      // One frame at opacity 0 so the fade runs from it.
      requestAnimationFrame(() => {
        if (this.key === key && this.pending === null) this.el.classList.add('is-shown');
      });
    };
    if (this.key !== null && this.el.classList.contains('is-shown')) {
      this.el.classList.remove('is-shown');
      this.timer = window.setTimeout(swap, 350);
    } else {
      swap();
    }
  }

  hide(): void {
    if (this.showing === null) return;
    window.clearTimeout(this.timer);
    this.pending = null;
    this.key = null;
    this.el.classList.remove('is-shown');
  }
}

export class Whisper {
  private readonly root: HTMLElement;
  private readonly first: Fader;
  private readonly line: Fader;
  private readonly aim: Fader;
  private current: Lesson | null = null;
  private clock = 0;
  private quietS = 1.5;
  private readonly tries = new Map<string, number>();
  private hushed = false;
  private footS = 0;
  private aimKind: AimKind | null = null;
  private aimS = 0;
  private aimAwayS = 0;

  constructor(parent: HTMLElement, private readonly keys: KeyCodes) {
    this.root = document.createElement('div');
    this.root.className = 'tut-whisper';
    parent.append(this.root);
    this.first = new Fader(this.root, 'tut-first');
    this.line = new Fader(this.root, 'tut-line');
    this.aim = new Fader(this.root, 'tut-aim');
  }

  /** H: hush or bring back. Returns the toast to say so. */
  toggleHush(): string {
    this.hushed = !this.hushed;
    return this.hushed ? 'hints hushed — H to bring them back' : 'hints back on';
  }

  update(f: TutorialFrame, tracker: LessonTracker): void {
    // Fast, a hint is a glance: it fades to a ghost above 60 km/h.
    this.root.style.setProperty('--tut-dim', String(f.speedKmh > 60 ? 0.45 : f.speedKmh > 30 ? 0.7 : 1));
    this.updateAim(f, tracker);
    const firstSteps = this.updateFirst(f, tracker);
    this.updateLine(f, tracker, firstSteps);
  }

  private updateFirst(f: TutorialFrame, tracker: LessonTracker): boolean {
    this.footS = f.seated || f.blocked ? 0 : this.footS + f.dt;
    const want = !tracker.done.has(WALK) && !this.hushed && this.footS > WALK_DELAY_S;
    if (want) {
      this.first.show(WALK, (el) => {
        writeHint(el, '{wasd}', this.keys);
        const or = document.createElement('span');
        or.className = 'tut-or';
        el.append(or);
        writeHint(or, '{arrows}', this.keys);
        el.append(mouseGlyph('mouse'));
      });
    } else {
      this.first.hide();
    }
    return want;
  }

  private updateAim(f: TutorialFrame, tracker: LessonTracker): void {
    const kind = f.blocked || f.aim === null || tracker.done.has(aimLesson(f.aim)) ? null : f.aim;
    if (kind !== null && kind === this.aimKind) {
      this.aimS += f.dt;
      this.aimAwayS = 0;
    } else if (kind !== null) {
      this.aimKind = kind;
      this.aimS = f.dt;
      this.aimAwayS = 0;
    } else {
      this.aimAwayS += f.dt;
    }
    const used = this.aimKind !== null && tracker.done.has(aimLesson(this.aimKind));
    if (used || (kind === null && this.aimAwayS >= AIM_LEAVE_S)) {
      this.aimKind = null;
      this.aimS = 0;
      this.aim.hide();
      return;
    }
    if (this.aimKind !== null && this.aimS >= AIM_SETTLE_S) {
      const shown = this.aimKind;
      this.aim.show(shown, (el) => {
        el.replaceChildren(keycap(this.keys('interact')[0] ?? 'KeyF'));
        // The mirror turns with F held and the mouse moved.
        if (shown === 'mirror') el.append(mouseGlyph('mouse'));
      });
    }
  }

  private updateLine(f: TutorialFrame, tracker: LessonTracker, firstSteps: boolean): void {
    const lesson = this.current;
    if (lesson !== null) {
      this.clock -= f.dt;
      if (tracker.done.has(lesson.id)) return this.leave(QUIET_AFTER_DONE_S);
      const urgent = this.urgent(tracker);
      if (urgent !== null && !f.blocked && !this.hushed) return this.say(urgent);
      if (f.blocked || this.hushed || firstSteps) return this.leave(QUIET_AFTER_IGNORED_S);
      if (lesson.when(f, tracker.signals)) this.clock = GRACE_S;
      else if (this.clock <= 0) this.leave(QUIET_AFTER_IGNORED_S);
      return;
    }
    if (f.blocked || this.hushed || firstSteps) return;
    this.quietS -= f.dt;
    if (this.quietS > 0) return;
    const next = this.pick(f, tracker);
    if (next !== null) this.say(next);
  }

  private say(lesson: Lesson): void {
    this.current = lesson;
    this.clock = GRACE_S;
    this.tries.set(lesson.id, (this.tries.get(lesson.id) ?? 0) + 1);
    this.line.show(lesson.id, (el) => writeHint(el, lesson.hint, this.keys));
  }

  /** An urgent lesson whose moment is now, not yet said this session. */
  private urgent(tracker: LessonTracker): Lesson | null {
    for (const lesson of LESSONS) {
      if (lesson.urgent && !tracker.done.has(lesson.id) && !this.tries.has(lesson.id) && tracker.held(lesson.id) >= lesson.dwell) {
        return lesson;
      }
    }
    return null;
  }

  private pick(f: TutorialFrame, tracker: LessonTracker): Lesson | null {
    for (const lesson of LESSONS) {
      if (tracker.done.has(lesson.id)) continue;
      if (lesson.applies && !lesson.applies(f)) continue;
      const factor = BACKOFF[this.tries.get(lesson.id) ?? 0];
      if (factor === undefined) continue;
      if (tracker.held(lesson.id) >= lesson.dwell * factor) return lesson;
    }
    return null;
  }

  private leave(quiet: number): void {
    this.current = null;
    this.quietS = quiet;
    this.line.hide();
  }

  dispose(): void {
    this.root.remove();
  }
}
