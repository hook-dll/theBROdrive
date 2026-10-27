import type { RaceReadout } from '../race/director';

/**
 * THE RACE ON THE HUD (race/director.ts `RaceReadout`), for a boy who can barely read:
 *
 *  - the COUNTDOWN in the middle of the screen, big: "3", "2", "1" with the red lights,
 *    then a green "GO!";
 *  - while racing, a chip under the toasts: "LAP 2/3" and the place, "1st" in gold or
 *    "2nd" in grey;
 *  - the RESULT banner across the middle: "YOU WIN!" in gold, anything else plain.
 *
 * Plain DOM, built once; `set` touches an element only when what it shows changes.
 */
export class RaceHud {
  readonly el: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly chipEl: HTMLElement;
  private readonly lapEl: HTMLElement;
  private readonly placeEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private shownCount = '';
  private shownLap = '';
  private shownPlace = 0;
  private shownBanner: string | null = null;
  private shownActive = false;
  private shownRacing = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hud-race is-hidden';
    this.countEl = document.createElement('div');
    this.countEl.className = 'hud-race-count is-hidden';
    this.chipEl = document.createElement('div');
    this.chipEl.className = 'hud-race-chip is-hidden';
    this.lapEl = document.createElement('span');
    this.lapEl.className = 'hud-race-lap';
    this.placeEl = document.createElement('span');
    this.placeEl.className = 'hud-race-place';
    this.chipEl.append(this.lapEl, this.placeEl);
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'hud-race-banner is-hidden';
    this.el.append(this.countEl, this.chipEl, this.bannerEl);
  }

  set(r: RaceReadout): void {
    if (r.active !== this.shownActive) {
      this.shownActive = r.active;
      this.el.classList.toggle('is-hidden', !r.active);
    }
    if (!r.active) return;
    // 1-3 red lights are "3", "2", "1"; the green is "GO!" for a moment.
    const count = r.lights >= 1 && r.lights <= 3 ? String(4 - r.lights) : r.go ? 'GO!' : '';
    if (count !== this.shownCount) {
      this.shownCount = count;
      this.countEl.textContent = count;
      this.countEl.classList.toggle('is-hidden', count === '');
      this.countEl.classList.toggle('is-go', count === 'GO!');
    }
    if (r.racing !== this.shownRacing) {
      this.shownRacing = r.racing;
      this.chipEl.classList.toggle('is-hidden', !r.racing);
    }
    if (r.racing) {
      const lap = `LAP ${r.lap}/${r.laps}`;
      if (lap !== this.shownLap) {
        this.shownLap = lap;
        this.lapEl.textContent = lap;
      }
      if (r.position !== this.shownPlace) {
        this.shownPlace = r.position;
        this.placeEl.textContent = r.position === 1 ? '1st' : '2nd';
        this.placeEl.classList.toggle('is-first', r.position === 1);
      }
    }
    if (r.banner !== this.shownBanner) {
      this.shownBanner = r.banner;
      this.bannerEl.textContent = r.banner ?? '';
      this.bannerEl.classList.toggle('is-hidden', r.banner === null);
      this.bannerEl.classList.toggle('is-won', r.won);
    }
  }
}
