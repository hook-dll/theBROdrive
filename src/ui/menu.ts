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
  TIME_OF_DAY_PRESETS,
} from '../game/settings';
import type { Settings, TimeOfDayPreset } from '../game/settings';
import type { SpawnRequest } from '../game/spawn';
import { SPAWNABLE_CAR_MODELS } from '../vehicle/carmodels';

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

function formatPlayed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
  /** Record a freshly assembled, fully fuelled car into the world. */
  spawnVehicle: (request: SpawnRequest) => void;
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

  constructor(private readonly root: HTMLElement) {}

  async show(backend: SaveBackend): Promise<{ seed: number; state: WorldState | null }> {
    return new Promise((resolve) => {
      const overlay = el('div', 'menu');
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

      let settled = false;
      const finish = (result: { seed: number; state: WorldState | null }): void => {
        if (settled) return;
        settled = true;
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
        mouseSensitivity: base.mouseSensitivity,
        masterVolume: base.masterVolume,
        radioVolume: base.radioVolume,
        keyBindings: { ...base.keyBindings },
      };
      const apply = (): void => {
        hooks.applySettings({
          gearboxMode: settings.gearboxMode,
          dayCycleMinutes: settings.dayCycleMinutes,
          mouseSensitivity: settings.mouseSensitivity,
          masterVolume: settings.masterVolume,
          radioVolume: settings.radioVolume,
          keyBindings: { ...settings.keyBindings },
        });
      };

      /** Label of the first other action bound to `code`, or null. */
      const holderOf = (code: string, exceptActionId: string): string | null => {
        for (const action of BINDABLE_ACTIONS) {
          if (
            action.id !== exceptActionId &&
            (settings.keyBindings[action.id] ?? action.defaultKeys).includes(code)
          ) {
            return action.label;
          }
        }
        return null;
      };

      type Screen = 'main' | 'settings' | 'spawn';
      let screen: Screen = 'main';
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
            keysSpan.textContent = 'press a key…';
          } else {
            keysSpan.textContent = (settings.keyBindings[action.id] ?? action.defaultKeys)
              .map(formatKey)
              .join(' / ');
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
        if (next === 'main') renderMain();
        else if (next === 'settings') renderSettings();
        else renderSpawn();
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
        const spawnBtn = button('menu-button', 'Spawn Vehicle');
        const saveBtn = button('menu-button', 'Save');
        const exportBtn = button('menu-button', 'Export Save Code');
        const quitBtn = button('menu-button', 'Quit');
        panel.append(resumeBtn, settingsBtn, spawnBtn, saveBtn, exportBtn, quitBtn);

        resumeBtn.addEventListener('click', () => finish('resume'));
        settingsBtn.addEventListener('click', () => showScreen('settings'));
        spawnBtn.addEventListener('click', () => showScreen('spawn'));
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

      const renderSettings = (): void => {
        panel.textContent = '';

        const backBtn = button('menu-button', 'Back');
        backBtn.addEventListener('click', () => showScreen('main'));
        panel.appendChild(backBtn);

        const title = el('h1', 'menu-title');
        title.textContent = 'Settings';
        panel.appendChild(title);

        // Gearbox: a two-way toggle; the active side is re-painted in place so
        // focus is not disturbed on every change.
        const gearField = el('div', 'menu-field');
        const gearLabel = el('label', 'menu-label');
        gearLabel.textContent = 'Gearbox';
        const gearRow = el('div', 'menu-toggle-row');
        const manualBtn = button('menu-button', 'Manual');
        const autoBtn = button('menu-button', 'Automatic');
        const paintGearbox = (): void => {
          manualBtn.classList.toggle('is-selected', settings.gearboxMode === 'manual');
          autoBtn.classList.toggle('is-selected', settings.gearboxMode === 'automatic');
        };
        paintGearbox();
        manualBtn.addEventListener('click', () => {
          settings.gearboxMode = 'manual';
          paintGearbox();
          apply();
        });
        autoBtn.addEventListener('click', () => {
          settings.gearboxMode = 'automatic';
          paintGearbox();
          apply();
        });
        gearRow.append(manualBtn, autoBtn);
        gearField.append(gearLabel, gearRow);
        panel.appendChild(gearField);

        // Time of day: presets apply immediately through their own hook and are
        // not part of the persisted settings object.
        const todField = el('div', 'menu-field');
        const todLabel = el('label', 'menu-label');
        todLabel.textContent = 'Time of Day';
        const presetRow = el('div', 'menu-toggle-row');
        for (const preset of Object.keys(TIME_OF_DAY_PRESETS) as TimeOfDayPreset[]) {
          const presetBtn = button('menu-button', preset.charAt(0).toUpperCase() + preset.slice(1));
          presetBtn.addEventListener('click', () => {
            hooks.applyTimePreset(preset);
            if (note) {
              note.textContent = `${presetBtn.textContent} applied`;
              note.classList.remove('is-alarm');
            }
          });
          presetRow.appendChild(presetBtn);
        }
        todField.append(todLabel, presetRow);
        panel.appendChild(todField);

        const sliderField = (
          label: string,
          min: number,
          max: number,
          step: number,
          get: () => number,
          format: (value: number) => string,
          set: (value: number) => void,
        ): HTMLElement => {
          const field = el('div', 'menu-field');
          const fieldLabel = el('label', 'menu-label');
          fieldLabel.textContent = label;
          const sliderId = `settings-${label.toLowerCase().replaceAll(' ', '-')}`;
          fieldLabel.setAttribute('for', sliderId);
          const row = el('div', 'menu-slider-row');
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.id = sliderId;
          slider.className = 'menu-slider';
          slider.min = String(min);
          slider.max = String(max);
          slider.step = String(step);
          slider.value = String(get());
          const value = el('output', 'menu-slider-value');
          const paint = (): void => {
            slider.value = String(get());
            value.textContent = format(get());
          };
          slider.addEventListener('input', () => {
            set(slider.valueAsNumber);
            paint();
            apply();
          });
          paint();
          row.append(slider, value);
          field.append(fieldLabel, row);
          return field;
        };

        panel.appendChild(
          sliderField(
            'Day Cycle Length',
            DAY_CYCLE_MIN_MINUTES,
            DAY_CYCLE_MAX_MINUTES,
            1,
            () => settings.dayCycleMinutes,
            (value) => `${Math.round(value)} min`,
            (value) => {
              settings.dayCycleMinutes = value;
            },
          ),
        );
        panel.appendChild(
          sliderField(
            'Mouse Look Sensitivity',
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
        panel.appendChild(
          sliderField(
            'Sound Volume',
            0,
            1,
            0.01,
            () => settings.masterVolume,
            (value) => `${Math.round(value * 100)}%`,
            (value) => {
              settings.masterVolume = value;
            },
          ),
        );
        panel.appendChild(
          sliderField(
            'Radio Volume',
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

        // Key bindings: one row per action; click a row to arm capture.
        const bindField = el('div', 'menu-field');
        const bindLabel = el('label', 'menu-label');
        bindLabel.textContent = 'Key Bindings';
        bindingsList = el('div', 'menu-bindings');
        bindField.append(bindLabel, bindingsList);
        panel.appendChild(bindField);

        const resetBtn = button('menu-button', 'Reset to Defaults');
        resetBtn.addEventListener('click', () => {
          settings.keyBindings = {};
          apply();
          clearNote();
          renderBindings();
        });
        panel.appendChild(resetBtn);

        note = el('div', 'menu-note');
        panel.appendChild(note);

        renderBindings();

        backBtn.focus();
      };

      // Spawn selection resets per pause, so every visit starts at the first model.
      let spawnModelId = SPAWNABLE_CAR_MODELS[0].id;

      const renderSpawn = (): void => {
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
          for (const def of SPAWNABLE_CAR_MODELS) {
            const row = button('menu-body', '');
            const name = el('span', 'menu-body-label');
            name.textContent = def.label;
            const cls = el('span', 'menu-body-class');
            cls.textContent = def.bodyClass;
            row.append(name, cls);
            if (def.id === spawnModelId) row.classList.add('is-selected');
            row.addEventListener('click', () => {
              spawnModelId = def.id;
              paintModels();
              paintNote();
            });
            modelList.appendChild(row);
          }
        };
        paintModels();
        modelField.append(modelLabel, modelList);
        panel.appendChild(modelField);

        const spawnNote = el('div', 'menu-note');
        const paintNote = (): void => {
          const def = SPAWNABLE_CAR_MODELS.find((m) => m.id === spawnModelId);
          spawnNote.textContent = def ? `${def.label} (${def.bodyClass})` : spawnModelId;
        };
        paintNote();
        panel.appendChild(spawnNote);

        const confirmBtn = button('menu-button menu-primary', 'Spawn');
        confirmBtn.addEventListener('click', () => {
          hooks.spawnVehicle({ modelId: spawnModelId });
          finish('resume');
        });
        panel.appendChild(confirmBtn);

        backBtn.focus();
      };

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
