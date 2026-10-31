/**
 * VARIANT C, THE OWNER'S MANUAL: a little booklet the player opens himself with H. The
 * game stands still while it is open. Each page is one subject drawn the way a car's
 * handbook draws it: the keyboard with the keys lit, the car from above with its panels
 * named, the mouse, the pedal lever. Nothing is pushed: when the player stands where a
 * page would help (a lesson's context held past its dwell) and has not read it, the
 * bookmark in the corner glows once, and H opens on that page.
 *
 * After Tunic's in-game manual and the glovebox handbook of a real car: the help is an
 * object in the world's own voice, there when wanted, silent otherwise.
 */
import { LESSONS, type LessonTracker, type PageId, type TutorialFrame } from './lessons';
import { carDiagram, keyboardDiagram, leverDiagram, mouseGlyph, writeHint, type KeyCodes } from './glyphs';

interface Page {
  readonly id: PageId;
  readonly title: string;
  readonly art: (keys: KeyCodes) => Element;
  readonly rows: readonly string[];
}

const mouseArt = (): Element => {
  const box = document.createElement('div');
  box.className = 'tut-mouse-art';
  for (const [kind, word] of [['mouse', 'steer'], ['lmb', 'gas'], ['rmb', 'brake'], ['mmb', 'look']] as const) {
    const cell = document.createElement('figure');
    const caption = document.createElement('figcaption');
    caption.textContent = word;
    cell.append(mouseGlyph(kind), caption);
    box.append(cell);
  }
  return box;
};

const fluidsArt = (): Element => {
  const box = document.createElement('div');
  box.className = 'tut-fluids-art';
  for (const [name, where] of [['oil', 'engine'], ['water', 'radiator'], ['petrol', 'fuel flap']] as const) {
    const row = document.createElement('div');
    row.className = `tut-fluid is-${name}`;
    const can = document.createElement('span');
    can.className = 'tut-fluid-can';
    const label = document.createElement('span');
    label.innerHTML = `<b>${name}</b> → ${where}`;
    row.append(can, label);
    box.append(row);
  }
  box.append(mouseGlyph('lmb'));
  return box;
};

const PAGES: readonly Page[] = [
  {
    id: 'foot', title: 'On foot',
    art: (keys) => keyboardDiagram(['throttle', 'left', 'brake', 'right', 'sprint', 'jump', 'crouch', 'interact', 'drop'], keys),
    rows: [
      '{wasd} walk · {mouse} look around',
      'hold {sprint} to hurry · {jump} jump · {crouch} crouch',
      '{interact} is the hand: open, take, sit, press — whatever the crosshair is on',
      '{drop} puts down what you hold · {itemPrev} {itemNext} change hands',
    ],
  },
  {
    id: 'car', title: 'Your car, outside',
    art: () => carDiagram(new Set(['bonnet', 'boot', 'doors', 'flap'])),
    rows: [
      'Look at a door, the bonnet, the boot or the fuel flap and press {interact}. Again, and it shuts.',
      'Nothing on a car is labelled: the crosshair lights up on whatever {interact} works.',
      'Get in through an open door: look at a seat, {interact}.',
      'Under the bonnet and in the boot, parts sit in cells: {interact} takes one out or fits the one in your hand.',
    ],
  },
  {
    id: 'fluids', title: 'Oil, water, petrol',
    art: fluidsArt,
    rows: [
      'Lift the bonnet for the engine and the radiator; open the flap for the tank.',
      'With a can in hand, aim at it and hold {lmb} to pour. The line under the crosshair reads the level.',
      'At a pump, {interact} takes the nozzle; hold {lmb} at the open flap. {interact} on the pump hangs it up.',
      'Hold {interact} at a pump to fill the can you carry.',
    ],
  },
  {
    id: 'wheel', title: 'At the wheel',
    art: (keys) => keyboardDiagram(['engine', 'handbrake', 'throttle', 'brake', 'left', 'right', 'shiftUp', 'shiftDown', 'camera', 'recenterCamera'], keys),
    rows: [
      '{engine} starts the engine, and stops it',
      '{handbrake} handbrake on and off — the red P on the display',
      '{throttle} gas · {brake} brake · held at a stop, {brake} backs up',
      '{left} {right} turn the steering wheel; let go and it comes back',
      '{shiftUp} {shiftDown} change gear, with a manual gearbox',
      '{camera} behind the car or in the seat · {recenterCamera} look ahead',
    ],
  },
  {
    id: 'cabin', title: 'Inside the car',
    art: () => carDiagram(new Set(['mirrors', 'doors'])),
    rows: [
      'In the seat view, look at a mirror, hold {interact} and move {mouse}. It stays where you leave it.',
      'Look at another seat and press {interact} to move over. Only the driver\u2019s seat drives.',
      'Switches, stalks, the radio knob, the hazard button: {interact} works them too.',
      'To get out, stop, look out at the road and press {interact}.',
    ],
  },
  {
    id: 'lever', title: 'The pedal lever (cruise)',
    art: leverDiagram,
    rows: [
      'A tap of {throttle} moves the lever up a notch, and it stays: the car cruises on it.',
      'A tap of {brake} drops a notch. Hold {brake} to brake.',
      'Hold {throttle} and it is the plain pedal; let go and the lever is back in neutral.',
      'The scale beside the ball gauge, bottom right, shows where the lever is.',
    ],
  },
  {
    id: 'mouse', title: 'Driving with the mouse',
    art: mouseArt,
    rows: [
      '{mouseDriving} switches mouse driving on and off; the keys still work beside it',
      'Move {mouse} left and right: that is the steering wheel, and it stays where you put it',
      '{lmb} gas · {rmb} brake',
      'Hold {mouseLook} or {mmb} to look around; the wheel keeps its angle',
    ],
  },
  {
    id: 'road', title: 'Lights and helpers',
    art: (keys) => keyboardDiagram(['lights', 'indicatorLeft', 'indicatorRight', 'autopilot', 'radio'], keys),
    rows: [
      '{lights} headlights: dipped, main beam, off',
      '{indicatorLeft} {indicatorRight} the blinkers',
      '{autopilot} autopilot: sleeper, hurried, frantic, off',
      '{radio} the radio: one station, the other, off',
    ],
  },
];

export class Manual {
  /** The corner bookmark: always there, glowing when a page would help now. */
  readonly bookmark: HTMLElement;
  private readonly bookmarkNote: HTMLElement;
  private overlay: HTMLElement | null = null;
  private index = 0;
  /** The page that would help now and has not been read, or null. */
  private wanted: PageId | null = null;
  private closeOpen: (() => void) | null = null;
  private tracker: LessonTracker | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly keys: KeyCodes,
    private readonly read: Set<string>,
    private readonly onRead: () => void,
  ) {
    this.bookmark = document.createElement('div');
    this.bookmark.className = 'tut-bookmark';
    const book = document.createElement('span');
    book.className = 'tut-bookmark-book';
    this.bookmarkNote = document.createElement('span');
    this.bookmarkNote.className = 'tut-bookmark-note';
    writeHint(this.bookmarkNote, '{open} manual', (a) => (a === 'open' ? ['KeyH'] : keys(a)));
    this.bookmark.append(book, this.bookmarkNote);
    parent.append(this.bookmark);
    requestAnimationFrame(() => this.bookmark.classList.add('is-shown'));
  }

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  update(f: TutorialFrame, tracker: LessonTracker): void {
    this.tracker = tracker;
    this.bookmark.classList.toggle('is-blocked', f.blocked);
    this.bookmark.classList.toggle('is-faded', f.speedKmh > 40);
    let wanted: PageId | null = null;
    for (const lesson of LESSONS) {
      if (tracker.done.has(lesson.id) || this.read.has(lesson.page)) continue;
      if (lesson.applies && !lesson.applies(f)) continue;
      if (tracker.held(lesson.id) >= lesson.dwell) {
        wanted = lesson.page;
        break;
      }
    }
    if (wanted !== this.wanted) {
      this.wanted = wanted;
      this.bookmark.classList.toggle('has-news', wanted !== null);
      const title = PAGES.find((p) => p.id === wanted)?.title;
      writeHint(this.bookmarkNote, title ? `{open} a page on: ${title.toLowerCase()}` : '{open} manual', (a) =>
        a === 'open' ? ['KeyH'] : this.keys(a),
      );
    }
  }

  /** Opens the booklet (on the page that would help, if any); resolves when it is shut. */
  open(): Promise<void> {
    if (this.overlay) return Promise.resolve();
    const start = this.wanted ?? PAGES[this.index]?.id ?? 'foot';
    this.index = Math.max(0, PAGES.findIndex((p) => p.id === start));
    const overlay = document.createElement('div');
    overlay.className = 'tut-manual';
    this.overlay = overlay;
    this.parent.append(overlay);
    this.render();
    requestAnimationFrame(() => overlay.classList.add('is-shown'));
    const { promise, resolve } = Promise.withResolvers<void>();
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      if (e.code === 'KeyH' || e.code === 'Escape') close();
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.turn(-1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.turn(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const close = (): void => {
      window.removeEventListener('keydown', onKey, true);
      this.closeOpen = null;
      overlay.classList.remove('is-shown');
      this.overlay = null;
      window.setTimeout(() => overlay.remove(), 400);
      resolve();
    };
    this.closeOpen = close;
    window.addEventListener('keydown', onKey, true);
    return promise;
  }

  private turn(by: number): void {
    const next = Math.min(PAGES.length - 1, Math.max(0, this.index + by));
    if (next === this.index) return;
    this.index = next;
    this.render();
  }

  private render(): void {
    const overlay = this.overlay;
    const page = PAGES[this.index];
    if (!overlay || !page) return;
    if (!this.read.has(page.id)) {
      this.read.add(page.id);
      this.onRead();
    }
    if (this.wanted === page.id) this.wanted = null;
    this.bookmark.classList.remove('has-news');

    const book = document.createElement('div');
    book.className = 'tut-book';

    const tabs = document.createElement('nav');
    tabs.className = 'tut-book-tabs';
    PAGES.forEach((p, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = i === this.index ? 'tut-book-tab is-current' : 'tut-book-tab';
      tab.textContent = p.title;
      tab.addEventListener('click', () => {
        this.index = i;
        this.render();
      });
      tabs.append(tab);
    });

    const sheet = document.createElement('article');
    sheet.className = 'tut-book-page';
    const head = document.createElement('header');
    head.className = 'tut-book-head';
    const folio = document.createElement('span');
    folio.className = 'tut-book-folio';
    folio.textContent = `${this.index + 1}`;
    const title = document.createElement('h2');
    title.textContent = page.title;
    head.append(folio, title);
    const art = document.createElement('div');
    art.className = 'tut-book-art';
    art.append(page.art(this.keys));
    const rows = document.createElement('ul');
    rows.className = 'tut-book-rows';
    for (const row of page.rows) {
      const li = document.createElement('li');
      writeHint(li, row, this.keys);
      rows.append(li);
    }
    const tried = document.createElement('footer');
    tried.className = 'tut-book-tried';
    const own = LESSONS.filter((l) => l.page === page.id);
    if (own.length > 0) {
      tried.append('Tried: ');
      for (const lesson of own) {
        const mark = document.createElement('span');
        const done = this.tracker?.done.has(lesson.id) === true;
        mark.className = done ? 'tut-book-mark is-done' : 'tut-book-mark';
        mark.textContent = lesson.title;
        tried.append(mark);
      }
    }
    sheet.append(head, art, rows, tried);

    const foot = document.createElement('div');
    foot.className = 'tut-book-foot';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'tut-book-turn';
    prev.textContent = '‹';
    prev.disabled = this.index === 0;
    prev.addEventListener('click', () => this.turn(-1));
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'tut-book-turn';
    next.textContent = '›';
    next.disabled = this.index === PAGES.length - 1;
    next.addEventListener('click', () => this.turn(1));
    const help = document.createElement('span');
    help.className = 'tut-book-help';
    writeHint(help, '{prev} {next} turn pages · {close} close', (a) =>
      a === 'prev' ? ['ArrowLeft'] : a === 'next' ? ['ArrowRight'] : a === 'close' ? ['KeyH'] : this.keys(a),
    );
    const shut = document.createElement('button');
    shut.type = 'button';
    shut.className = 'tut-book-close';
    shut.textContent = 'Close';
    shut.addEventListener('click', () => this.closeOpen?.());
    foot.append(prev, help, next, shut);

    book.append(tabs, sheet, foot);
    overlay.replaceChildren(book);
  }

  /** Shuts the booklet if open (the tutorial switched off). */
  close(): void {
    this.closeOpen?.();
  }

  dispose(): void {
    this.close();
    this.bookmark.remove();
  }
}
