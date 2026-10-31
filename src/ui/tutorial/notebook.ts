/**
 * VARIANT B, THE NOTEBOOK: a small paper card in the top-left corner with a few things
 * to try in the situation the player is in (on foot, at the wheel, on the road). Each is
 * crossed out in ink the moment he does it, however he found it. The line he is closest
 * to (its context holds) carries the keys under it. Nothing is required, nothing is
 * in order, nothing interrupts: the card is a list, not a gate. H folds it to a tab;
 * at speed it fades back so the road stays the picture.
 *
 * After Untitled Goose Game's to-do list and Pacific Drive's checklist: goals that name
 * the verbs, ticked by play.
 */
import {
  CHAPTER_TITLE, LESSONS, chapterNow, type Chapter, type Lesson, type LessonTracker, type TutorialFrame,
} from './lessons';
import { writeHint, type KeyCodes } from './glyphs';

/** Seconds a new situation must hold before the card turns to its chapter. */
const TURN_S = 1.5;
/** Seconds a finished chapter's card stays open before folding itself. */
const FINISHED_FOLD_S = 5;
/** Seconds a line's context must hold before its keys are shown under it. */
const NEAR_S = 1;
/** Seconds a shown hint stays after its context lapses. */
const LINGER_S = 2;

export class Notebook {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly how: HTMLElement;
  private readonly foot: HTMLElement;
  private chapter: Chapter | null = null;
  private wanted: Chapter | null = null;
  private wantedS = 0;
  private items: { lesson: Lesson; li: HTMLElement; done: boolean }[] = [];
  private next: Lesson | null = null;
  private lingerS = 0;
  private userFolded = false;
  private finishedS = 0;

  constructor(parent: HTMLElement, private readonly keys: KeyCodes) {
    this.root = document.createElement('div');
    this.root.className = 'tut-note';
    const head = document.createElement('div');
    head.className = 'tut-note-head';
    this.title = document.createElement('span');
    this.title.className = 'tut-note-title';
    this.count = document.createElement('span');
    this.count.className = 'tut-note-count';
    head.append(this.title, this.count);
    this.list = document.createElement('ul');
    this.list.className = 'tut-note-list';
    this.how = document.createElement('div');
    this.how.className = 'tut-note-how';
    this.foot = document.createElement('div');
    this.foot.className = 'tut-note-foot';
    writeHint(this.foot, '{fold} fold', (a) => (a === 'fold' ? ['KeyH'] : keys(a)));
    this.root.append(head, this.list, this.how, this.foot);
    parent.append(this.root);
    requestAnimationFrame(() => this.root.classList.add('is-shown'));
  }

  /** H: fold to the tab or open again. */
  toggleFold(): void {
    this.userFolded = !this.userFolded;
    this.finishedS = 0;
    this.root.classList.toggle('is-folded', this.userFolded);
  }

  update(f: TutorialFrame, tracker: LessonTracker): void {
    this.root.classList.toggle('is-blocked', f.blocked);
    this.root.classList.toggle('is-faded', f.speedKmh > 40);
    const now = chapterNow(f);
    if (now !== this.wanted) {
      this.wanted = now;
      this.wantedS = 0;
    }
    this.wantedS += f.dt;
    if (this.chapter === null || (now !== this.chapter && this.wantedS >= TURN_S)) this.turnTo(now, f);

    let left = 0;
    for (const item of this.items) {
      const done = tracker.done.has(item.lesson.id);
      if (done !== item.done) {
        item.done = done;
        item.li.classList.add('is-done', 'is-fresh');
      }
      if (!done) left++;
    }
    this.count.textContent = `${this.items.length - left}/${this.items.length}`;

    // The line he is nearest to: the first whose context has held a moment. None near,
    // no hint: the list alone is enough, and a hint about something else is noise.
    let near: Lesson | null = null;
    for (const item of this.items) {
      if (!item.done && tracker.held(item.lesson.id) >= NEAR_S) {
        near = item.lesson;
        break;
      }
    }
    // A line keeps its hint a little after its context lapses, so a boundary does not flicker it.
    if (near === null && this.next !== null && !tracker.done.has(this.next.id) && this.lingerS > 0) {
      this.lingerS -= f.dt;
      near = this.next;
    } else if (near !== null) {
      this.lingerS = LINGER_S;
    }
    if (near !== this.next || (left === 0) !== this.root.classList.contains('is-complete')) {
      this.next = near;
      for (const item of this.items) item.li.classList.toggle('is-next', item.lesson === near);
      if (near) writeHint(this.how, near.hint, this.keys);
      else if (left === 0) this.how.textContent = 'All done here.';
      this.root.classList.toggle('is-complete', left === 0);
      this.root.classList.toggle('has-how', near !== null || left === 0);
    }
    this.root.classList.toggle('is-ready', this.next?.interact === true && f.actionable);

    if (left === 0 && !this.userFolded) {
      this.finishedS += f.dt;
      this.root.classList.toggle('is-folded', this.finishedS > FINISHED_FOLD_S);
    }
  }

  private turnTo(chapter: Chapter, f: TutorialFrame): void {
    this.chapter = chapter;
    this.finishedS = 0;
    this.next = null;
    this.lingerS = 0;
    this.root.classList.remove('has-how', 'is-complete', 'is-ready');
    this.title.textContent = CHAPTER_TITLE[chapter];
    this.items = [];
    const nodes: HTMLElement[] = [];
    for (const lesson of LESSONS) {
      if (lesson.chapter !== chapter) continue;
      if (lesson.applies && !lesson.applies(f)) continue;
      const li = document.createElement('li');
      li.className = 'tut-note-item';
      const box = document.createElement('span');
      box.className = 'tut-note-box';
      const text = document.createElement('span');
      text.className = 'tut-note-text';
      text.textContent = lesson.title;
      li.append(box, text);
      nodes.push(li);
      // Marked done on the next update, without the fresh stroke: done before this card.
      this.items.push({ lesson, li, done: false });
    }
    this.list.replaceChildren(...nodes);
    this.root.classList.toggle('is-folded', this.userFolded);
    // Lines already done are drawn crossed at once; only new strokes animate.
    this.root.classList.add('is-turning');
    requestAnimationFrame(() => {
      for (const item of this.items) item.li.classList.remove('is-fresh');
      this.root.classList.remove('is-turning');
    });
  }

  dispose(): void {
    this.root.remove();
  }
}
