import type { SaveBackend, SaveMeta } from '../save/save';
import { parseSeed, decodeSaveCode, encodeSaveCode } from '../save/save';
import type { WorldState } from '../game/state';
import { BINDABLE_ACTIONS } from '../core/input';
import {
  DAY_CYCLE_MAX_MINUTES,
  DAY_CYCLE_MIN_MINUTES,
  DEFAULT_MOUSE_SENSITIVITY,
  MOUSE_SENSITIVITY_MAX,
  MOUSE_SENSITIVITY_MIN,
  POI_SPACING_MAX_METRES,
  POI_SPACING_MIN_METRES,
  POI_SPACING_STEP_METRES,
  TIME_OF_DAY_PRESETS,
} from '../game/settings';
import type { GraphicsQuality, Settings, TimeOfDayPreset, ViewDistance } from '../game/settings';
import type { SpawnRequest } from '../game/spawn';
import { modelEngine, CAR_MODELS } from '../vehicle/carmodels';
import type { FluidKind, ShadeTint } from '../items/items';

/**
 * Title screen and pause overlay. Plain DOM, no framework. Each call owns the
 * overlay it creates: `show` removes the title screen before resolving and
 * `showPause`/`hidePause` manage the pause overlay's lifecycle.
 */

function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function input(cls: string): HTMLInputElement {
  const node = document.createElement('input');
  node.className = cls;
  node.type = 'text';
  return node;
}

function button(cls: string, label: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.className = cls;
  node.type = 'button';
  node.textContent = label;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Stroked 24x24 glyphs, as raw path data.
 *
 * Inline paths rather than an icon font or image files: they inherit `currentColor`,
 * so a selected control's glyph brightens with its text for free, and there is
 * nothing to load, cache or fail. Every glyph is strokes only (no fills) at a single
 * width, which is what keeps sixteen unrelated shapes looking like one set.
 *
 * They exist to carry the AXIS of a control at a glance — three bars for a quality
 * tier, three receding ridges for a horizon, a sun climbing and setting for the time
 * of day. The words next to them confirm; the shapes are what you navigate by.
 */
const ICONS: Record<string, readonly string[]> = {
  drive: [
    'M3 16l2-6h14l2 6v2h-3M3 18v-2M8 18h8',
    'M8 18a1.6 1.6 0 1 0-3.2 0 1.6 1.6 0 0 0 3.2 0z',
    'M19.2 18a1.6 1.6 0 1 0-3.2 0 1.6 1.6 0 0 0 3.2 0z',
  ],
  display: ['M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z', 'M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z'],
  sound: ['M4 9h3l5-4v14l-5-4H4z', 'M16 9.5a4 4 0 0 1 0 5'],
  controls: ['M3 7h18v10H3z', 'M6 11h1M9 11h1M12 11h1M15 11h1M18 11h1M8 14h8'],
  gameplay: ['M4 3v18', 'M4 5h12l-2 4 2 4H4z'],
  manual: ['M12 20V9', 'M12 9l-4-4M12 9l4-4', 'M13.6 7.4a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z'],
  auto: ['M13 3l-6 10h4l-1 8 7-12h-4z'],
  keys: ['M3 7h18v10H3z', 'M7 11h1M11 11h1M15 11h1M9 14h6'],
  mouse: ['M9 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z', 'M12 7v4'],
  gfx1: ['M5 18v-3'],
  gfx2: ['M5 18v-3M12 18v-7'],
  gfx3: ['M5 18v-3M12 18v-7M19 18v-11'],
  ink: ['M4 20l4-1L19 8l-3-3L5 16z', 'M14 7l3 3', 'M8 19l-3-3'],
  horizon1: ['M3 16h18'],
  horizon2: ['M3 16h18M6 12h12'],
  horizon3: ['M3 16h18M6 12h12M9 8h6'],
  morning: ['M15 15a3 3 0 1 0-6 0', 'M3 18h18', 'M12 7v3M9.5 9.5 11 11M14.5 9.5 13 11'],
  noon: ['M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z', 'M12 3v2M12 19v2M3 12h2M19 12h2'],
  evening: ['M15 15a3 3 0 1 0-6 0', 'M3 18h18', 'M12 10V7M10.5 8.5 12 10l1.5-1.5'],
  midnight: ['M15 3a8 8 0 1 0 5.6 9.6A6.4 6.4 0 0 1 15 3z'],
  clock: ['M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z', 'M12 7.5V12l3 2'],
  radio: ['M3 10h18v9H3z', 'M8 6.5l9-2.5', 'M7 14h4', 'M17 14h.01'],
};

/** One glyph, sized by CSS. Decorative: the control's own text is the label. */
function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'menu-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] ?? []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function formatPlayed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type DriveLayout = 'FWD' | 'RWD' | 'AWD';

const DRIVE_LAYOUTS: readonly { readonly id: DriveLayout; readonly label: string }[] = [
  { id: 'FWD', label: 'FWD — front-wheel drive' },
  { id: 'RWD', label: 'RWD — rear-wheel drive' },
  { id: 'AWD', label: 'AWD — all-wheel drive' },
];

/**
 * What the dev fluid dispenser offers. Capacities mirror `FLUID_STOCK` in
 * world/poi.ts so a dev-spawned can behaves exactly like a found one.
 */
const DEV_FLUIDS: readonly { readonly fluid: FluidKind; readonly capacity: number }[] = [
  { fluid: 'petrol', capacity: 20 },
  { fluid: 'diesel', capacity: 20 },
  { fluid: 'coolant', capacity: 5 },
  { fluid: 'oil', capacity: 5 },
];

export type DevSpawnItemRequest =
  | { readonly type: 'fluid_can'; readonly fluid: FluidKind; readonly capacity: number }
  | { readonly type: 'bubble_gum' }
  | { readonly type: 'binoculars' }
  | { readonly type: 'torchlight' }
  | { readonly type: 'sun_shades'; readonly tint: ShadeTint };

function driveLayout(rearDriveBias: number): DriveLayout {
  if (rearDriveBias <= 0) return 'FWD';
  if (rearDriveBias >= 1) return 'RWD';
  return 'AWD';
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** What the player chose on the pause overlay. */
export type PauseAction = 'resume' | 'save' | 'quit';

/** Everything the pause overlay needs from the game; wired by main. */
export interface PauseHooks {
  settings: () => Settings;
  /** Persist a complete settings object; main pushes it through world.apply. */
  applySettings: (next: Settings) => void;
  /** Apply a time-of-day preset immediately; not part of persisted settings. */
  applyTimePreset: (preset: TimeOfDayPreset) => void;
  /** Apply a view-distance tier immediately; main pushes it to the renderer. */
  applyViewDistance: (v: ViewDistance) => void;
  /**
   * Record a fully fuelled car into the world.
   *
   * Optional, and absent in a production build. Cars are meant to be found in the
   * world and kept: stickers earned by hauling are permanent and do not follow the
   * player to another vehicle, which is worth nothing if a fresh, full-tanked car
   * is one keypress away. It survives as a development tool only — when the hook
   * is absent the button and its whole screen are never built.
   */
  spawnVehicle?: (request: SpawnRequest) => void;
  /**
   * Drop a trailer into the world. Same dev-only reasoning as `spawnVehicle`: a
   * trailer is meant to be found at a gas stop and left at the destination, and a
   * free one on demand makes the whole hauling loop optional. Optional, and absent
   * in a production build — when the hook is absent the button is never built.
   */
  spawnTrailer?: () => void;
  /**
   * Drops a normal world item at the player's feet. Dev-only: the picker exists to
   * exercise fluid cans and bubble-gum packs without bypassing pickup physics.
   */
  spawnItem?: (request: DevSpawnItemRequest) => void;
  /**
   * Flips the driven car — or, on foot, the nearest car or trailer — back onto its
   * wheels. Dev-only: the shipping recovery for a car on its roof is a bubble-gum
   * charge chewed next to it, which costs a consumable and takes eight seconds, and
   * a free instant righting from the pause menu would retire that item. When the
   * hook is absent the button is never built.
   */
  flipVehicle?: () => void;
  /**
   * The LIVE world state, for "Export Save Code".
   *
   * This used to be rebuilt from the two numbers the overlay happens to display
   * (seed and distance) via `newWorldState`, which meant the exported code was a
   * fresh game at that seed: the car, its fitted parts and fuel, the time of day,
   * every dropped part and looted POI were all silently dropped, even though the
   * codec round-trips a whole state. The overlay is handed the real object now.
   */
  exportState: () => WorldState;
}

/** Turns a KeyboardEvent.code into something a human reads: KeyW -> W. */
function formatKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse2') return 'RMB';
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export class MainMenu {
  private pauseOverlay: HTMLElement | null = null;
  private pauseCleanup: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly loading: HTMLElement,
  ) {}

  async show(backend: SaveBackend): Promise<{ seed: number; state: WorldState | null }> {
    return new Promise((resolve) => {
      const overlay = el('div', 'menu menu-title-screen');
      const panel = el('div', 'menu-panel');
      overlay.appendChild(panel);

      const title = el('h1', 'menu-title');
      title.textContent = 'the BRO drive';
      panel.appendChild(title);

      const seedField = el('div', 'menu-field');
      const seedLabel = el('label', 'menu-label');
      seedLabel.textContent = 'Seed';
      const seedInput = input('menu-input');
      seedInput.placeholder = 'blank = random, or any word';
      seedField.append(seedLabel, seedInput);
      panel.appendChild(seedField);

      const newButton = button('menu-button menu-primary', 'New Drive');
      panel.appendChild(newButton);

      const savesSection = el('div', 'menu-saves');
      const savesHeading = el('h2', 'menu-heading');
      savesHeading.textContent = 'Saves';
      const savesList = el('div', 'menu-saves-list');
      const savesEmpty = el('div', 'menu-save-empty');
      savesEmpty.style.display = 'none';
      savesSection.append(savesHeading, savesList, savesEmpty);
      panel.appendChild(savesSection);

      const codeSection = el('div', 'menu-code');
      const codeLabel = el('label', 'menu-label');
      codeLabel.textContent = 'Save Code';
      const codeRow = el('div', 'menu-code-row');
      const codeInput = input('menu-input');
      codeInput.placeholder = 'paste a save code';
      const codeButton = button('menu-button', 'Load');
      codeRow.append(codeInput, codeButton);
      const codeError = el('div', 'menu-error');
      codeSection.append(codeLabel, codeRow, codeError);
      panel.appendChild(codeSection);

      this.root.appendChild(overlay);
      this.loading.classList.add('is-hidden');

      let settled = false;
      const finish = (result: { seed: number; state: WorldState | null }): void => {
        if (settled) return;
        settled = true;
        this.loading.classList.remove('is-hidden');
        overlay.remove();
        resolve(result);
      };
      const showError = (msg: string): void => {
        codeError.textContent = msg;
      };

      const renderSaves = async (): Promise<void> => {
        let saves: SaveMeta[];
        try {
          saves = await backend.list();
        } catch {
          savesList.textContent = '';
          savesEmpty.style.display = '';
          savesEmpty.textContent = 'Saves are unavailable right now.';
          return;
        }
        savesList.textContent = '';
        savesEmpty.textContent = 'No saves yet.';
        savesEmpty.style.display = saves.length === 0 ? '' : 'none';
        for (const meta of saves) {
          const row = el('div', 'menu-save');
          const name = el('span', 'menu-save-name');
          name.textContent = meta.name || 'unnamed drive';
          const info = el('span', 'menu-save-meta');
          info.textContent =
            `${meta.km.toFixed(1)} km · ${formatPlayed(meta.playedSeconds)} · seed ${meta.seed}`;
          const loadBtn = button('menu-button menu-save-load', 'Load');
          const delBtn = button('menu-button menu-save-delete', 'Delete');

          loadBtn.addEventListener('click', () => {
            loadBtn.disabled = true;
            void backend.load(meta.id).then((state) => {
              if (state) {
                finish({ seed: state.seed, state });
              } else {
                loadBtn.disabled = false;
                showError('That save could not be loaded.');
              }
            });
          });
          delBtn.addEventListener('click', () => {
            void backend.remove(meta.id).then(() => void renderSaves());
          });

          row.append(name, info, loadBtn, delBtn);
          savesList.appendChild(row);
        }
      };
      void renderSaves();

      const startNew = (): void => {
        finish({ seed: parseSeed(seedInput.value), state: null });
      };
      newButton.addEventListener('click', startNew);
      seedInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          startNew();
        }
      });

      const loadCode = (): void => {
        const code = codeInput.value.trim();
        if (!code) {
          showError('Paste a save code first.');
          return;
        }
        try {
          const state = decodeSaveCode(code);
          finish({ seed: state.seed, state });
        } catch {
          showError('That is not a valid save code.');
        }
      };
      codeButton.addEventListener('click', loadCode);
      codeInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          loadCode();
        }
      });

      seedInput.focus();
    });
  }

  /**
   * Pause overlay with Settings and Spawn Vehicle sub-screens. One window
   * keydown listener serves the whole pause: it routes Escape by screen and
   * runs key-capture for rebinding. Element listeners live on the overlay, so
   * removePause (which drops the overlay) releases everything except that one
   * window listener, which pauseCleanup removes.
   */
  showPause(info: { seed: number; km: number }, hooks: PauseHooks): Promise<PauseAction> {
    this.removePause();
    return new Promise((resolve) => {
      const overlay = el('div', 'menu menu-pause');
      const panel = el('div', 'menu-panel');
      overlay.appendChild(panel);
      this.root.appendChild(overlay);
      this.pauseOverlay = overlay;

      let settled = false;
      const finish = (action: PauseAction): void => {
        if (settled) return;
        settled = true;
        this.removePause();
        resolve(action);
      };

      // Working copy of the player's settings. hooks.settings() hands out the
      // authoritative object: it is copied on entry, never mutated here, and
      // every change pushes a complete Settings object back through
      // hooks.applySettings (keyBindings re-copied so the applied map is ours).
      const base = hooks.settings();
      const settings: Settings = {
        gearboxMode: base.gearboxMode,
        dayCycleMinutes: base.dayCycleMinutes,
        poiSpacingMetres: base.poiSpacingMetres,
        mouseSensitivity: base.mouseSensitivity,
        masterVolume: base.masterVolume,
        radioVolume: base.radioVolume,
        keyBindings: { ...base.keyBindings },
        graphicsQuality: base.graphicsQuality,
        viewDistance: base.viewDistance,
        msaa: base.msaa,
        inkStrength: base.inkStrength,
        mouseSteering: base.mouseSteering,
      };
      const apply = (): void => {
        hooks.applySettings({
          gearboxMode: settings.gearboxMode,
          dayCycleMinutes: settings.dayCycleMinutes,
          poiSpacingMetres: settings.poiSpacingMetres,
          mouseSensitivity: settings.mouseSensitivity,
          masterVolume: settings.masterVolume,
          radioVolume: settings.radioVolume,
          keyBindings: { ...settings.keyBindings },
          graphicsQuality: settings.graphicsQuality,
          viewDistance: settings.viewDistance,
          msaa: settings.msaa,
          inkStrength: settings.inkStrength,
          mouseSteering: settings.mouseSteering,
        });
      };

      /**
       * Label of the first other action bound to `code`, or null. Two actions may
       * deliberately share a key only when both declare it as a default; F uses
       * that context-sensitive exception for world manipulation and vehicle entry.
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
            return action.label;
          }
        }
        return null;
      };

      type Screen = 'main' | 'settings' | 'spawn' | 'item';
      let screen: Screen = 'main';
      /**
       * Settings section, remembered across visits: someone adjusting the horizon
       * comes back to the horizon, not to the top of a list.
       */
      type SettingsTab = 'drive' | 'display' | 'gameplay' | 'sound' | 'controls';
      let settingsTab: SettingsTab = 'drive';
      /** Action id waiting for a key in capture mode; only set on settings. */
      let capturingActionId: string | null = null;
      /** Feedback line on the settings screen; null while not on settings. */
      let note: HTMLElement | null = null;
      /** Bindings list on the settings screen; null while not on settings. */
      let bindingsList: HTMLElement | null = null;

      const clearNote = (): void => {
        if (!note) return;
        note.textContent = '';
        note.classList.remove('is-alarm');
      };

      const renderBindings = (): void => {
        if (!bindingsList) return;
        bindingsList.textContent = '';
        for (const action of BINDABLE_ACTIONS) {
          const row = button('menu-binding', '');
          const labelSpan = el('span', 'menu-binding-label');
          labelSpan.textContent = action.label;
          const keysSpan = el('span', 'menu-binding-keys');
          if (capturingActionId === action.id) {
            row.classList.add('is-capturing');
            const waiting = el('span', 'menu-keycap is-waiting');
            waiting.textContent = 'press a key';
            keysSpan.appendChild(waiting);
          } else {
            // One cap per key, not a slash-joined string: a boxed glyph is read as a
            // key without being parsed as a sentence, which is the whole point of a
            // twenty-row list nobody wants to read.
            for (const code of settings.keyBindings[action.id] ?? action.defaultKeys) {
              const cap = el('kbd', 'menu-keycap');
              cap.textContent = formatKey(code);
              keysSpan.appendChild(cap);
            }
          }
          row.append(labelSpan, keysSpan);
          row.addEventListener('click', () => {
            // Clicking the armed row again disarms it; clicking any other row
            // moves capture there.
            capturingActionId = capturingActionId === action.id ? null : action.id;
            clearNote();
            renderBindings();
          });
          bindingsList.appendChild(row);
        }
      };

      const showScreen = (next: Screen): void => {
        screen = next;
        if (next !== 'settings') {
          // Leaving settings disarms capture and drops the references to its
          // elements; both are rebuilt from scratch on the next visit.
          capturingActionId = null;
          note = null;
          bindingsList = null;
        }
        panel.classList.toggle('menu-panel-wide', next !== 'main');
        // Settings is the one screen that is two columns wide.
        panel.classList.toggle('menu-panel-settings', next === 'settings');
        if (next === 'main') renderMain();
        else if (next === 'settings') renderSettings();
        else if (next === 'item') renderItem?.();
        else renderSpawn?.();
      };

      const onKey = (ev: KeyboardEvent): void => {
        if (screen === 'settings' && capturingActionId !== null) {
          // Capture mode: the next keydown becomes the binding. Modifier chords
          // stay with the browser (same rule as InputReader) and Escape cancels
          // without closing the menu.
          if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
          ev.preventDefault();
          if (ev.code === 'Escape') {
            capturingActionId = null;
            clearNote();
            renderBindings();
            return;
          }
          const action = BINDABLE_ACTIONS.find((a) => a.id === capturingActionId);
          if (!action) return;
          const holder = holderOf(ev.code, action.id);
          if (holder) {
            // Reject rather than clobber: say who already owns the key.
            if (note) {
              note.textContent = `"${formatKey(ev.code)}" is bound to ${holder}`;
              note.classList.add('is-alarm');
            }
            return;
          }
          settings.keyBindings[action.id] = [ev.code];
          apply();
          capturingActionId = null;
          clearNote();
          renderBindings();
          return;
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          if (screen === 'main') finish('resume');
          else showScreen('main');
        }
      };
      window.addEventListener('keydown', onKey);
      this.pauseCleanup = () => window.removeEventListener('keydown', onKey);

      const renderMain = (): void => {
        panel.textContent = '';

        const title = el('h1', 'menu-title');
        title.textContent = 'Paused';
        panel.appendChild(title);

        const seedBox = el('div', 'menu-seed-display');
        const seedLabel = el('span', 'menu-seed-label');
        seedLabel.textContent = 'Seed';
        const seedValue = el('span', 'menu-seed-value');
        seedValue.textContent = String(info.seed);
        const seedCopy = button('menu-button', 'Copy');
        seedBox.append(seedLabel, seedValue, seedCopy);
        panel.appendChild(seedBox);

        const kmText = el('div', 'menu-pause-km');
        kmText.textContent = `Travelled ${info.km.toFixed(1)} km`;
        panel.appendChild(kmText);

        const resumeBtn = button('menu-button menu-primary', 'Resume');
        const settingsBtn = button('menu-button', 'Settings');
        const saveBtn = button('menu-button', 'Save');
        const exportBtn = button('menu-button', 'Export Save Code');
        const quitBtn = button('menu-button', 'Quit');
        panel.append(resumeBtn, settingsBtn);
        // Dev only, and labelled so a screenshot of it is never mistaken for the
        // shipping menu. `import.meta.env.DEV` is tested first so the branch folds
        // to a constant false in a production build and the label goes with it.
        if (import.meta.env.DEV && hooks.spawnVehicle) {
          const spawnBtn = button('menu-button', 'Spawn Vehicle (dev)');
          spawnBtn.addEventListener('click', () => showScreen('spawn'));
          panel.appendChild(spawnBtn);
        }
        // Same dev-only fold as the car spawn: there is exactly one trailer, so no
        // picker screen — the button is the whole surface, and it only exists when
        // the hook does.
        if (import.meta.env.DEV && hooks.spawnTrailer) {
          const trailerBtn = button('menu-button', 'Spawn Trailer (dev)');
          trailerBtn.addEventListener('click', () => {
            hooks.spawnTrailer?.();
            finish('resume');
          });
          panel.appendChild(trailerBtn);
        }
        // World items share one picker: fluid cans plus the five-charge gum pack.
        if (import.meta.env.DEV && hooks.spawnItem) {
          const itemBtn = button('menu-button', 'Spawn Item (dev)');
          itemBtn.addEventListener('click', () => showScreen('item'));
          panel.appendChild(itemBtn);
        }
        // No picker for this one either: the target is whatever the player is in or
        // standing next to, decided by main, so the button is the whole surface.
        if (import.meta.env.DEV && hooks.flipVehicle) {
          const flipBtn = button('menu-button', 'Flip Car (dev)');
          flipBtn.addEventListener('click', () => {
            hooks.flipVehicle?.();
            finish('resume');
          });
          panel.appendChild(flipBtn);
        }
        panel.append(saveBtn, exportBtn, quitBtn);

        resumeBtn.addEventListener('click', () => finish('resume'));
        settingsBtn.addEventListener('click', () => showScreen('settings'));
        saveBtn.addEventListener('click', () => finish('save'));
        quitBtn.addEventListener('click', () => finish('quit'));

        seedCopy.addEventListener('click', () => {
          void copyText(String(info.seed)).then((ok) => {
            seedCopy.textContent = ok ? 'Copied' : 'Copy failed';
            window.setTimeout(() => {
              seedCopy.textContent = 'Copy';
            }, 1500);
          });
        });

        exportBtn.addEventListener('click', () => {
          const code = encodeSaveCode(hooks.exportState());
          void copyText(code).then((ok) => {
            exportBtn.textContent = ok ? 'Copied' : 'Copy failed';
            window.setTimeout(() => {
              exportBtn.textContent = 'Export Save Code';
            }, 1500);
          });
        });

        resumeBtn.focus();
      };

      /**
       * Settings, as four short sections behind an icon rail.
       *
       * What this replaces was one flat column: nine controls and twenty key bindings
       * in a single scroll, every row the same shape, and every option's explanatory
       * sentence on screen at once. It could only be read, never scanned.
       *
       * Three rules do the work here:
       *  - Sections, so driving settings are not adjacent to volume sliders.
       *  - ONE hint line, at a fixed height, describing whatever is hovered, focused
       *    or selected. Nine sentences become one, and the layout never jumps when it
       *    changes.
       *  - A glyph per option, carrying the axis (bars for quality, receding ridges
       *    for a horizon, the sun's height for time) so the row is scannable.
       *
       * Nothing here previews live. The whole loop — simulation and renderer — is
       * stopped while the overlay is up, so a graphics or horizon change cannot be
       * seen until Resume. An earlier version faded the panel to "show" the effect,
       * which showed a frozen frame and taught the player nothing.
       */
      const renderSettings = (): void => {
        panel.textContent = '';

        const head = el('div', 'menu-settings-head');
        const backBtn = button('menu-button menu-back', 'Back');
        backBtn.addEventListener('click', () => showScreen('main'));
        const title = el('h1', 'menu-title');
        title.textContent = 'Settings';
        head.append(backBtn, title);
        panel.appendChild(head);

        const layout = el('div', 'menu-settings');
        const rail = el('div', 'menu-rail');
        const pane = el('div', 'menu-pane');
        layout.append(rail, pane);
        panel.appendChild(layout);

        // The hint line doubles as the rebinding conflict line (`note`), so a
        // rejected key lands where the player is already looking.
        note = el('div', 'menu-note menu-hint');
        panel.appendChild(note);

        const setHint = (text: string): void => {
          if (!note) return;
          note.textContent = text;
          note.classList.remove('is-alarm');
        };

        /**
         * One option of a segmented control. `active`/`pick` rather than a generic
         * value type: some rows select persisted state, and the time-of-day row
         * selects nothing at all (it fires and forgets), and both are the same widget.
         */
        interface SegOption {
          readonly label: string;
          readonly icon: string;
          readonly hint: string;
          readonly active: () => boolean;
          readonly pick: () => void;
        }

        const segmented = (labelText: string, options: readonly SegOption[]): HTMLElement => {
          const field = el('div', 'menu-field');
          const fieldHead = el('div', 'menu-field-head');
          const label = el('span', 'menu-label');
          label.textContent = labelText;
          fieldHead.append(label);
          const row = el('div', 'menu-seg');
          const buttons = options.map((option) => {
            const btn = button('menu-seg-btn', '');
            const text = el('span', 'menu-seg-label');
            text.textContent = option.label;
            btn.append(icon(option.icon), text);
            row.appendChild(btn);
            return { option, btn };
          });
          const selectedHint = (): string =>
            options.find((o) => o.active())?.hint ?? options[0]?.hint ?? '';
          const paint = (): void => {
            for (const { option, btn } of buttons) {
              btn.classList.toggle('is-selected', option.active());
            }
          };
          for (const [index, entry] of buttons.entries()) {
            entry.btn.addEventListener('click', () => {
              entry.option.pick();
              paint();
              setHint(entry.option.hint);
            });
            // Hover and focus preview their own option's hint; leaving restores the
            // selected one, so the line always describes something real.
            entry.btn.addEventListener('pointerenter', () => setHint(entry.option.hint));
            entry.btn.addEventListener('focus', () => setHint(entry.option.hint));
            entry.btn.addEventListener('blur', () => setHint(selectedHint()));
            entry.btn.addEventListener('keydown', (ev) => {
              // Left/right walks the row, the way a segmented control should: the
              // whole screen is reachable without a mouse.
              const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
              if (step === 0) return;
              ev.preventDefault();
              const next = buttons[(index + step + buttons.length) % buttons.length];
              next.btn.focus();
            });
          }
          paint();
          row.addEventListener('pointerleave', () => setHint(selectedHint()));
          field.append(fieldHead, row);
          return field;
        };

        const sliderField = (
          labelText: string,
          iconName: string,
          hint: string,
          min: number,
          max: number,
          step: number,
          get: () => number,
          format: (value: number) => string,
          set: (value: number) => void,
        ): HTMLElement => {
          const field = el('div', 'menu-field');
          const fieldHead = el('div', 'menu-field-head');
          const sliderId = `settings-${labelText.toLowerCase().replaceAll(' ', '-')}`;
          const label = el('label', 'menu-label');
          label.textContent = labelText;
          label.setAttribute('for', sliderId);
          // The value rides in the head as a chip instead of taking its own column,
          // which is what let four sliders become four scannable rows.
          const chip = el('output', 'menu-chip');
          fieldHead.append(icon(iconName), label, chip);
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.id = sliderId;
          slider.className = 'menu-slider';
          slider.min = String(min);
          slider.max = String(max);
          slider.step = String(step);
          const paint = (): void => {
            slider.value = String(get());
            chip.textContent = format(get());
          };
          slider.addEventListener('input', () => {
            set(slider.valueAsNumber);
            paint();
            apply();
          });
          slider.addEventListener('pointerenter', () => setHint(hint));
          slider.addEventListener('focus', () => setHint(hint));
          paint();
          field.append(fieldHead, slider);
          return field;
        };

        const renderDrive = (): void => {
          pane.append(
            segmented('Gearbox', [
              {
                label: 'Manual',
                icon: 'manual',
                hint: 'Four speeds and a clutch you do not have to think about. X and Z shift.',
                active: () => settings.gearboxMode === 'manual',
                pick: () => {
                  settings.gearboxMode = 'manual';
                  apply();
                },
              },
              {
                label: 'Automatic',
                icon: 'auto',
                hint: 'The box shifts for you. X and Z still override it.',
                active: () => settings.gearboxMode === 'automatic',
                pick: () => {
                  settings.gearboxMode = 'automatic';
                  apply();
                },
              },
            ]),
            segmented('Steering', [
              {
                label: 'Keys',
                icon: 'keys',
                hint: 'A and D steer. The mouse is the camera.',
                active: () => !settings.mouseSteering,
                pick: () => {
                  settings.mouseSteering = false;
                  apply();
                },
              },
              {
                label: 'Mouse',
                icon: 'mouse',
                hint: 'Mouse steers, left button throttle, right brake. Hold the wheel-press to look around.',
                active: () => settings.mouseSteering,
                pick: () => {
                  settings.mouseSteering = true;
                  apply();
                },
              },
            ]),
          );
        };

        const renderDisplay = (): void => {
          // Nothing here previews: the simulation and the renderer are both stopped
          // while the pause overlay is up, so graphics and horizon changes are only
          // seen after Resume. Saying so in the hint is honest; fading the panel to
          // show a frozen frame was not.
          pane.append(
            segmented('Graphics', [
              {
                label: 'Acceptable',
                icon: 'gfx1',
                hint: 'Starts at 60% of native and may scale lower. For weak GPUs.',
                active: () => settings.graphicsQuality === 'acceptable',
                pick: () => {
                  settings.graphicsQuality = 'acceptable';
                  apply();
                },
              },
              {
                label: 'Standard',
                icon: 'gfx2',
                hint: 'Native resolution with adaptive protection for frame rate.',
                active: () => settings.graphicsQuality === 'standard',
                pick: () => {
                  settings.graphicsQuality = 'standard';
                  apply();
                },
              },
              {
                label: 'Blessing',
                icon: 'gfx3',
                hint: 'Locks up to 2x native resolution per axis. No adaptive downscaling.',
                active: () => settings.graphicsQuality === 'blessing',
                pick: () => {
                  settings.graphicsQuality = 'blessing';
                  apply();
                },
              },
            ]),
            segmented('Horizon', [
              {
                label: '1.5 km',
                icon: 'horizon1',
                hint: 'Near: the authored horizon, and the cheapest. Applies on resume.',
                active: () => settings.viewDistance === 'near',
                pick: () => {
                  settings.viewDistance = 'near';
                  apply();
                  hooks.applyViewDistance('near');
                },
              },
              {
                label: '8 km',
                icon: 'horizon2',
                hint: 'Far: a deep horizon with real ranges in it. Needs a GPU with headroom.',
                active: () => settings.viewDistance === 'far',
                pick: () => {
                  settings.viewDistance = 'far';
                  apply();
                  hooks.applyViewDistance('far');
                },
              },
              {
                label: '25 km',
                icon: 'horizon3',
                hint: 'Vast: extravagant, and priced accordingly. For fast GPUs.',
                active: () => settings.viewDistance === 'vast',
                pick: () => {
                  settings.viewDistance = 'vast';
                  apply();
                  hooks.applyViewDistance('vast');
                },
              },
            ]),
            segmented('MSAA', [
              {
                label: 'On',
                icon: 'gfx3',
                hint: 'Four-sample smoothing for geometry edges. Expensive on integrated GPUs.',
                active: () => settings.msaa,
                pick: () => {
                  settings.msaa = true;
                  apply();
                },
              },
              {
                label: 'Off',
                icon: 'gfx1',
                hint: 'No multisampling. Resolution scaling and post-process outlines still apply.',
                active: () => !settings.msaa,
                pick: () => {
                  settings.msaa = false;
                  apply();
                },
              },
            ]),
            sliderField(
              'Ink',
              'ink',
              'Amount of drawn outline in the landscape shader. Applies on resume.',
              0,
              1,
              0.05,
              () => settings.inkStrength,
              (value) => `${Math.round(value * 100)}%`,
              (value) => {
                settings.inkStrength = value;
              },
            ),
          );
        };

        const renderGameplay = (): void => {
          pane.append(
            segmented(
              'Time of Day',
              (Object.keys(TIME_OF_DAY_PRESETS) as TimeOfDayPreset[]).map((preset) => ({
                label: preset.charAt(0).toUpperCase() + preset.slice(1),
                icon: preset,
                hint: `Move the sun to ${preset}. The clock keeps running from there.`,
                active: () => false,
                pick: () => hooks.applyTimePreset(preset),
              })),
            ),
            sliderField(
              'Day Length',
              'clock',
              'Real minutes for one full day and night.',
              DAY_CYCLE_MIN_MINUTES,
              DAY_CYCLE_MAX_MINUTES,
              1,
              () => settings.dayCycleMinutes,
              (value) => `${Math.round(value)} min`,
              (value) => {
                settings.dayCycleMinutes = value;
              },
            ),
            sliderField(
              'POI Distance',
              'gameplay',
              'Metres between roadside stop slots. The current road rebuilds after Resume.',
              POI_SPACING_MIN_METRES,
              POI_SPACING_MAX_METRES,
              POI_SPACING_STEP_METRES,
              () => settings.poiSpacingMetres,
              (value) => `${(value / 1000).toFixed(value < 1000 ? 1 : value % 1000 === 0 ? 0 : 1)} km`,
              (value) => {
                settings.poiSpacingMetres = value;
              },
            ),
          );
        };

        const renderSound = (): void => {
          pane.append(
            sliderField(
              'Game Sound',
              'sound',
              'Engine, wind, tyres and foley. The radio has its own.',
              0,
              1,
              0.01,
              () => settings.masterVolume,
              (value) => `${Math.round(value * 100)}%`,
              (value) => {
                settings.masterVolume = value;
              },
            ),
            sliderField(
              'Radio',
              'radio',
              'Broadcast material, at whatever level the station mastered it.',
              0,
              1,
              0.01,
              () => settings.radioVolume,
              (value) => `${Math.round(value * 100)}%`,
              (value) => {
                settings.radioVolume = value;
              },
            ),
          );
        };

        const renderControls = (): void => {
          pane.appendChild(
            sliderField(
              'Mouse Look',
              'mouse',
              'Pointer sensitivity for looking around. Mouse steering has its own fixed gain.',
              MOUSE_SENSITIVITY_MIN,
              MOUSE_SENSITIVITY_MAX,
              0.0001,
              () => settings.mouseSensitivity,
              (value) => `${Math.round((value / DEFAULT_MOUSE_SENSITIVITY) * 100)}%`,
              (value) => {
                settings.mouseSensitivity = value;
              },
            ),
          );

          const bindField = el('div', 'menu-field');
          const bindHead = el('div', 'menu-field-head');
          const bindLabel = el('span', 'menu-label');
          bindLabel.textContent = 'Key Bindings';
          const resetBtn = button('menu-button menu-reset', 'Reset');
          resetBtn.addEventListener('click', () => {
            settings.keyBindings = {};
            apply();
            setHint('Every binding is back to its default.');
            renderBindings();
          });
          bindHead.append(icon('controls'), bindLabel, resetBtn);
          // Two columns: the list is 5% of the visits and was 70% of the height.
          bindingsList = el('div', 'menu-bindings');
          bindField.append(bindHead, bindingsList);
          pane.appendChild(bindField);
          renderBindings();
        };

        const TABS: readonly {
          readonly id: SettingsTab;
          readonly label: string;
          readonly icon: string;
          readonly hint: string;
          readonly render: () => void;
        }[] = [
          {
            id: 'drive',
            label: 'Drive',
            icon: 'drive',
            hint: 'How the car is driven.',
            render: renderDrive,
          },
          {
            id: 'display',
            label: 'Display',
            icon: 'display',
            hint: 'What is drawn, and how far into the desert it reaches.',
            render: renderDisplay,
          },
          {
            id: 'gameplay',
            label: 'Gameplay',
            icon: 'gameplay',
            hint: 'Time flow and the spacing between roadside stops.',
            render: renderGameplay,
          },
          {
            id: 'sound',
            label: 'Sound',
            icon: 'sound',
            hint: 'Levels for the car and the radio.',
            render: renderSound,
          },
          {
            id: 'controls',
            label: 'Controls',
            icon: 'controls',
            hint: 'The mouse, and every key.',
            render: renderControls,
          },
        ];

        const railButtons = TABS.map((tab) => {
          const btn = button('menu-rail-btn', '');
          const text = el('span', 'menu-rail-label');
          text.textContent = tab.label;
          btn.append(icon(tab.icon), text);
          rail.appendChild(btn);
          return { tab, btn };
        });

        const showTab = (id: SettingsTab): void => {
          settingsTab = id;
          // Capture cannot survive leaving the section that owns it.
          capturingActionId = null;
          bindingsList = null;
          pane.textContent = '';
          for (const { tab, btn } of railButtons) {
            btn.classList.toggle('is-selected', tab.id === id);
          }
          const active = TABS.find((t) => t.id === id) ?? TABS[0];
          active.render();
          setHint(active.hint);
        };

        for (const [index, entry] of railButtons.entries()) {
          entry.btn.addEventListener('click', () => showTab(entry.tab.id));
          entry.btn.addEventListener('keydown', (ev) => {
            const step = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
            if (step === 0) return;
            ev.preventDefault();
            const next = railButtons[(index + step + railButtons.length) % railButtons.length];
            next.btn.focus();
            showTab(next.tab.id);
          });
        }

        showTab(settingsTab);
        backBtn.focus();
      };

      // Spawn selection resets per pause, so every visit starts at the first model.
      let spawnModelId = CAR_MODELS[0].id;

      // The screen itself is unconditional; only the reference below is gated, so
      // the body keeps its indentation and `import.meta.env.DEV` still folds to a
      // constant. In production `renderSpawn` is null, `renderSpawnScreen` becomes
      // unreferenced, and the minifier drops the screen, its labels and
      // `CAR_MODELS` together.
      const renderSpawnScreen = (): void => {
        panel.textContent = '';

        const backBtn = button('menu-button', 'Back');
        backBtn.addEventListener('click', () => showScreen('main'));
        panel.appendChild(backBtn);

        const title = el('h1', 'menu-title');
        title.textContent = 'Spawn Vehicle';
        panel.appendChild(title);

        const modelField = el('div', 'menu-field');
        const modelLabel = el('label', 'menu-label');
        modelLabel.textContent = 'Model';
        const modelList = el('div', 'menu-body-list');
        const paintModels = (): void => {
          modelList.textContent = '';
          for (const layout of DRIVE_LAYOUTS) {
            const models = CAR_MODELS.filter(
              (def) => driveLayout(def.rearDriveBias) === layout.id,
            );
            if (models.length === 0) continue;

            const heading = el('div', 'menu-body-group');
            heading.textContent = layout.label;
            modelList.appendChild(heading);

            for (const def of models) {
              const row = button('menu-body', '');
              const name = el('span', 'menu-body-label');
              name.textContent = def.label;
              row.append(name);

              // Fuel badge. Only diesels are marked: petrol is the default across
              // the catalogue, so badging every petrol car would be twenty chips
              // saying nothing. What matters is spotting the handful that will
              // refuse a petrol can, before you drive one into the desert.
              if (modelEngine(def).fuel === 'diesel') {
                const fuel = el('span', 'menu-body-fuel');
                fuel.textContent = 'D';
                fuel.title = 'diesel';
                row.append(fuel);
              }

              const cls = el('span', 'menu-body-class');
              cls.textContent = def.bodyClass;
              row.append(cls);
              if (def.id === spawnModelId) row.classList.add('is-selected');
              row.addEventListener('click', () => {
                spawnModelId = def.id;
                paintModels();
                paintNote();
              });
              modelList.appendChild(row);
            }
          }
        };
        paintModels();
        modelField.append(modelLabel, modelList);
        panel.appendChild(modelField);

        const spawnNote = el('div', 'menu-note');
        const paintNote = (): void => {
          const def = CAR_MODELS.find((m) => m.id === spawnModelId);
          if (!def) {
            spawnNote.textContent = spawnModelId;
            return;
          }
          // The note spells the fuel out in full, since 'D' is only legible once
          // you already know what it means.
          const fuel = modelEngine(def).fuel;
          spawnNote.textContent = `${def.label} (${def.bodyClass}, ${fuel})`;
        };
        paintNote();
        panel.appendChild(spawnNote);

        const confirmBtn = button('menu-button menu-primary', 'Spawn');
        confirmBtn.addEventListener('click', () => {
          hooks.spawnVehicle?.({ modelId: spawnModelId });
          finish('resume');
        });
        panel.appendChild(confirmBtn);

        backBtn.focus();
      };
      const renderSpawn: (() => void) | null = import.meta.env.DEV ? renderSpawnScreen : null;

      /**
       * Dev item dispenser. Fluid capacities mirror gas-stop stock; bubble gum uses
       * the same five-charge pack found there. Every row drops a real world pickup.
       */
      const renderItemScreen = (): void => {
        panel.textContent = '';

        const backBtn = button('menu-button', 'Back');
        backBtn.addEventListener('click', () => showScreen('main'));
        panel.appendChild(backBtn);

        const title = el('h1', 'menu-title');
        title.textContent = 'Spawn Item';
        panel.appendChild(title);

        const list = el('div', 'menu-body-list');
        for (const spec of DEV_FLUIDS) {
          const row = button('menu-body', '');
          const name = el('span', 'menu-body-label');
          name.textContent = spec.fluid;
          row.append(name);
          if (spec.fluid === 'diesel') {
            const badge = el('span', 'menu-body-fuel');
            badge.textContent = 'D';
            badge.title = 'diesel';
            row.append(badge);
          }
          const cap = el('span', 'menu-body-class');
          cap.textContent = `${spec.capacity} L`;
          row.append(cap);
          row.addEventListener('click', () => {
            hooks.spawnItem?.({ type: 'fluid_can', fluid: spec.fluid, capacity: spec.capacity });
            finish('resume');
          });
          list.appendChild(row);
        }

        const gumRow = button('menu-body', '');
        const gumName = el('span', 'menu-body-label');
        gumName.textContent = 'bubble gum pack';
        const gumCount = el('span', 'menu-body-class');
        gumCount.textContent = '5 charges';
        gumRow.append(gumName, gumCount);
        gumRow.addEventListener('click', () => {
          hooks.spawnItem?.({ type: 'bubble_gum' });
          finish('resume');
        });
        list.appendChild(gumRow);

        const equipment: readonly {
          readonly label: string;
          readonly detail: string;
          readonly request: DevSpawnItemRequest;
        }[] = [
          { label: 'binoculars', detail: 'E toggle · 10x', request: { type: 'binoculars' } },
          { label: 'torchlight', detail: 'E toggle beam', request: { type: 'torchlight' } },
          { label: 'green sun shades', detail: 'E equip · G remove', request: { type: 'sun_shades', tint: 'green' } },
          { label: 'yellow sun shades', detail: 'E equip · G remove', request: { type: 'sun_shades', tint: 'yellow' } },
          { label: 'red sun shades', detail: 'E equip · G remove', request: { type: 'sun_shades', tint: 'red' } },
        ];
        for (const spec of equipment) {
          const row = button('menu-body', '');
          const name = el('span', 'menu-body-label');
          name.textContent = spec.label;
          const detail = el('span', 'menu-body-class');
          detail.textContent = spec.detail;
          row.append(name, detail);
          row.addEventListener('click', () => {
            hooks.spawnItem?.(spec.request);
            finish('resume');
          });
          list.appendChild(row);
        }
        panel.appendChild(list);

        const note = el('div', 'menu-note');
        note.textContent = 'selected item drops at your feet';
        panel.appendChild(note);

        backBtn.focus();
      };
      const renderItem: (() => void) | null = import.meta.env.DEV ? renderItemScreen : null;

      showScreen('main');
    });
  }

  hidePause(): void {
    this.removePause();
  }

  private removePause(): void {
    if (this.pauseCleanup) {
      this.pauseCleanup();
      this.pauseCleanup = null;
    }
    if (this.pauseOverlay) {
      this.pauseOverlay.remove();
      this.pauseOverlay = null;
    }
  }
}
