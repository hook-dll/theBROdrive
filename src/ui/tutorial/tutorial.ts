/**
 * The controls tutorial: the lessons (lessons.ts) whispered on screen (whisper.ts).
 * Switched on from the dev menu while it is being tried out.
 *
 * Off (the default) it costs main.ts one early return per frame. Whether it is on and
 * what has been learnt live in localStorage under their own key, nowhere in the save.
 */
import type { FoleyEvent } from '../../audio/foley';
import { LessonTracker, aimKindOf, loadProgress, saveProgress, type TutorialFrame } from './lessons';
import type { KeyCodes } from './glyphs';
import { Whisper } from './whisper';

export type { TutorialFrame } from './lessons';
export { aimKindOf, emptyTutorialFrame } from './lessons';

export class Tutorial {
  private readonly progress = loadProgress();
  private tracker = new LessonTracker(this.progress.done);
  private readonly layer: HTMLElement;
  private whisper: Whisper | null = null;

  constructor(
    uiRoot: HTMLElement,
    private readonly keys: KeyCodes,
    private readonly toast: (text: string) => void,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'tut-layer';
    uiRoot.append(this.layer);
    this.tracker.onDone = () => this.save();
    if (this.progress.on) this.whisper = new Whisper(this.layer, this.keys);
  }

  get active(): boolean {
    return this.whisper !== null;
  }

  /** Starts from the beginning: every lesson unlearnt. */
  start(): void {
    this.whisper?.dispose();
    this.tracker = new LessonTracker([]);
    this.tracker.onDone = () => this.save();
    this.whisper = new Whisper(this.layer, this.keys);
    this.progress.on = true;
    this.save();
  }

  stop(): void {
    this.whisper?.dispose();
    this.whisper = null;
    this.progress.on = false;
    this.save();
  }

  /** The fixed step's interaction: its sound, a pour, and F at an aimed kit thing (`Interaction.aimId`). */
  noteTick(sound: FoleyEvent | null, pouring: boolean, aimId: string | null, pressed: boolean): void {
    if (this.whisper !== null) this.tracker.noteTick(sound, pouring, aimKindOf(aimId), pressed);
  }

  frame(f: TutorialFrame): void {
    if (this.whisper === null) return;
    this.tracker.update(f);
    this.whisper.update(f, this.tracker);
  }

  /** H, with the game running: hush the whispers or bring them back. */
  pressHelp(): void {
    if (this.whisper !== null) this.toast(this.whisper.toggleHush());
  }

  private save(): void {
    this.progress.done = [...this.tracker.done];
    saveProgress(this.progress);
  }
}
