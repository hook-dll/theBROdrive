/**
 * The controls tutorial: one set of lessons (lessons.ts), three ways to present them,
 * picked in the dev menu while they are being tried out:
 *
 *  - `whisper`  — just-in-time single-line hints that thank and leave (whisper.ts);
 *  - `notebook` — a corner card of things to try, crossed out by play (notebook.ts);
 *  - `manual`   — an owner's handbook opened with H, the game standing still (manual.ts).
 *
 * Off (the default) it costs main.ts one early return per frame. Progress, the variant
 * and the pages read live in localStorage under their own key, nowhere in the save.
 */
import type { FoleyEvent } from '../../audio/foley';
import { LessonTracker, loadProgress, saveProgress, type TutorialFrame, type TutorialVariant } from './lessons';
import type { KeyCodes } from './glyphs';
import { Manual } from './manual';
import { Notebook } from './notebook';
import { Whisper } from './whisper';

export type { TutorialFrame, TutorialVariant } from './lessons';
export { emptyTutorialFrame } from './lessons';

export class Tutorial {
  private readonly progress = loadProgress();
  private tracker = new LessonTracker(this.progress.done);
  private readonly read = new Set<string>(this.progress.read);
  private readonly layer: HTMLElement;
  private presenter: Whisper | Notebook | Manual | null = null;

  constructor(
    uiRoot: HTMLElement,
    private readonly keys: KeyCodes,
    private readonly toast: (text: string) => void,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'tut-layer';
    uiRoot.append(this.layer);
    this.tracker.onDone = () => this.save();
    if (this.progress.variant !== null) this.build(this.progress.variant);
  }

  get variant(): TutorialVariant | null {
    return this.progress.variant;
  }

  get active(): boolean {
    return this.presenter !== null;
  }

  /** Starts a variant from the beginning: every lesson untried, every page unread. */
  start(variant: TutorialVariant): void {
    this.progress.done = [];
    this.read.clear();
    this.tracker = new LessonTracker([]);
    this.tracker.onDone = () => this.save();
    this.progress.variant = variant;
    this.build(variant);
    this.save();
  }

  stop(): void {
    this.presenter?.dispose();
    this.presenter = null;
    this.progress.variant = null;
    this.save();
  }

  /** The fixed step's interaction result: a panel's latch, a pour. */
  noteTick(sound: FoleyEvent | null, pouring: boolean): void {
    if (this.presenter !== null) this.tracker.noteTick(sound, pouring);
  }

  frame(f: TutorialFrame): void {
    const presenter = this.presenter;
    if (presenter === null) return;
    this.tracker.update(f);
    presenter.update(f, this.tracker);
  }

  /**
   * H, with the game running. True when main.ts should stand the game still and open
   * the manual (`openManual`); the other variants answer it themselves.
   */
  pressHelp(): boolean {
    const presenter = this.presenter;
    if (presenter instanceof Manual) return true;
    if (presenter instanceof Notebook) presenter.toggleFold();
    else if (presenter instanceof Whisper) this.toast(presenter.toggleHush());
    return false;
  }

  /** Opens the manual; resolves when the player shuts it. */
  openManual(): Promise<void> {
    return this.presenter instanceof Manual ? this.presenter.open() : Promise.resolve();
  }

  private build(variant: TutorialVariant): void {
    this.presenter?.dispose();
    this.presenter =
      variant === 'whisper'
        ? new Whisper(this.layer, this.keys)
        : variant === 'notebook'
          ? new Notebook(this.layer, this.keys)
          : new Manual(this.layer, this.keys, this.read, () => this.save());
  }

  private save(): void {
    this.progress.done = [...this.tracker.done];
    this.progress.read = [...this.read];
    saveProgress(this.progress);
  }
}
