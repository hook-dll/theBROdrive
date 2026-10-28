import type { RaceReadout, RaceResults } from '../race/director';

/**
 * THE RACE ON THE HUD (race/director.ts `RaceReadout`), for a boy who can barely read:
 *
 *  - the COUNTDOWN in the middle of the screen, big: "3", "2", "1" with the red lights,
 *    then a green "GO!";
 *  - while racing, a chip under the toasts: "LAP 2/3" and the place, "1st/5" in gold or
 *    "3rd/5" in grey, and under it the race keys ("[Backspace] restart  [T] back to
 *    track");
 *  - a call-out in the middle while it applies (off the track: "[T] back to the track");
 *  - the RESULTS panel when the race is over: the headline ("YOU WIN!", "YOU ARE 3rd",
 *    "OUT — …"), every car's place, name, time and best lap with the player's row in gold,
 *    the prize, and what the keys do now (race again, or drive away).
 *
 * Plain DOM, built once; `set` touches an element only when what it shows changes, and
 * the results table is built once per results object.
 */
const PLACES = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];

export class RaceHud {
  readonly el: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly chipEl: HTMLElement;
  private readonly lapEl: HTMLElement;
  private readonly placeEl: HTMLElement;
  private readonly keysEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private shownCount = '';
  private shownLap = '';
  private shownPlace = '';
  private shownKeys = '';
  private shownHint: string | null = null;
  private shownResults: RaceResults | null = null;
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
    this.keysEl = document.createElement('div');
    this.keysEl.className = 'hud-race-keys is-hidden';
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'hud-race-hint is-hidden';
    this.resultsEl = document.createElement('div');
    this.resultsEl.className = 'hud-race-results is-hidden';
    this.el.append(this.countEl, this.chipEl, this.keysEl, this.hintEl, this.resultsEl);
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
      this.keysEl.classList.toggle('is-hidden', !r.racing);
    }
    if (r.racing) {
      const lap = `LAP ${r.lap}/${r.laps}`;
      if (lap !== this.shownLap) {
        this.shownLap = lap;
        this.lapEl.textContent = lap;
      }
      const place = `${PLACES[r.position] ?? r.position}/${r.racers}`;
      if (place !== this.shownPlace) {
        this.shownPlace = place;
        this.placeEl.textContent = place;
        this.placeEl.classList.toggle('is-first', r.position === 1);
      }
      if (r.keys !== this.shownKeys) {
        this.shownKeys = r.keys;
        this.keysEl.textContent = r.keys;
      }
    }
    if (r.hint !== this.shownHint) {
      this.shownHint = r.hint;
      this.hintEl.textContent = r.hint ?? '';
      this.hintEl.classList.toggle('is-hidden', r.hint === null);
    }
    if (r.results !== this.shownResults) {
      this.shownResults = r.results;
      this.showResults(r.results);
    }
  }

  private showResults(results: RaceResults | null): void {
    const panel = this.resultsEl;
    panel.classList.toggle('is-hidden', results === null);
    panel.textContent = '';
    if (!results) return;
    panel.classList.toggle('is-won', results.won);
    const head = document.createElement('div');
    head.className = 'hud-race-results-head';
    head.textContent = results.headline;
    const table = document.createElement('table');
    table.className = 'hud-race-results-table';
    for (const row of results.rows) {
      const tr = document.createElement('tr');
      if (row.player) tr.className = 'is-player';
      for (const text of [PLACES[row.place] ?? String(row.place), row.name, row.time, row.best]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      table.append(tr);
    }
    const prize = document.createElement('div');
    prize.className = 'hud-race-results-prize';
    prize.textContent = results.prize;
    const hint = document.createElement('div');
    hint.className = 'hud-race-results-hint';
    hint.textContent = `${results.hint} · drive away to leave`;
    panel.append(head, table, prize, hint);
  }
}
