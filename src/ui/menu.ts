/**
 * The whole interface: the title screen, the new-drive page, the saves and the logbook,
 * the pause overlay and the settings.
 *
 * Plain DOM, no framework. Every screen is built from the same four things — a pill, a
 * row, a list row and a card — so a screen is a description of itself rather than a new
 * set of styles, and every control is reached with the same keystrokes.
 *
 * The screens the player moves through:
 *
 *   title ──▶ new drive ──▶ (a drive)
 *     │  ├──▶ saves
 *     │  └──▶ logbook
 *     └──▶ first run (a card on the title, once)
 *
 *   driving ──▶ pause ──▶ settings (six pages)
 *                   ├──▶ spawn vehicle / item / part  (dev only)
 *                   └──▶ frame report                 (dev only)
 *
 * `show` owns the title layer and removes it before resolving; `showPause`/`hidePause`
 * manage the pause layer's lifecycle. The two never coexist: no drive is in progress while
 * the title screen is up.
 */

import type { SaveBackend, SaveMeta } from '../save/save';
import { decodeSaveCode, encodeSaveCode, parseSeed } from '../save/save';
import type { WorldState } from '../game/state';
import { DAY_LENGTH } from '../game/state';
import { prefersMobilePresentation } from '../core/renderer';
import { BINDABLE_ACTIONS, isSystemControlCode } from '../core/input';
import {
  LANGUAGES,
  resetSettingsCategory,
  type Language,
  type Settings,
  type SettingsCategory,
  type TimeOfDayPreset,
} from '../game/settings';
import { ACTION_LABEL, LANGUAGE_LABEL, translator, type StringKey, type Translate } from './i18n';
import {
  enumToken,
  enumValue,
  resolveHint,
  settingsPages,
  type SettingOption,
  type SettingRow,
  type SettingsEnvironment,
} from './settingsschema';
import { distanceUnitKey, formattedDistance } from './units';
import { CAMERA_FRAME_LIMIT, type FluidKind, type ShadeTint } from '../items/items';
import { ALL_VARIANTS } from '../parts/registry';
import { CAR_MODELS, modelEngine } from '../vehicle/carmodels';

/**
 * The sound bank the menus speak through, as this module needs it.
 *
 * Declared here rather than imported from `audio/uisounds.ts` so the interface depends on
 * the shape it calls and not on the synthesis behind it — and so a build with the bank
 * missing is a type error at the one place that would have to be edited, rather than a
 * silently mute menu.
 */
export interface MenuSounds {
  move(): void;
  step(up: boolean): void;
  tick(): void;
  confirm(): void;
  back(): void;
  open(): void;
  close(): void;
  generate(): void;
  dud(): void;
}

/** Title-screen preferences: straight through storage, because no world owns them yet. */
export interface TitleHooks {
  /** The stored preferences, or the authored defaults when there are none. */
  settings(): Settings;
  /** Writes them back. The boot reads storage again after `show` returns. */
  store(settings: Settings): void;
  sounds: MenuSounds;
}

/** What the title screen resolved to: a seed to build, or a whole state to resume. */
export interface StartChoice {
  seed: number;
  state: WorldState | null;
  /**
   * The first day of a NEW drive, when the player picked a season.
   *
   * A date rather than a setting: it belongs to the drive being started, not to the machine
   * or to the player, and it is what makes the season turn along the road.
   */
  start?: { calendarEpoch: string };
}

/** What the player chose on the pause overlay. */
export type PauseAction = 'resume' | 'save' | 'quit';

/** The clock and odometer the pause screen prints. */
export interface PauseInfo {
  seed: number;
  km: number;
  /** The in-game moment, as the world keeps it: a date, a day count and a time of day. */
  clock: { epoch: string; dayIndex: number; timeOfDay: number };
}

/** Everything the pause overlay needs from the game; wired by main. */
export interface PauseHooks {
  settings: () => Settings;
  /** Persist a complete settings object; main pushes it through world.apply. */
  applySettings: (next: Settings) => void;
  /** Apply a time-of-day preset immediately; not part of persisted settings. */
  applyTimePreset: (preset: TimeOfDayPreset) => void;
  /**
   * The canvas CSS size the resolution policy is resolved against.
   *
   * Not `window.innerWidth`: cinema mode shortens the CANVAS and not the window, so the
   * two disagree by exactly 180 pixels while it is on — and a render-scale row that quotes
   * a resolution the game is not rendering is the same drift this control exists to end.
   */
  viewport: () => { readonly cssWidth: number; readonly cssHeight: number };
  /**
   * Forget the recorded rung verdict and measure the machine again on the next launch.
   *
   * It reloads: the measurement needs the loading cover, thirty discarded frames and a
   * settle of up to twenty seconds, none of which can happen behind a pause overlay with a
   * car parked in the road.
   */
  remeasureGraphics: () => void;
  /** Sounds for this overlay. */
  sounds: MenuSounds;
  /**
   * Frame cost breakdown, as preformatted text.
   *
   * Development only, and a HOOK rather than a value because the report has to be read on
   * the device whose heat is in question. A phone has no console anyone can attach to, so
   * the numbers have to be able to appear on its screen.
   */
  frameReport?: () => string;
  /**
   * Record a fully fuelled car into the world.
   *
   * Optional, and absent in a production build. Cars are meant to be found in the world and
   * kept: stickers earned by hauling are permanent and do not follow the player to another
   * vehicle, which is worth nothing if a fresh, full-tanked car is one keypress away.
   */
  spawnVehicle?: (request: SpawnRequest) => void;
  /**
   * Drop a trailer into the world. Same dev-only reasoning as `spawnVehicle`: a trailer is
   * meant to be found at a gas stop and left at the destination.
   */
  spawnTrailer?: () => void;
  /**
   * Drops a normal world item at the player's feet. Dev-only: the picker exists to exercise
   * fluid cans and bubble-gum packs without bypassing pickup physics.
   */
  spawnItem?: (request: DevSpawnItemRequest) => void;
  /**
   * Drops one part variant at the player's feet as a loose part. Dev-only for the same
   * reason as the item dispenser: parts are what a run is spent scavenging.
   */
  spawnPart?: (variantId: string) => void;
  /**
   * Flips the driven car — or, on foot, the nearest car or trailer — back onto its wheels.
   * Dev-only: the shipping recovery for a car on its roof is a bubble-gum charge chewed
   * next to it, which costs a consumable and takes eight seconds.
   */
  flipVehicle?: () => void;
  /**
   * Seat the player in the nearest car, skipping the look-ray at a door. Dev only; absent
   * in a production build, like the spawn hooks above.
   */
  seatInNearestCar?: () => void;
  /**
   * Put the player on the rim of a lake basin, by site index. Lakes are one per 200-300 km,
   * so driving to one is hours; dev only, absent in a production build.
   */
  jumpToLake?: (index: number) => void;
  /**
   * The LIVE world state, for "save code".
   *
   * This used to be rebuilt from the two numbers the overlay happens to display (seed and
   * distance) via `newWorldState`, which meant the exported code was a fresh game at that
   * seed: the car, its fitted parts and fuel, the time of day, every dropped part and
   * looted POI were all silently dropped, even though the codec round-trips a whole state.
   * The overlay is handed the real object now.
   */
  exportState: () => WorldState;
}

/** A car to materialise, by model id. */
export interface SpawnRequest {
  readonly modelId: string;
}

export type DevSpawnItemRequest =
  | { readonly type: 'fluid_can'; readonly fluid: FluidKind; readonly capacity: number }
  | { readonly type: 'bubble_gum' }
  | { readonly type: 'medicine' }
  | { readonly type: 'binoculars' }
  | { readonly type: 'torchlight' }
  | { readonly type: 'sun_shades'; readonly tint: ShadeTint }
  | { readonly type: 'camera' }
  | { readonly type: 'football' }
  | { readonly type: 'pocket_watch' };

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function input(cls: string): HTMLInputElement {
  const node = document.createElement('input');
  node.className = cls;
  node.type = 'text';
  node.autocomplete = 'off';
  node.spellcheck = false;
  return node;
}

function button(cls: string, label: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = cls;
  node.textContent = label;
  return node;
}

/**
 * A button that carries the headless-automation contract.
 *
 * The screenshot and smoke tooling drives a fresh boot by typing a seed and pressing the
 * button whose DOM text contains "NEW DRIVE", in whatever language the interface happens to
 * be speaking. The visible label is therefore translated and this span is not: it is off
 * screen, it is not read aloud, and it exists so a tool does not have to know Russian to
 * start a drive.
 */
function automationLabel(node: HTMLElement): HTMLElement {
  const hidden = el('span', 'ui-sr');
  hidden.textContent = 'NEW DRIVE';
  hidden.setAttribute('aria-hidden', 'true');
  node.appendChild(hidden);
  return node;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** A played-time span, in the two units a person reads it in. */
function formatPlayed(seconds: number, tr: Translate): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? tr('time.hm', { h: hours, m: minutes }) : tr('time.m', { m: minutes });
}

/** The date and distance of one saved drive, on one line. */
function saveMeta(meta: SaveMeta, settings: Settings, tr: Translate): string {
  return tr('load.meta', {
    km: formattedDistance(meta.km * 1000, settings.units, 1),
    time: formatPlayed(meta.playedSeconds, tr),
    seed: meta.seed,
  });
}

/** Turns a `KeyboardEvent.code` into something a human reads: KeyW -> W. */
function formatKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse2') return 'RMB';
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** The locale tag `Intl` wants for a language. */
function localeOf(language: Language): string {
  return language === 'ru' ? 'ru-RU' : 'en-GB';
}

/** A day and a month, long form, in the interface's language, fixed to UTC. */
function formatDay(date: Date, language: Language): string {
  return new Intl.DateTimeFormat(localeOf(language), {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
}

/** The in-game clock as hh:mm. Read from `timeOfDay`, so no timezone can move it. */
function formatClock(timeOfDay: number): string {
  const minutes = Math.floor((timeOfDay / DAY_LENGTH) * 24 * 60);
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** The date an ISO string names, at midnight UTC, so `formatDay` reads the same day. */
function isoDate(iso: string, dayIndex = 0): Date {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + dayIndex * 86_400_000);
}

// ---------------------------------------------------------------------------
// The clipboard
// ---------------------------------------------------------------------------

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The Clipboard API needs a secure context and a permission; the old selection trick
    // still works in the places it does not.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Data the dev screens read
// ---------------------------------------------------------------------------

type DriveLayout = 'FWD' | 'RWD' | 'AWD';

const DRIVE_LAYOUTS: readonly { readonly id: DriveLayout; readonly label: string }[] = [
  { id: 'FWD', label: 'front-wheel drive' },
  { id: 'RWD', label: 'rear-wheel drive' },
  { id: 'AWD', label: 'all-wheel drive' },
];

/**
 * What the dev fluid dispenser offers. Capacities mirror `FLUID_STOCK` in world/poi.ts so a
 * dev-spawned can behaves exactly like a found one.
 */
const DEV_FLUIDS: readonly { readonly fluid: FluidKind; readonly capacity: number }[] = [
  { fluid: 'petrol', capacity: 20 },
  { fluid: 'diesel', capacity: 20 },
  { fluid: 'water', capacity: 10 },
  { fluid: 'oil', capacity: 5 },
];

function driveLayout(rearDriveBias: number): DriveLayout {
  if (rearDriveBias <= 0.2) return 'FWD';
  if (rearDriveBias >= 0.8) return 'RWD';
  return 'AWD';
}

// ---------------------------------------------------------------------------
// The title screen's backdrop
// ---------------------------------------------------------------------------

/**
 * Which still the title screen drifts behind, by the season it is now.
 *
 * Four frames of this world, captured from the game itself rather than painted or borrowed:
 * a menu that shows a place the game cannot take you is a lie the first click exposes. A
 * missing file costs the drift and leaves the veil's own gradient, which is why this returns
 * a path rather than building an element.
 */
const BACKDROPS: readonly { readonly months: readonly number[]; readonly file: string }[] = [
  { months: [12, 1, 2], file: '/menu/winter.jpg' },
  { months: [3, 4, 5], file: '/menu/spring.jpg' },
  { months: [6, 7, 8], file: '/menu/summer.jpg' },
  { months: [9, 10, 11], file: '/menu/autumn.jpg' },
];

function backdropFor(date: Date): string {
  const month = date.getMonth() + 1;
  return BACKDROPS.find((entry) => entry.months.includes(month))?.file ?? '/menu/autumn.jpg';
}

/** The day a season opens on. The month is 1-based, as a calendar writes it. */
const SEASON_OPENING: Record<string, readonly [number, number]> = {
  spring: [4, 15],
  summer: [7, 15],
  autumn: [9, 20],
  winter: [1, 15],
};

const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'] as const;
type SeasonId = (typeof SEASON_ORDER)[number];

const SEASON_LABEL: Record<SeasonId, StringKey> = {
  spring: 'drive.season.spring',
  summer: 'drive.season.summer',
  autumn: 'drive.season.autumn',
  winter: 'drive.season.winter',
};

/** An ISO date in a given year, from a season's opening month and day. */
function seasonDate(season: SeasonId, year: number): string {
  const [month, day] = SEASON_OPENING[season]!;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Today, in the same ISO shape the calendar epoch uses. */
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The season a date falls in, for the label under the masthead. */
function seasonOfDate(iso: string): SeasonId {
  const month = Number(iso.slice(5, 7));
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

const FIRST_RUN_KEY = 'brodrive-first-run-v1';

function firstRunDone(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) !== null;
  } catch {
    // No storage: the card is shown every launch, which is the honest reading of a browser
    // that cannot remember the answer.
    return false;
  }
}

function markFirstRunDone(): void {
  try {
    localStorage.setItem(FIRST_RUN_KEY, '1');
  } catch {
    // See above.
  }
}

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

export class MainMenu {
  private pauseLayer: HTMLElement | null = null;
  private pauseCleanup: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly loading: HTMLElement,
  ) {}

  /**
   * The layer, its ground, and the margin strip.
   *
   * The strip is the tear-off margin of every screen: the form's number, what it is, and
   * the date it was issued, printed down the edge the way a real document carries them.
   * It is built here because every screen has one and no screen differs in what it says
   * beyond those three things.
   */
  private openLayer(extra: string, backdrop: string | null, strip: string): HTMLElement {
    const layer = el('div', `ui-layer ${extra}`);
    if (backdrop !== null) {
      const still = el('div', 'ui-backdrop');
      still.style.backgroundImage = `url('${backdrop}')`;
      layer.appendChild(still);
    }
    layer.appendChild(el('div', 'ui-veil'));
    const margin = el('div', 'ui-strip');
    margin.textContent = strip;
    margin.setAttribute('aria-hidden', 'true');
    layer.appendChild(margin);
    this.root.appendChild(layer);
    this.root.classList.add('is-menu-open');
    return layer;
  }

  private closeLayer(layer: HTMLElement): void {
    layer.remove();
    this.root.classList.remove('is-menu-open');
  }

  /** Today, as a form writes it: two digits, a month, a year. */
  private stripDate(date: Date): string {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }

  /**
   * The title screen, and everything reachable from it.
   *
   * Resolves with what to drive: a seed for a new road, or a whole saved state to resume.
   */
  async show(backend: SaveBackend, hooks: TitleHooks): Promise<StartChoice> {
    const { promise, resolve } = Promise.withResolvers<StartChoice>();

    // Preferences this screen can change (language, units, weather) are written straight to
    // storage and read back by the boot, which has not built a world to apply them to yet.
    const stored = hooks.settings();
    const settings: Settings = { ...stored, keyBindings: { ...stored.keyBindings } };
    let tr: Translate = translator(settings.language);

    // The margin strip is built here rather than inside `openLayer`: it is written in the
    // player's language and carries today's date, and neither exists until now.
    const layer = this.openLayer(
      'ui-layer-title',
      backdropFor(new Date()),
      `${tr('doc.form')} · ${tr('doc.waybill')} · ${this.stripDate(new Date())}`,
    );
    this.loading.classList.add('is-hidden');
    let screen: 'title' | 'newdrive' | 'load' | 'profile' = 'title';

    let firstRun = !firstRunDone();
    let season: SeasonId = seasonOfDate(isoToday());
    let saves: readonly SaveMeta[] = [];
    let savesError = false;
    const seedInput = input('ui-input');

    let settled = false;
    const finish = (choice: StartChoice): void => {
      if (settled) return;
      settled = true;
      this.loading.classList.remove('is-hidden');
      this.closeLayer(layer);
      resolve(choice);
    };

    const startWith = (seed: number): void => {
      hooks.sounds.generate();
      finish({
        seed,
        state: null,
        start: { calendarEpoch: seasonDate(season, new Date().getFullYear()) },
      });
    };

    /** Writes what this screen owns, and rebuilds the words if they changed. */
    const commit = (relabel: boolean): void => {
      hooks.store({ ...settings, keyBindings: { ...settings.keyBindings } });
      if (relabel) {
        tr = translator(settings.language);
        paint();
      }
    };

    const refreshSaves = async (): Promise<void> => {
      try {
        saves = await backend.list();
        savesError = false;
      } catch {
        saves = [];
        savesError = true;
      }
      if (!settled) paint();
    };

    /** The masthead, which every screen of the title flow shares. */
    const masthead = (): HTMLElement => {
      const head = el('header', 'ui-head');
      const code = el('div', 'ui-code');
      code.textContent = `${tr('doc.form')} · ${tr('doc.waybill')}`;
      const plate = el('h1', 'ui-plate');
      plate.textContent = 'the BRO drive';
      const tagline = el('p', 'ui-tagline');
      tagline.textContent = tr('title.tagline');
      head.append(code, plate, tagline);
      return head;
    };

    /**
     * One row of pills, for a choice that is a value rather than an action.
     *
     * The hint element is passed in rather than found: the row is built inside three
     * different screens, and a row that guessed which hint line belonged to it would be the
     * third place a screen's structure is written down.
     */
    const choiceRow = (
      hintNode: HTMLElement,
      label: string,
      hintText: string,
      options: readonly { label: string; active: boolean; pick: () => void }[],
    ): HTMLElement => {
      const row = el('div', 'ui-field');
      const name = el('div', 'ui-field-label');
      name.textContent = label;
      const control = el('div', 'ui-field-control');
      const seg = el('div', 'ui-choice');
      const nodes: HTMLButtonElement[] = [];
      for (const [index, option] of options.entries()) {
        const pill = button('ui-choice-opt', option.label);
        if (option.active) pill.classList.add('is-selected');
        pill.addEventListener('click', () => option.pick());
        pill.addEventListener('focus', () => {
          hintNode.textContent = hintText;
        });
        pill.addEventListener('pointerenter', () => {
          hintNode.textContent = hintText;
        });
        pill.addEventListener('keydown', (ev) => {
          const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
          if (step === 0) return;
          ev.preventDefault();
          nodes[(index + step + nodes.length) % nodes.length]?.focus();
        });
        nodes.push(pill);
        seg.appendChild(pill);
      }
      control.appendChild(seg);
      row.append(name, control);
      return row;
    };

    /** The one card the interface is allowed to open by itself, and only once. */
    const firstRunCard = (): HTMLElement => {
      const card = el('div', 'ui-sheet ui-sheet-first');
      const title = el('h2', 'ui-sheet-title');
      title.textContent = tr('first.title');
      const lead = el('p', 'ui-sheet-lead');
      lead.textContent = tr('first.lead');
      const hint = el('div', 'ui-hint');
      hint.textContent = tr('first.language.hint');
      card.append(title, lead);

      const rows = el('div', 'ui-fields');
      rows.appendChild(
        choiceRow(
          hint,
          tr('first.language'),
          tr('first.language.hint'),
          LANGUAGES.map((code) => ({
            label: tr(LANGUAGE_LABEL[code]),
            active: settings.language === code,
            pick: () => {
              if (settings.language === code) return;
              settings.language = code;
              hooks.sounds.step(true);
              commit(true);
            },
          })),
        ),
      );
      rows.appendChild(
        choiceRow(
          hint,
          tr('first.units'),
          tr('first.units.hint'),
          (['km', 'mi'] as const).map((unit) => ({
            label: tr(unit === 'km' ? 'first.units.km' : 'first.units.mi'),
            active: settings.units === unit,
            pick: () => {
              if (settings.units === unit) return;
              settings.units = unit;
              hooks.sounds.step(unit === 'km');
              commit(false);
              paint();
            },
          })),
        ),
      );
      card.appendChild(rows);
      card.appendChild(hint);

      const howto = el('div', 'ui-howto');
      const howtoHead = el('div', 'ui-section-head');
      howtoHead.textContent = tr('first.howto');
      const howtoBody = el('p');
      howtoBody.textContent = tr('first.howto.body');
      howto.append(howtoHead, howtoBody);
      card.appendChild(howto);

      const foot = el('div', 'ui-sheet-foot');
      const begin = button('ui-act is-stamp', tr('first.begin'));
      begin.addEventListener('click', () => {
        hooks.sounds.confirm();
        markFirstRunDone();
        firstRun = false;
        paint();
      });
      foot.appendChild(begin);
      card.appendChild(foot);
      return card;
    };

    /** The two corner lines every title-flow screen keeps. */
    const metaCorner = (view: HTMLElement): void => {
      const left = el('div', 'ui-meta ui-meta-left');
      const region = el('div');
      const strong = el('strong');
      strong.textContent = tr('drive.masthead');
      region.appendChild(strong);
      const sub = el('div');
      sub.textContent = tr('drive.subtitle');
      left.append(region, sub);
      const right = el('div', 'ui-meta ui-meta-right');
      const line = el('div');
      line.textContent = new Intl.DateTimeFormat(localeOf(settings.language), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date());
      right.appendChild(line);
      view.append(left, right);
    };

    const titleScreen = (view: HTMLElement): void => {
      view.appendChild(masthead());
      if (firstRun) view.appendChild(firstRunCard());

      const hint = el('div', 'ui-hint');
      hint.textContent = saves.length > 0 && !firstRun ? tr('title.quickStart.hint') : tr('title.seed.hint');

      // WHILE THE FIRST-RUN CARD IS UP IT IS THE SCREEN: the card already asks three
      // questions, and a column of menu pills underneath it pushes the seed row off the
      // bottom of a 900-pixel window — which is where the drive actually starts from.
      const pills = el('div', 'ui-acts');
      if (!firstRun) {
        if (saves.length > 0) {
          const resume = button('ui-act is-stamp', tr('title.continue'));
          resume.addEventListener('click', () => {
            hooks.sounds.confirm();
            const newest = saves[0]!;
            void backend.load(newest.id).then((state) => {
              if (state === null) {
                hooks.sounds.dud();
                void refreshSaves();
                return;
              }
              finish({ seed: state.seed, state });
            });
          });
          pills.appendChild(resume);
        }
        const newDrive = button('ui-act', tr('title.newDrive'));
        newDrive.addEventListener('click', () => {
          hooks.sounds.open();
          screen = 'newdrive';
          paint();
        });
        const load = button('ui-act', tr('title.load'));
        load.addEventListener('click', () => {
          hooks.sounds.open();
          screen = 'load';
          paint();
        });
        const logbook = button('ui-act', tr('title.profile'));
        logbook.addEventListener('click', () => {
          hooks.sounds.open();
          screen = 'profile';
          paint();
        });
        pills.append(newDrive, load, logbook);
      }

      const quick = el('div', 'ui-quickstart');
      const quickLabel = el('span', 'ui-quickstart-label');
      quickLabel.textContent = tr('title.seed');
      seedInput.placeholder = tr('title.seed.placeholder');
      const quickGo = automationLabel(button('ui-act', tr('title.quickStart')));
      quickGo.addEventListener('click', () => startWith(parseSeed(seedInput.value)));
      seedInput.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        startWith(parseSeed(seedInput.value));
      });
      quick.append(quickLabel, seedInput, quickGo);
      // THE MENU IS A FOLDED WAYBILL. Loose type over the sky is neither a form nor
      // readable: the undertakings, the seed and the line of prose sit on one sheet.
      const fold = el('div', 'ui-sheet ui-sheet-fold');
      if (pills.childElementCount > 0) fold.appendChild(pills);
      fold.append(quick, hint);
      view.appendChild(fold);
      // With the card up, the card's own hint is the line the player is reading and the
      // screen has no room for a second one under it.
      if (firstRun) hint.classList.add('is-hidden');
      metaCorner(view);
      if (!firstRun) seedInput.focus();
    };

    const newDriveScreen = (view: HTMLElement): void => {
      const bar = el('div', 'ui-bar');
      const back = button('ui-act is-plain', tr('drive.back'));
      back.addEventListener('click', () => {
        hooks.sounds.back();
        screen = 'title';
        paint();
      });
      const title = el('h2', 'ui-bar-title');
      title.textContent = tr('drive.title');
      bar.append(back, title);
      view.appendChild(bar);

      const body = el('div', 'ui-desk');
      // THE REGION IS THE MASTHEAD HERE, not the game's name: this screen is about where the
      // drive is, and the name of the place is the largest thing on it.
      const region = el('header', 'ui-head');
      const code = el('div', 'ui-code');
      code.textContent = `${tr('doc.form')} · ${tr('doc.serial')}`;
      const regionName = el('h2', 'ui-plate');
      regionName.textContent = tr('drive.masthead');
      const regionSub = el('p', 'ui-tagline');
      regionSub.textContent = tr('drive.subtitle');
      region.append(code, regionName, regionSub);
      body.appendChild(region);
      const lead = el('p', 'ui-sheet-lead');
      lead.textContent = tr('drive.region.hint');
      body.appendChild(lead);

      const hint = el('div', 'ui-hint');
      const rows = el('div', 'ui-fields');
      rows.appendChild(
        choiceRow(
          hint,
          tr('drive.season'),
          tr('drive.season.hint'),
          SEASON_ORDER.map((id) => ({
            label: tr(SEASON_LABEL[id]),
            active: season === id,
            pick: () => {
              if (season === id) return;
              season = id;
              hooks.sounds.step(true);
              paint();
            },
          })),
        ),
      );
      rows.appendChild(
        choiceRow(
          hint,
          tr('drive.weather'),
          tr('drive.weather.hint'),
          (['auto', 'clear', 'overcast', 'rain'] as const).map((force) => ({
            label: tr(
              force === 'auto'
                ? 'set.weather.auto'
                : force === 'clear'
                  ? 'set.weather.clear'
                  : force === 'overcast'
                    ? 'set.weather.overcast'
                    : 'set.weather.rain',
            ),
            active: settings.weather === force,
            pick: () => {
              if (settings.weather === force) return;
              settings.weather = force;
              hooks.sounds.step(true);
              commit(false);
              paint();
            },
          })),
        ),
      );
      body.appendChild(rows);

      const date = el('div', 'ui-hint');
      date.textContent = `${tr('drive.date')}: ${
        formatDay(isoDate(seasonDate(season, new Date().getFullYear())), settings.language)
      }`;
      body.appendChild(date);

      const seedRow = el('div', 'ui-quickstart');
      const seedLabel = el('span', 'ui-quickstart-label');
      seedLabel.textContent = tr('title.seed');
      seedInput.placeholder = tr('title.seed.placeholder');
      const dice = button('ui-act is-plain', tr('drive.dice'));
      dice.addEventListener('click', () => {
        seedInput.value = String(parseSeed(''));
        hooks.sounds.step(true);
      });
      seedRow.append(seedLabel, seedInput, dice);
      body.appendChild(seedRow);

      const seedHint = el('div', 'ui-hint');
      seedHint.textContent = tr('title.seed.hint');
      body.append(seedHint, hint);

      const foot = el('div', 'ui-sheet-foot');
      const begin = automationLabel(button('ui-act is-stamp is-large', tr('drive.begin')));
      begin.addEventListener('click', () => startWith(parseSeed(seedInput.value)));
      foot.appendChild(begin);
      body.appendChild(foot);
      view.appendChild(body);
      metaCorner(view);
      begin.focus();
    };

    const loadScreen = (view: HTMLElement): void => {
      const bar = el('div', 'ui-bar');
      const back = button('ui-act is-plain', tr('drive.back'));
      back.addEventListener('click', () => {
        hooks.sounds.back();
        screen = 'title';
        paint();
      });
      const title = el('h2', 'ui-bar-title');
      title.textContent = tr('load.title');
      bar.append(back, title);
      view.appendChild(bar);

      const body = el('div', 'ui-desk');
      const list = el('div', 'ui-list');
      const note = el('div', 'ui-hint');
      if (savesError) {
        note.textContent = tr('load.unavailable');
      } else if (saves.length === 0) {
        note.textContent = tr('load.empty');
      }
      for (const meta of saves) {
        const row = el('div', 'ui-save');
        const text = el('div', 'ui-save-text');
        const name = el('div', 'ui-save-name');
        name.textContent = meta.name || tr('load.unnamed');
        const info = el('div', 'ui-save-meta');
        info.textContent = saveMeta(meta, settings, tr);
        text.append(name, info);

        const actions = el('div', 'ui-save-actions');
        const loadBtn = button('ui-act', tr('load.load'));
        const delBtn = button('ui-act is-void', tr('load.delete'));
        loadBtn.addEventListener('click', () => {
          loadBtn.disabled = true;
          void backend.load(meta.id).then((state) => {
            if (state === null) {
              loadBtn.disabled = false;
              hooks.sounds.dud();
              note.textContent = tr('load.code.failed');
              note.classList.add('is-alarm');
              return;
            }
            hooks.sounds.confirm();
            finish({ seed: state.seed, state });
          });
        });
        // Deleting is the one thing in this interface that cannot be undone, so it takes two
        // presses of the same button rather than a dialog nobody reads.
        let armed = false;
        delBtn.addEventListener('click', () => {
          if (!armed) {
            armed = true;
            delBtn.textContent = tr('load.delete.confirm');
            window.setTimeout(() => {
              armed = false;
              delBtn.textContent = tr('load.delete');
            }, 4000);
            return;
          }
          hooks.sounds.back();
          void backend.remove(meta.id).then(() => refreshSaves());
        });
        actions.append(loadBtn, delBtn);
        row.append(text, actions);
        list.appendChild(row);
      }
      body.append(list, note);

      const codeSection = el('div', 'ui-section');
      const head = el('div', 'ui-section-head');
      head.textContent = tr('load.code');
      const codeInput = input('ui-input');
      codeInput.placeholder = tr('load.code.placeholder');
      const codeRow = el('div', 'ui-quickstart');
      const read = button('ui-act', tr('load.code.load'));
      const codeHint = el('div', 'ui-hint');
      codeHint.textContent = tr('load.code.hint');
      const codeError = el('div', 'ui-hint');
      const loadCode = (): void => {
        const code = codeInput.value.trim();
        if (code === '') {
          codeError.textContent = tr('load.code.empty');
          codeError.classList.add('is-alarm');
          hooks.sounds.dud();
          return;
        }
        try {
          const state = decodeSaveCode(code);
          hooks.sounds.generate();
          finish({ seed: state.seed, state });
        } catch {
          codeError.textContent = tr('load.code.bad');
          codeError.classList.add('is-alarm');
          hooks.sounds.dud();
        }
      };
      read.addEventListener('click', loadCode);
      codeInput.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        loadCode();
      });
      codeRow.append(codeInput, read);
      codeSection.append(head, codeRow, codeHint, codeError);
      body.appendChild(codeSection);
      view.appendChild(body);
      back.focus();
    };

    /** The logbook: what the saved drives add up to. */
    const profileScreen = (view: HTMLElement): void => {
      const bar = el('div', 'ui-bar');
      const back = button('ui-act is-plain', tr('drive.back'));
      back.addEventListener('click', () => {
        hooks.sounds.back();
        screen = 'title';
        paint();
      });
      const title = el('h2', 'ui-bar-title');
      title.textContent = tr('profile.title');
      bar.append(back, title);
      view.appendChild(bar);

      const body = el('div', 'ui-desk');
      const lead = el('p', 'ui-sheet-lead');
      lead.textContent = tr('profile.lead');
      body.appendChild(lead);

      if (saves.length === 0) {
        const note = el('div', 'ui-hint');
        note.textContent = tr('profile.none');
        body.appendChild(note);
      } else {
        const totalKm = saves.reduce((sum, meta) => sum + meta.km, 0);
        const totalSeconds = saves.reduce((sum, meta) => sum + meta.playedSeconds, 0);
        const furthest = saves.reduce((best, meta) => Math.max(best, meta.km), 0);
        const stats = el('div', 'ui-stats');
        const stat = (value: string, unit: string, label: string): HTMLElement => {
          const cell = el('div', 'ui-stat');
          const big = el('div', 'ui-stat-value');
          big.textContent = value;
          const small = el('div', 'ui-stat-unit');
          small.textContent = unit;
          const name = el('div', 'ui-stat-label');
          name.textContent = label;
          cell.append(big, small, name);
          return cell;
        };
        const unit = tr(distanceUnitKey(settings.units));
        stats.append(
          stat(String(saves.length), '', tr('profile.drives')),
          stat(formattedDistance(totalKm * 1000, settings.units, 0), unit, tr('profile.distance')),
          stat(formatPlayed(totalSeconds, tr), '', tr('profile.time')),
          stat(formattedDistance(furthest * 1000, settings.units, 0), unit, tr('profile.furthest')),
        );
        body.appendChild(stats);

        const list = el('div', 'ui-list');
        const group = el('div', 'ui-list-group');
        group.textContent = tr('load.heading');
        list.appendChild(group);
        for (const meta of saves) {
          const row = el('div', 'ui-save');
          const text = el('div', 'ui-save-text');
          const name = el('div', 'ui-save-name');
          name.textContent = meta.name || tr('load.unnamed');
          const info = el('div', 'ui-save-meta');
          info.textContent = saveMeta(meta, settings, tr);
          text.append(name, info);
          row.appendChild(text);
          list.appendChild(row);
        }
        body.appendChild(list);
      }
      view.appendChild(body);
      back.focus();
    };

    const paint = (): void => {
      layer.querySelectorAll('.ui-screen').forEach((node) => node.remove());
      const view = el(
        'div',
        screen === 'title' ? 'ui-screen ui-screen-title' : 'ui-screen ui-screen-page',
      );
      if (screen === 'title') titleScreen(view);
      else if (screen === 'newdrive') newDriveScreen(view);
      else if (screen === 'load') loadScreen(view);
      else profileScreen(view);
      layer.appendChild(view);
    };

    paint();
    void refreshSaves();
    return promise;
  }

  /**
   * The pause overlay, with settings and the development screens behind it.
   *
   * One window keydown listener serves the whole overlay: it routes either pause key by
   * screen and runs key-capture for rebinding. Element listeners live on the layer, so
   * `hidePause` (which drops it) releases everything except that one window listener, which
   * `pauseCleanup` removes.
   */
  showPause(info: PauseInfo, hooks: PauseHooks): Promise<PauseAction> {
    this.removePause();
    const { promise, resolve } = Promise.withResolvers<PauseAction>();

    // Working copy of the player's settings. `hooks.settings()` hands out the authoritative
    // object: it is copied on entry, never mutated there, and every change pushes a complete
    // Settings object back through `hooks.applySettings` (keyBindings re-copied so the
    // applied map is ours).
    const base = hooks.settings();
    const settings: Settings = { ...base, keyBindings: { ...base.keyBindings } };
    let tr: Translate = translator(settings.language);
    const mobilePresentation = prefersMobilePresentation();

    // The margin strip of a pause carries the drive's own mileage and its in-game date,
    // which is why the layer is opened here and not with the settings copy.
    const layer = this.openLayer(
      'ui-layer-pause is-pause',
      null,
      `${tr('doc.form')} · ${tr('doc.mileage')} ${
        formattedDistance(info.km * 1000, settings.units, 1)
      } ${tr(distanceUnitKey(settings.units))} · ${
        formatDay(isoDate(info.clock.epoch, info.clock.dayIndex), settings.language)
      }`,
    );
    this.pauseLayer = layer;

    const apply = (): void => {
      hooks.applySettings({ ...settings, keyBindings: { ...settings.keyBindings } });
    };

    type Screen = 'main' | 'settings' | 'spawn' | 'item' | 'part' | 'perf';
    let screen: Screen = 'main';
    /**
     * Which settings page, remembered across visits: somebody adjusting the horizon comes
     * back to the horizon, not to the top of the list.
     */
    let page: SettingsCategory = 'gameplay';
    /** Action id waiting for a key in capture mode; only set on the settings screen. */
    let capturing: string | null = null;
    /** The hint line of the settings screen, while one is built. */
    let hintEl: HTMLElement | null = null;

    let settled = false;
    const finish = (action: PauseAction): void => {
      if (settled) return;
      settled = true;
      this.removePause();
      resolve(action);
    };

    const setHint = (text: string, alarm = false): void => {
      if (hintEl === null) return;
      hintEl.textContent = text;
      hintEl.classList.toggle('is-alarm', alarm);
    };

    /** The hint of one option of one row, resolved from whatever shape it has. */
    const optionHint = (row: SettingRow, index: number): string => {
      const source: SettingOption | undefined =
        row.kind === 'enum' ? row.options[index] : row.kind === 'action' ? undefined : undefined;
      if (row.kind === 'action') return resolveHint(row.actions[index]?.hint ?? row.hint);
      return resolveHint(source?.hint ?? row.hint);
    };

    /**
     * Label of the first other action bound to `code`, or null. Two actions may deliberately
     * share a key only when both declare it as a default; F uses that context-sensitive
     * exception for world manipulation and vehicle entry.
     */
    const holderOf = (code: string, exceptActionId: string): string | null => {
      const except = BINDABLE_ACTIONS.find((action) => action.id === exceptActionId);
      for (const action of BINDABLE_ACTIONS) {
        const intentionalSharedDefault =
          except?.defaultKeys.includes(code) === true && action.defaultKeys.includes(code);
        if (
          action.id !== exceptActionId &&
          !intentionalSharedDefault &&
          (settings.keyBindings[action.id] ?? action.defaultKeys).includes(code)
        ) {
          const key = ACTION_LABEL[action.id];
          return key === undefined ? action.label : tr(key);
        }
      }
      return null;
    };

    // ---------------------------------------------------------------- settings rows

    /** Writes one value into the working copy. The schema owns which key and which type. */
    const writeSetting = (key: string, value: unknown): void => {
      (settings as unknown as Record<string, unknown>)[key] = value;
    };

    const readSetting = (key: string): unknown =>
      (settings as unknown as Record<string, unknown>)[key];

    const environment = (): SettingsEnvironment => {
      const viewport = hooks.viewport();
      return {
        cssWidth: viewport.cssWidth,
        cssHeight: viewport.cssHeight,
        devicePixelRatio: window.devicePixelRatio,
        mobilePresentation,
        measure: mobilePresentation ? undefined : hooks.remeasureGraphics,
        timePreset: hooks.applyTimePreset,
      };
    };

    /**
     * One row, drawn by kind.
     *
     * The kinds are four because the settings are four kinds of question — which of a few
     * answers, yes or no, somewhere between two numbers, and which key — and every row in
     * the schema is one of them. A row that needed a fifth would be a new idea about
     * settings, not a new control.
     */
    const renderRow = (
      row: SettingRow,
      paints: (() => void)[],
      onRepaint: () => void,
    ): HTMLElement => {
      if (row.kind === 'keys') return renderKeys(row);
      const node = el('div', 'ui-field');
      if (row.head !== undefined) node.classList.add('has-note');
      const label = el('div', 'ui-field-label');
      label.textContent = row.label;
      node.appendChild(label);
      const key = row.key ?? '';
      const hint = (): string => resolveHint(row.hint);

      if (row.head !== undefined) {
        const head = el('div', 'ui-field-note');
        if (row.head.chip !== undefined) {
          const chip = el('output', 'ui-chip');
          chip.textContent = row.head.chip.text();
          chip.addEventListener('pointerenter', () => setHint(resolveHint(row.head?.chip?.hint() ?? row.hint)));
          head.appendChild(chip);
          paints.push(() => {
            chip.textContent = row.head?.chip?.text() ?? '';
          });
        }
        for (const action of row.head.actions ?? []) {
          const actionButton = button('ui-act is-plain', action.label);
          actionButton.addEventListener('click', () => {
            hooks.sounds.confirm();
            action.run();
          });
          actionButton.addEventListener('pointerenter', () => setHint(resolveHint(action.hint)));
          actionButton.addEventListener('focus', () => setHint(resolveHint(action.hint)));
          head.appendChild(actionButton);
        }
        node.appendChild(head);
      }

      const control = el('div', 'ui-field-control');

      const commitOption = (value: string, index: number): void => {
        writeSetting(key, enumValue(value));
        apply();
        onRepaint();
        hooks.sounds.step(true);
        setHint(optionHint(row, index));
        // The language is the one choice that changes the words around it, so it is the one
        // choice that rebuilds the screen it was made on.
        if (key === 'language') {
          tr = translator(settings.language);
          renderScreen();
        }
      };

      if (row.kind === 'enum') {
        if (row.options.length <= 4) {
          const seg = el('div', 'ui-choice');
          const nodes: HTMLButtonElement[] = [];
          for (const [index, option] of row.options.entries()) {
            const pill = button('ui-choice-opt', option.label);
            pill.classList.toggle('is-selected', enumToken(readSetting(key)) === option.value);
            pill.addEventListener('click', () => commitOption(option.value, index));
            pill.addEventListener('pointerenter', () => setHint(optionHint(row, index)));
            pill.addEventListener('focus', () => setHint(optionHint(row, index)));
            pill.addEventListener('blur', () => setHint(hint()));
            pill.addEventListener('keydown', (ev) => {
              const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
              if (step === 0) return;
              ev.preventDefault();
              nodes[(index + step + nodes.length) % nodes.length]?.focus();
            });
            nodes.push(pill);
            seg.appendChild(pill);
          }
          control.appendChild(seg);
          paints.push(() => {
            for (const [index, option] of row.options.entries()) {
              nodes[index]?.classList.toggle('is-selected', enumToken(readSetting(key)) === option.value);
            }
          });
        } else {
          // More answers than fit a row of pills at a readable size. The stepper is the same
          // choice with the walking made explicit, which is also how a long list reads best
          // — and it is what the option set is really for: seven render scales are an axis,
          // not seven buttons to compare side by side.
          const stepper = el('div', 'ui-pager');
          const value = el('output', 'ui-value');
          const indexOf = (): number => {
            const found = row.options.findIndex((option) => option.value === enumToken(readSetting(key)));
            return found < 0 ? 0 : found;
          };
          const paint = (): void => {
            value.textContent = row.options[indexOf()]?.label ?? '';
          };
          const stepTo = (delta: number): void => {
            const next = (indexOf() + delta + row.options.length) % row.options.length;
            commitOption(row.options[next]!.value, next);
          };
          const prev = button('ui-arrow', '\u2039');
          const next = button('ui-arrow', '\u203a');
          prev.addEventListener('click', () => stepTo(-1));
          next.addEventListener('click', () => stepTo(1));
          for (const arrow of [prev, next]) {
            arrow.addEventListener('pointerenter', () => setHint(optionHint(row, indexOf())));
            arrow.addEventListener('focus', () => setHint(optionHint(row, indexOf())));
            arrow.addEventListener('keydown', (ev) => {
              if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
              ev.preventDefault();
              stepTo(ev.key === 'ArrowLeft' ? -1 : 1);
            });
          }
          stepper.append(prev, value, next);
          control.appendChild(stepper);
          paint();
          paints.push(paint);
          node.addEventListener('pointerenter', () => setHint(optionHint(row, indexOf())));
        }
      } else if (row.kind === 'toggle') {
        const toggle = button('ui-check', '');
        toggle.setAttribute('role', 'switch');
        // The box is drawn; the WORD is printed beside it, the way a form writes its own
        // state in the margin rather than inside the tick.
        const word = el('span', 'ui-check-word');
        const paint = (): void => {
          const on = readSetting(key) === true;
          toggle.classList.toggle('is-on', on);
          word.textContent = tr(on ? 'set.on' : 'set.off');
          toggle.setAttribute('aria-checked', String(on));
        };
        toggle.addEventListener('click', () => {
          const value = readSetting(key) !== true;
          writeSetting(key, value);
          apply();
          hooks.sounds.step(value);
          paint();
          setHint(hint());
        });
        toggle.addEventListener('pointerenter', () => setHint(hint()));
        toggle.addEventListener('focus', () => setHint(hint()));
        paint();
        paints.push(paint);
        control.append(toggle, word);
      } else if (row.kind === 'slider') {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'ui-slider';
        slider.min = String(row.min);
        slider.max = String(row.max);
        slider.step = String(row.step);
        const value = el('output', 'ui-slider-value');
        const paint = (): void => {
          const current = Number(readSetting(key)) || 0;
          slider.value = String(current);
          value.textContent = row.format(current);
          // The filled part of the track is painted from the width the handle sits at: a
          // range input draws no fill of its own, and a slider whose left half is invisible
          // makes the player read the thumb's position against nothing.
          const fraction = row.max > row.min ? (current - row.min) / (row.max - row.min) : 0;
          slider.style.setProperty('--fill', `${Math.round(fraction * 100)}%`);
        };
        slider.addEventListener('input', () => {
          const next = slider.valueAsNumber;
          writeSetting(key, next);
          apply();
          value.textContent = row.format(next);
          const fraction = row.max > row.min ? (next - row.min) / (row.max - row.min) : 0;
          slider.style.setProperty('--fill', `${Math.round(fraction * 100)}%`);
          hooks.sounds.tick();
        });
        slider.addEventListener('change', () => {
          hooks.sounds.step(true);
          setHint(hint());
        });
        slider.addEventListener('pointerenter', () => setHint(hint()));
        slider.addEventListener('focus', () => setHint(hint()));
        paint();
        paints.push(paint);
        control.append(slider, value);
      } else {
        // Actions: pills that fire and forget, in the same row as everything else.
        for (const action of row.actions) {
          const pill = button('ui-act is-plain', action.label);
          pill.addEventListener('click', () => {
            hooks.sounds.confirm();
            action.run();
          });
          pill.addEventListener('pointerenter', () => setHint(resolveHint(action.hint)));
          pill.addEventListener('focus', () => setHint(resolveHint(action.hint)));
          control.appendChild(pill);
        }
      }

      if (control.childElementCount > 0) node.appendChild(control);
      node.addEventListener('pointerleave', () => setHint(hint()));
      return node;
    };

    /** The key bindings: one row per action, capture on click. */
    const renderKeys = (row: SettingRow): HTMLElement => {
      const wrap = el('div', 'ui-section');
      const head = el('div', 'ui-section-head');
      const headText = el('span');
      headText.textContent = row.label;
      const reset = button('ui-act is-plain', tr('set.keys.reset'));
      reset.addEventListener('click', () => {
        settings.keyBindings = {};
        apply();
        hooks.sounds.back();
        renderScreen();
        setHint(tr('set.keys.reset'));
      });
      head.append(headText, reset);
      const list = el('div', 'ui-keys');
      for (const action of BINDABLE_ACTIONS) {
        const rowNode = button('ui-key-row', '');
        const name = el('span', 'ui-key-row-label');
        const labelKey = ACTION_LABEL[action.id];
        name.textContent = labelKey === undefined ? action.label : tr(labelKey);
        const keys = el('span', 'ui-key-row-keys');
        if (capturing === action.id) {
          rowNode.classList.add('is-capturing');
          const waiting = el('span', 'ui-keycap is-waiting');
          waiting.textContent = tr('set.keys.press');
          keys.appendChild(waiting);
        } else {
          // One cap per key, not a slash-joined string: a boxed glyph is read as a key
          // without being parsed as a sentence.
          for (const code of settings.keyBindings[action.id] ?? action.defaultKeys) {
            const cap = el('kbd', 'ui-keycap');
            cap.textContent = formatKey(code);
            keys.appendChild(cap);
          }
        }
        rowNode.addEventListener('click', () => {
          capturing = capturing === action.id ? null : action.id;
          hooks.sounds.step(true);
          renderScreen();
          if (capturing !== null) setHint(tr('set.keys.hint'));
        });
        rowNode.addEventListener('pointerenter', () => setHint(tr('set.keys.hint')));
        rowNode.addEventListener('focus', () => setHint(tr('set.keys.hint')));
        rowNode.append(name, keys);
        list.appendChild(rowNode);
      }
      wrap.append(head, list);
      return wrap;
    };

    const renderSettings = (view: HTMLElement): void => {
      const bar = el('div', 'ui-bar');
      const back = button('ui-act is-plain', tr('pause.back'));
      back.addEventListener('click', () => {
        hooks.sounds.back();
        go('main');
      });
      const title = el('h2', 'ui-bar-title');
      title.textContent = tr('set.title');
      bar.append(back, title);
      view.appendChild(bar);

      // THE SECTIONS ARE THE FORM'S OWN INDEX, down the left margin and numbered, not a
      // row of tabs: a document lists its parts in the order it is read, and the part being
      // read is the one with the heavy rule against it.
      const pages = settingsPages(settings, environment(), tr);
      const layout = el('div', 'ui-page-body');
      const rail = el('nav', 'ui-rail');
      const railTitle = el('div', 'ui-rail-title');
      railTitle.textContent = tr('doc.sections');
      rail.appendChild(railTitle);
      const desk = el('div', 'ui-desk');
      layout.append(rail, desk);
      view.appendChild(layout);

      const tabNodes: { id: SettingsCategory; node: HTMLButtonElement }[] = [];
      for (const [index, entry] of pages.entries()) {
        const tab = button('ui-rail-btn', '');
        const num = el('span', 'ui-rail-num');
        num.textContent = `${index + 1}.`;
        const name = el('span');
        name.textContent = entry.title;
        tab.append(num, name);
        tab.classList.toggle('is-selected', entry.id === page);
        tab.addEventListener('click', () => {
          hooks.sounds.step(true);
          page = entry.id;
          showPage(entry.id);
          tab.focus();
        });
        tab.addEventListener('keydown', (ev) => {
          const step = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
          if (step === 0) return;
          ev.preventDefault();
          const next = tabNodes[(index + step + tabNodes.length) % tabNodes.length]!;
          hooks.sounds.move();
          page = next.id;
          showPage(next.id);
          next.node.focus();
        });
        tabNodes.push({ id: entry.id, node: tab });
        rail.appendChild(tab);
      }

      hintEl = el('div', 'ui-hint');
      desk.appendChild(hintEl);

      const showPage = (id: SettingsCategory): void => {
        const entry = pages.find((candidate) => candidate.id === id) ?? pages[0]!;
        for (const tab of tabNodes) tab.node.classList.toggle('is-selected', tab.id === id);
        // Everything before the hint line is rebuilt; the hint stays where it is so the line
        // does not jump when a section is changed.
        desk.querySelectorAll('.ui-sheet').forEach((node) => node.remove());
        capturing = null;
        const paints: (() => void)[] = [];

        const sheet = el('div', 'ui-sheet');
        const head = el('div', 'ui-head-row');
        const headText = el('span', 'ui-head-title');
        headText.textContent = `${pages.findIndex((candidate) => candidate.id === entry.id) + 1}. ${entry.title}`;
        const reset = button('ui-act is-plain', tr('set.reset'));
        reset.addEventListener('click', () => {
          Object.assign(settings, resetSettingsCategory(settings, entry.id));
          apply();
          hooks.sounds.back();
          renderScreen();
          setHint(tr('set.reset.done'));
        });
        head.append(headText, reset);
        sheet.appendChild(head);
        const lead = el('p', 'ui-sheet-lead');
        lead.textContent = entry.hint;
        sheet.appendChild(lead);

        const section = el('div', 'ui-fields');
        for (const row of entry.rows) {
          section.appendChild(renderRow(row, paints, () => {
            for (const paint of paints) paint();
          }));
        }
        sheet.appendChild(section);
        desk.insertBefore(sheet, hintEl);
        setHint(entry.hint);
      };

      showPage(page);
      back.focus();
    };

    // ---------------------------------------------------------------- main and dev

    const renderMain = (view: HTMLElement): void => {
      const card = el('div', 'ui-sheet is-pause');
      const title = el('h2', 'ui-pause-title');
      title.textContent = tr('pause.title');
      card.appendChild(title);

      const stats = el('div', 'ui-pause-stats');
      const when = el('span');
      when.textContent = `${formatDay(isoDate(info.clock.epoch, info.clock.dayIndex), settings.language)}`
        + ` · ${formatClock(info.clock.timeOfDay)}`;
      const travelled = el('span');
      travelled.textContent = tr('pause.travelled', {
        km: `${formattedDistance(info.km * 1000, settings.units, 1)} ${tr(distanceUnitKey(settings.units))}`,
      });
      stats.append(when, travelled);
      card.appendChild(stats);

      const pills = el('div', 'ui-acts');
      const resume = button('ui-act is-stamp', tr('pause.resume'));
      resume.addEventListener('click', () => {
        hooks.sounds.back();
        finish('resume');
      });
      const settingsButton = button('ui-act', tr('pause.settings'));
      settingsButton.addEventListener('click', () => {
        hooks.sounds.open();
        go('settings');
      });
      const save = button('ui-act', tr('pause.save'));
      save.addEventListener('click', () => {
        hooks.sounds.confirm();
        finish('save');
      });
      const code = button('ui-act', tr('pause.code'));
      code.addEventListener('click', () => {
        void copyText(encodeSaveCode(hooks.exportState())).then((ok) => {
          if (ok) hooks.sounds.confirm();
          else hooks.sounds.dud();
          code.textContent = ok ? tr('pause.copied') : tr('pause.copyFailed');
          window.setTimeout(() => {
            code.textContent = tr('pause.code');
          }, 1600);
        });
      });
      const quit = button('ui-act is-plain', tr('pause.quit'));
      quit.addEventListener('click', () => {
        hooks.sounds.back();
        finish('quit');
      });
      pills.append(resume, settingsButton, save, code, quit);
      card.appendChild(pills);

      const seedRow = el('div', 'ui-pause-seed');
      const seedLabel = el('span');
      seedLabel.textContent = `${tr('pause.seed')} ${info.seed}`;
      const copySeed = button('ui-act is-plain', tr('pause.copy'));
      copySeed.addEventListener('click', () => {
        void copyText(String(info.seed)).then((ok) => {
          if (ok) hooks.sounds.confirm();
          else hooks.sounds.dud();
          copySeed.textContent = ok ? tr('pause.copied') : tr('pause.copyFailed');
          window.setTimeout(() => {
            copySeed.textContent = tr('pause.copy');
          }, 1600);
        });
      });
      seedRow.append(seedLabel, copySeed);
      card.appendChild(seedRow);
      view.appendChild(card);

      // The development screens, folded away behind one row. `import.meta.env.DEV` is read
      // first so the whole fold disappears from a production build, labels included.
      const devs = import.meta.env.DEV ? devButtons() : [];
      if (devs.length > 0) {
        const fold = el('div', 'ui-fold');
        const head = button('ui-fold-head', tr('pause.dev'));
        const foldBody = el('div', 'ui-fold-body is-hidden');
        head.addEventListener('click', () => {
          const open = !foldBody.classList.toggle('is-hidden');
          if (open) hooks.sounds.open();
          else hooks.sounds.close();
        });
        foldBody.append(...devs);
        fold.append(head, foldBody);
        view.appendChild(fold);
      }

      const hint = el('div', 'ui-hint');
      hint.textContent = tr('set.unsaved');
      view.appendChild(hint);
      resume.focus();
    };

    const devButtons = (): HTMLElement[] => {
      const out: HTMLElement[] = [];
      const add = (label: string, run: () => void): void => {
        const pill = button('ui-act is-plain', label);
        pill.addEventListener('click', run);
        out.push(pill);
      };
      if (hooks.spawnVehicle) {
        add(tr('pause.dev.spawnVehicle'), () => go('spawn'));
      }
      if (hooks.spawnTrailer) {
        add(tr('pause.dev.spawnTrailer'), () => {
          hooks.spawnTrailer?.();
          finish('resume');
        });
      }
      if (hooks.spawnItem) {
        add(tr('pause.dev.spawnItem'), () => go('item'));
      }
      if (hooks.spawnPart) {
        add(tr('pause.dev.spawnPart'), () => go('part'));
      }
      if (hooks.flipVehicle) {
        add(tr('pause.dev.flip'), () => {
          hooks.flipVehicle?.();
          finish('resume');
        });
      }
      if (hooks.seatInNearestCar) {
        add(tr('pause.dev.seat'), () => {
          hooks.seatInNearestCar?.();
          finish('resume');
        });
      }
      if (hooks.jumpToLake) {
        // Cycles through the first sites on each press rather than opening a screen for one
        // number: every seed has 160 of them and they are interchangeable.
        let nextLake = 0;
        add(tr('pause.dev.lake'), () => {
          hooks.jumpToLake?.(nextLake++);
          finish('resume');
        });
      }
      if (hooks.frameReport) {
        add(tr('pause.dev.perf'), () => go('perf'));
      }
      return out;
    };

    const renderPerf = (view: HTMLElement): void => {
      const bar = el('div', 'ui-bar');
      const back = button('ui-act is-plain', tr('pause.back'));
      back.addEventListener('click', () => {
        hooks.sounds.back();
        go('main');
      });
      const title = el('h2', 'ui-bar-title');
      title.textContent = tr('pause.dev.perf.title');
      const copy = button('ui-act is-plain', tr('pause.dev.perf.copy'));
      const report = hooks.frameReport?.() ?? tr('pause.dev.perf.none');
      copy.addEventListener('click', () => {
        // Exactly what is on screen, not a fresh reading: a button that copied a different
        // set of numbers from the ones being looked at would make the two incomparable.
        void copyText(report).then((ok) => {
          copy.textContent = ok ? tr('pause.copied') : tr('pause.copyFailed');
          window.setTimeout(() => {
            copy.textContent = tr('pause.dev.perf.copy');
          }, 1600);
        });
      });
      const tools = el('div', 'ui-bar-tools');
      tools.appendChild(copy);
      bar.append(back, title, tools);
      view.appendChild(bar);

      const body = el('div', 'ui-desk');
      const readout = el('pre', 'ui-perf');
      readout.textContent = report;
      body.appendChild(readout);
      view.appendChild(body);
      back.focus();
    };

    // Spawn selection resets per pause, so every visit starts at the first model.
    let spawnModelId = CAR_MODELS[0]?.id ?? '';

    const renderSpawnScreen = (view: HTMLElement): void => {
      const bar = el('div', 'ui-bar');
      const back = button('ui-act is-plain', tr('pause.back'));
      back.addEventListener('click', () => {
        hooks.sounds.back();
        go('main');
      });
      const title = el('h2', 'ui-bar-title');
      title.textContent = tr('pause.dev.spawn.title');
      bar.append(back, title);
      view.appendChild(bar);

      const body = el('div', 'ui-desk');
      const note = el('div', 'ui-hint');
      const list = el('div', 'ui-list');
      const paintModels = (): void => {
        list.textContent = '';
        for (const layout of DRIVE_LAYOUTS) {
          const models = CAR_MODELS.filter((def) => driveLayout(def.rearDriveBias) === layout.id);
          if (models.length === 0) continue;
          const group = el('div', 'ui-list-group');
          group.textContent = layout.label;
          list.appendChild(group);
          for (const def of models) {
            const rowNode = button('ui-list-row', '');
            rowNode.classList.toggle('is-selected', def.id === spawnModelId);
            const name = el('span', 'ui-list-label');
            name.textContent = def.label;
            rowNode.appendChild(name);
            // Fuel badge. Only diesels are marked: petrol is the default across the
            // catalogue, so badging every petrol car would be twenty chips saying nothing.
            if (modelEngine(def).fuel === 'diesel') {
              const badge = el('span', 'ui-list-badge');
              badge.textContent = 'D';
              badge.title = 'diesel';
              rowNode.appendChild(badge);
            }
            const bodyClass = el('span', 'ui-list-note');
            bodyClass.textContent = def.bodyClass;
            rowNode.appendChild(bodyClass);
            rowNode.addEventListener('click', () => {
              spawnModelId = def.id;
              hooks.sounds.step(true);
              paintModels();
              paintNote();
            });
            list.appendChild(rowNode);
          }
        }
      };
      const paintNote = (): void => {
        const def = CAR_MODELS.find((model) => model.id === spawnModelId);
        note.textContent = def === undefined
          ? spawnModelId
          : `${def.label} (${def.bodyClass}, ${modelEngine(def).fuel})`;
      };
      paintModels();
      paintNote();
      body.append(list, note);

      const foot = el('div', 'ui-sheet-foot');
      const spawn = button('ui-act is-stamp', tr('pause.dev.spawn.confirm'));
      spawn.addEventListener('click', () => {
        hooks.spawnVehicle?.({ modelId: spawnModelId });
        finish('resume');
      });
      foot.appendChild(spawn);
      body.appendChild(foot);
      view.appendChild(body);
      back.focus();
    };
    const renderSpawn: ((view: HTMLElement) => void) | null = import.meta.env.DEV
      ? renderSpawnScreen
      : null;

    /**
     * Dev item dispenser. Fluid capacities mirror gas-stop stock; bubble gum uses the same
     * five-charge pack found there. Every row drops a real world pickup.
     */
    const renderItemScreen = (view: HTMLElement): void => {
      const bar = el('div', 'ui-bar');
      const back = button('ui-act is-plain', tr('pause.back'));
      back.addEventListener('click', () => {
        hooks.sounds.back();
        go('main');
      });
      const title = el('h2', 'ui-bar-title');
      title.textContent = tr('pause.dev.item.title');
      bar.append(back, title);
      view.appendChild(bar);

      const body = el('div', 'ui-desk');
      const list = el('div', 'ui-list');
      for (const spec of DEV_FLUIDS) {
        const rowNode = button('ui-list-row', '');
        const name = el('span', 'ui-list-label');
        name.textContent = spec.fluid;
        rowNode.appendChild(name);
        if (spec.fluid === 'diesel') {
          const badge = el('span', 'ui-list-badge');
          badge.textContent = 'D';
          badge.title = 'diesel';
          rowNode.appendChild(badge);
        }
        const capacity = el('span', 'ui-list-note');
        capacity.textContent = `${spec.capacity} L`;
        rowNode.appendChild(capacity);
        rowNode.addEventListener('click', () => {
          hooks.spawnItem?.({ type: 'fluid_can', fluid: spec.fluid, capacity: spec.capacity });
          finish('resume');
        });
        list.appendChild(rowNode);
      }

      const extras: readonly {
        readonly label: string;
        readonly detail: string;
        readonly request: DevSpawnItemRequest;
      }[] = [
        { label: 'bubble gum pack', detail: '5 charges', request: { type: 'bubble_gum' } },
        { label: 'medicine bottle', detail: 'E use · full recovery', request: { type: 'medicine' } },
        { label: 'binoculars', detail: 'E toggle · 10x', request: { type: 'binoculars' } },
        { label: 'torchlight', detail: 'E toggle beam', request: { type: 'torchlight' } },
        {
          label: 'professional camera',
          detail: `E viewfinder · ${CAMERA_FRAME_LIMIT} frames`,
          request: { type: 'camera' },
        },
        { label: 'football', detail: 'walk or sprint into it', request: { type: 'football' } },
        { label: 'pocket watch', detail: 'E wind +4 h', request: { type: 'pocket_watch' } },
        { label: 'green sun shades', detail: 'E equip · G remove', request: { type: 'sun_shades', tint: 'green' } },
        { label: 'yellow sun shades', detail: 'E equip · G remove', request: { type: 'sun_shades', tint: 'yellow' } },
        { label: 'red sun shades', detail: 'E equip · G remove', request: { type: 'sun_shades', tint: 'red' } },
      ];
      for (const spec of extras) {
        const rowNode = button('ui-list-row', '');
        const name = el('span', 'ui-list-label');
        name.textContent = spec.label;
        const detail = el('span', 'ui-list-note');
        detail.textContent = spec.detail;
        rowNode.append(name, detail);
        rowNode.addEventListener('click', () => {
          hooks.spawnItem?.(spec.request);
          finish('resume');
        });
        list.appendChild(rowNode);
      }
      const note = el('div', 'ui-hint');
      note.textContent = tr('pause.dev.item.note');
      body.append(list, note);
      view.appendChild(body);
      back.focus();
    };
    const renderItem: ((view: HTMLElement) => void) | null = import.meta.env.DEV
      ? renderItemScreen
      : null;

    /**
     * Dev part dispenser. Reads the registry rather than a hand-written list, so a variant
     * added to `ALL_VARIANTS` is spawnable the moment it exists, and drops a real loose part:
     * the same object a wreck yields, with the same pickup, storage and mounting paths
     * behind it.
     */
    const renderPartScreen = (view: HTMLElement): void => {
      const bar = el('div', 'ui-bar');
      const back = button('ui-act is-plain', tr('pause.back'));
      back.addEventListener('click', () => {
        hooks.sounds.back();
        go('main');
      });
      const title = el('h2', 'ui-bar-title');
      title.textContent = tr('pause.dev.part.title');
      bar.append(back, title);
      view.appendChild(bar);

      const body = el('div', 'ui-desk');
      const list = el('div', 'ui-list');
      // Grouped by kind, in registry order: the engines stay together and the gearboxes do
      // not interleave with them halfway down the list.
      const kinds: string[] = [];
      for (const part of ALL_VARIANTS) {
        if (!kinds.includes(part.kind)) kinds.push(part.kind);
      }
      for (const kind of kinds) {
        const group = el('div', 'ui-list-group');
        group.textContent = kind.replace(/_/g, ' ');
        list.appendChild(group);
        for (const part of ALL_VARIANTS.filter((variant) => variant.kind === kind)) {
          const rowNode = button('ui-list-row', '');
          const name = el('span', 'ui-list-label');
          name.textContent = part.label;
          const mass = el('span', 'ui-list-note');
          mass.textContent = `${part.mass} kg`;
          rowNode.append(name, mass);
          rowNode.addEventListener('click', () => {
            hooks.spawnPart?.(part.id);
            finish('resume');
          });
          list.appendChild(rowNode);
        }
      }
      const note = el('div', 'ui-hint');
      note.textContent = tr('pause.dev.part.note');
      body.append(list, note);
      view.appendChild(body);
      back.focus();
    };
    const renderPart: ((view: HTMLElement) => void) | null = import.meta.env.DEV
      ? renderPartScreen
      : null;

    const renderScreen = (): void => {
      layer.querySelectorAll('.ui-screen').forEach((node) => node.remove());
      layer.classList.toggle('is-page', screen !== 'main');
      layer.classList.toggle('is-pause', screen === 'main');
      hintEl = null;
      const view = el(
        'div',
        screen === 'main' ? 'ui-screen ui-screen-pause' : 'ui-screen ui-screen-page',
      );
      if (screen === 'main') renderMain(view);
      else if (screen === 'settings') renderSettings(view);
      else if (screen === 'perf') renderPerf(view);
      else if (screen === 'item') renderItem?.(view);
      else if (screen === 'part') renderPart?.(view);
      else renderSpawn?.(view);
      layer.appendChild(view);
    };

    const go = (next: Screen): void => {
      if (next === screen) return;
      screen = next;
      capturing = null;
      renderScreen();
    };

    const onKey = (ev: KeyboardEvent): void => {
      if (screen === 'settings' && capturing !== null) {
        // Capture mode: the next keydown becomes the binding. Modifier chords stay with the
        // browser, while fixed system controls cancel capture.
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        ev.preventDefault();
        if (isSystemControlCode(ev.code)) {
          capturing = null;
          renderScreen();
          return;
        }
        const action = BINDABLE_ACTIONS.find((entry) => entry.id === capturing);
        if (!action) return;
        const holder = holderOf(ev.code, action.id);
        if (holder !== null) {
          // Reject rather than clobber: say who already owns the key.
          setHint(tr('set.keys.held', { key: formatKey(ev.code), action: holder }), true);
          hooks.sounds.dud();
          return;
        }
        settings.keyBindings[action.id] = [ev.code];
        apply();
        hooks.sounds.confirm();
        capturing = null;
        renderScreen();
        return;
      }
      if (ev.code === 'Escape' || ev.code === 'Backquote') {
        ev.preventDefault();
        if (screen === 'main') finish('resume');
        else if (screen === 'settings') go('main');
        else go('settings');
      }
    };
    window.addEventListener('keydown', onKey);
    this.pauseCleanup = () => window.removeEventListener('keydown', onKey);

    renderScreen();
    return promise;
  }

  hidePause(): void {
    this.removePause();
  }

  private removePause(): void {
    if (this.pauseCleanup !== null) {
      this.pauseCleanup();
      this.pauseCleanup = null;
    }
    if (this.pauseLayer !== null) {
      this.pauseLayer.remove();
      this.pauseLayer = null;
      this.root.classList.remove('is-menu-open');
    }
  }
}
