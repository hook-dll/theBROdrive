import type { SaveBackend, SaveMeta } from '../save/save';
import { parseSeed, decodeSaveCode, encodeSaveCode } from '../save/save';
import { newWorldState } from '../game/state';
import type { WorldState } from '../game/state';

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

function buildExportState(seed: number, km: number): WorldState {
  // The pause overlay only holds seed + distance, so the exported code captures
  // exactly what can be recovered here: a fresh state at this seed with the
  // personal record and current arclength restored to the travelled distance.
  const state = newWorldState(seed);
  const metres = Math.round(km * 1000);
  state.recordS = metres;
  state.player.s = metres;
  return state;
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

  showPause(info: { seed: number; km: number }): Promise<'resume' | 'save' | 'quit'> {
    this.removePause();
    return new Promise((resolve) => {
      const overlay = el('div', 'menu menu-pause');
      const panel = el('div', 'menu-panel');
      overlay.appendChild(panel);

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
      const saveBtn = button('menu-button', 'Save');
      const exportBtn = button('menu-button', 'Export Save Code');
      const quitBtn = button('menu-button', 'Quit');
      panel.append(resumeBtn, saveBtn, exportBtn, quitBtn);

      this.root.appendChild(overlay);
      this.pauseOverlay = overlay;

      let settled = false;
      const finish = (action: 'resume' | 'save' | 'quit'): void => {
        if (settled) return;
        settled = true;
        this.removePause();
        resolve(action);
      };

      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          finish('resume');
        }
      };
      window.addEventListener('keydown', onKey);
      this.pauseCleanup = () => window.removeEventListener('keydown', onKey);

      resumeBtn.addEventListener('click', () => finish('resume'));
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
        const code = encodeSaveCode(buildExportState(info.seed, info.km));
        void copyText(code).then((ok) => {
          exportBtn.textContent = ok ? 'Copied' : 'Copy failed';
          window.setTimeout(() => {
            exportBtn.textContent = 'Export Save Code';
          }, 1500);
        });
      });

      resumeBtn.focus();
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
