import { itemLabel } from '../items/items';
import type { Item } from '../items/items';
import { DAY_LENGTH } from '../game/state';

/**
 * HUD overlay. Plain DOM, no framework. Every element is created once and cached;
 * per-frame setters only touch the DOM when a displayed value actually changes.
 * These setters run at frame rate, so unguarded `textContent`/attribute writes
 * would be a real cost and a source of needless style recalculations.
 */

export interface DrivingReadout {
  speedKmh: number;
  rpm: number;
  redlineRpm: number;
  gearLabel: string;
  fuelLitres: number;
  tankCapacity: number;
  engineRunning: boolean;
  warnings: readonly string[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Tachometer geometry: a 270° sweep with the gap at the bottom, so the redline
// zone sits at the top of the dial where over-revving reads naturally.
const TACH_SIZE = 120;
const CX = TACH_SIZE / 2;
const CY = TACH_SIZE / 2;
const R = 44; // arc radius in viewBox units
const NEEDLE_R = 30; // needle length from the hub
const START_ANGLE = 135; // bottom-left, degrees (SVG: 0 = +X, positive = clockwise)
const SWEEP_ANGLE = 270;
const END_ANGLE = START_ANGLE + SWEEP_ANGLE; // 405 == 45, bottom-right

/** The redline zone occupies the top 15% of the dial; the full scale is scaled to suit. */
const REDLINE_FRACTION = 0.85;
/** Fuel fraction below which the gauge reads as an alarm. */
const FUEL_ALARM_FRACTION = 0.12;
/** Carried-mass fraction of the limit at which the readout turns alarming. */
const MASS_ALARM_FRACTION = 0.9;

const TOAST_DURATION_MS = 3200;
const TOAST_LEAVE_MS = 300;
const MAX_TOASTS = 4;

function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

function formatClock(timeOfDay: number): string {
  // One in-game day is DAY_LENGTH seconds across 24 hours, so an in-game minute
  // is one real second: hours = floor(t / 60), minutes = t % 60.
  let t = Math.floor(timeOfDay) % DAY_LENGTH;
  if (t < 0) t += DAY_LENGTH;
  const hours = Math.floor(t / 60) % 24;
  const minutes = t % 60;
  const h = hours < 10 ? `0${hours}` : `${hours}`;
  const m = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${h}:${m}`;
}

export class Hud {
  private readonly tops: HTMLElement[] = [];

  private readonly crosshairEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly drivingCluster: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly tachValue: SVGPathElement;
  private readonly tachNeedle: SVGLineElement;
  private readonly gearEl: HTMLElement;
  private readonly fuelEl: HTMLElement;
  private readonly fuelFill: HTMLElement;
  private readonly fuelText: HTMLElement;
  private readonly engineOffEl: HTMLElement;
  private readonly warningsEl: HTMLElement;
  private readonly invMassEl: HTMLElement;
  private readonly invSlotsEl: HTMLElement;
  private readonly odometerEl: HTMLElement;
  private readonly recordEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly toastEl: HTMLElement;

  private tachDeg = -1;
  private warningsSignature = '';
  private invSlots: HTMLElement[] = [];
  private invItems: readonly Item[] = [];
  private invLabels: string[] = [];
  private invSelected = -1;
  private toasts: HTMLElement[] = [];
  private toastTimers = new Set<number>();
  private disposed = false;

  constructor(root: HTMLElement) {
    this.crosshairEl = el('div', 'hud-crosshair');
    this.crosshairEl.appendChild(el('span', 'hud-crosshair-dot'));

    this.promptEl = el('div', 'hud-prompt is-hidden');

    this.drivingCluster = el('div', 'hud-driving is-hidden');

    const speedEl = el('div', 'hud-speed');
    this.speedValue = el('span', 'hud-speed-value');
    const speedUnit = el('span', 'hud-speed-unit');
    speedUnit.textContent = 'km/h';
    speedEl.append(this.speedValue, speedUnit);

    const tach = this.buildTach();
    this.tachValue = tach.value;
    this.tachNeedle = tach.needle;

    this.gearEl = el('div', 'hud-gear');

    this.fuelEl = el('div', 'hud-fuel');
    this.fuelFill = el('div', 'hud-fuel-fill');
    const fuelBar = el('div', 'hud-fuel-bar');
    fuelBar.appendChild(this.fuelFill);
    this.fuelText = el('span', 'hud-fuel-text');
    this.fuelEl.append(fuelBar, this.fuelText);

    this.engineOffEl = el('div', 'hud-engine-off is-hidden');
    this.engineOffEl.textContent = 'ENGINE OFF';

    this.warningsEl = el('div', 'hud-warnings is-hidden');

    const gaugeRow = el('div', 'hud-gauge-row');
    gaugeRow.append(tach.svg, this.gearEl, this.fuelEl);

    this.drivingCluster.append(speedEl, gaugeRow, this.engineOffEl, this.warningsEl);

    this.invMassEl = el('div', 'hud-inv-mass');
    this.invSlotsEl = el('div', 'hud-inv-items');
    const inventoryEl = el('div', 'hud-inventory');
    inventoryEl.append(this.invMassEl, this.invSlotsEl);

    this.odometerEl = el('div', 'hud-odometer');
    this.recordEl = el('div', 'hud-record');
    this.clockEl = el('div', 'hud-clock');
    const travelEl = el('div', 'hud-travel');
    travelEl.append(this.odometerEl, this.recordEl, this.clockEl);

    this.toastEl = el('div', 'hud-toasts');

    this.tops = [
      this.crosshairEl,
      this.promptEl,
      this.drivingCluster,
      inventoryEl,
      travelEl,
      this.toastEl,
    ];
    root.append(...this.tops);
  }

  private buildTach(): { svg: SVGSVGElement; value: SVGPathElement; needle: SVGLineElement } {
    const svg = svgEl('svg');
    svg.setAttribute('class', 'hud-tach');
    svg.setAttribute('viewBox', `0 0 ${TACH_SIZE} ${TACH_SIZE}`);
    svg.setAttribute('width', String(TACH_SIZE));
    svg.setAttribute('height', String(TACH_SIZE));

    const track = svgEl('path');
    track.setAttribute('class', 'hud-tach-track');
    track.setAttribute('d', arcPath(CX, CY, R, START_ANGLE, END_ANGLE));
    svg.appendChild(track);

    const redline = svgEl('path');
    redline.setAttribute('class', 'hud-tach-redline');
    redline.setAttribute(
      'd',
      arcPath(CX, CY, R, START_ANGLE + REDLINE_FRACTION * SWEEP_ANGLE, END_ANGLE),
    );
    svg.appendChild(redline);

    const value = svgEl('path');
    value.setAttribute('class', 'hud-tach-value');
    value.setAttribute('d', '');
    svg.appendChild(value);

    const needle = svgEl('line');
    needle.setAttribute('class', 'hud-tach-needle');
    needle.setAttribute('x1', String(CX));
    needle.setAttribute('y1', String(CY));
    svg.appendChild(needle);

    return { svg, value, needle };
  }

  setDriving(readout: DrivingReadout | null): void {
    if (readout === null) {
      this.setVisible(this.drivingCluster, false);
      return;
    }
    this.setVisible(this.drivingCluster, true);

    this.setText(this.speedValue, String(Math.round(readout.speedKmh)));

    this.updateTach(readout.rpm, readout.redlineRpm);

    this.setText(this.gearEl, readout.gearLabel);

    const frac = readout.tankCapacity > 0 ? readout.fuelLitres / readout.tankCapacity : 0;
    const pct = (Math.min(Math.max(frac, 0), 1) * 100).toFixed(1);
    this.setStyle(this.fuelFill, 'width', `${pct}%`);
    this.fuelEl.classList.toggle('is-alarm', frac < FUEL_ALARM_FRACTION);
    this.setText(this.fuelText, `${readout.fuelLitres.toFixed(1)} L`);

    this.setVisible(this.engineOffEl, !readout.engineRunning);

    this.updateWarnings(readout.warnings);
  }

  private updateTach(rpm: number, redlineRpm: number): void {
    const maxRpm = Math.max(redlineRpm / REDLINE_FRACTION, 1);
    const frac = Math.min(Math.max(rpm / maxRpm, 0), 1);
    const deg = START_ANGLE + frac * SWEEP_ANGLE;
    const rounded = Math.round(deg * 10) / 10;
    if (rounded === this.tachDeg) return;
    this.tachDeg = rounded;
    this.setAttr(this.tachValue, 'd', frac < 0.004 ? '' : arcPath(CX, CY, R, START_ANGLE, deg));
    const tip = polar(CX, CY, NEEDLE_R, deg);
    this.setAttr(this.tachNeedle, 'x2', tip.x.toFixed(2));
    this.setAttr(this.tachNeedle, 'y2', tip.y.toFixed(2));
  }

  private updateWarnings(warnings: readonly string[]): void {
    const sig = warnings.join('\n');
    if (sig === this.warningsSignature) return;
    this.warningsSignature = sig;
    this.warningsEl.textContent = '';
    this.setVisible(this.warningsEl, warnings.length > 0);
    for (const w of warnings) {
      const node = el('div', 'hud-warning');
      node.textContent = w;
      this.warningsEl.appendChild(node);
    }
  }

  setPrompt(text: string | null): void {
    this.setVisible(this.promptEl, text !== null);
    this.crosshairEl.classList.toggle('is-dim', text === null);
    if (text !== null) this.setText(this.promptEl, text);
  }

  setInventory(items: readonly Item[], selected: number, carriedMass: number, massLimit: number): void {
    // Rebuild the slot list only when composition or a displayed label changes.
    let dirty = items.length !== this.invItems.length;
    if (!dirty) {
      for (let i = 0; i < items.length; i++) {
        if (items[i] !== this.invItems[i] || itemLabel(items[i]) !== this.invLabels[i]) {
          dirty = true;
          break;
        }
      }
    }
    if (dirty) this.rebuildInventory(items);

    if (selected !== this.invSelected) {
      if (this.invSelected >= 0 && this.invSelected < this.invSlots.length) {
        this.invSlots[this.invSelected].classList.toggle('is-selected', false);
      }
      this.invSelected = selected;
      if (selected >= 0 && selected < this.invSlots.length) {
        this.invSlots[selected].classList.toggle('is-selected', true);
      }
    }

    this.setText(this.invMassEl, `${carriedMass.toFixed(1)} / ${massLimit.toFixed(0)} kg`);
    this.invMassEl.classList.toggle('is-alarm', carriedMass > massLimit * MASS_ALARM_FRACTION);
  }

  private rebuildInventory(items: readonly Item[]): void {
    this.invSlotsEl.textContent = '';
    this.invSlots = [];
    this.invItems = items;
    this.invLabels = [];
    this.invSelected = -1;
    for (let i = 0; i < items.length; i++) {
      const label = itemLabel(items[i]!);
      const node = el('div', 'hud-inv-slot');
      // The number row binds slots 1..8, so show the key that selects this slot.
      // Beyond eight there is no shortcut, and the badge is omitted rather than
      // advertising a key that does nothing.
      if (i < 8) {
        const key = el('span', 'hud-inv-key');
        key.textContent = String(i + 1);
        node.appendChild(key);
      }
      const name = el('span', 'hud-inv-name');
      name.textContent = label;
      node.appendChild(name);
      this.invSlotsEl.appendChild(node);
      this.invSlots.push(node);
      this.invLabels.push(label);
    }
  }

  setTravel(km: number, recordKm: number, timeOfDay: number): void {
    this.setText(this.odometerEl, `${km.toFixed(1)} km`);
    this.setText(this.recordEl, `RECORD ${recordKm.toFixed(1)} km`);
    this.setText(this.clockEl, formatClock(timeOfDay));
  }

  setToast(text: string): void {
    if (this.disposed) return;
    const toast = el('div', 'hud-toast');
    toast.textContent = text;
    this.toastEl.appendChild(toast);
    this.toasts.push(toast);
    // Cap the visible stack so a burst of toasts cannot flood the screen.
    while (this.toasts.length > MAX_TOASTS) {
      const drop = this.toasts.shift();
      if (drop) drop.remove();
    }
    const schedule = (fn: () => void, ms: number): void => {
      const id = window.setTimeout(() => {
        this.toastTimers.delete(id);
        fn();
      }, ms);
      this.toastTimers.add(id);
    };
    schedule(() => {
      toast.classList.add('hud-toast-leaving');
      schedule(() => {
        toast.remove();
        const i = this.toasts.indexOf(toast);
        if (i >= 0) this.toasts.splice(i, 1);
      }, TOAST_LEAVE_MS);
    }, TOAST_DURATION_MS);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.toastTimers) window.clearTimeout(id);
    this.toastTimers.clear();
    this.toasts = [];
    for (const node of this.tops) node.remove();
    this.tops.length = 0;
  }

  private setText(node: HTMLElement, value: string): void {
    if (node.textContent !== value) node.textContent = value;
  }

  private setAttr(node: Element, name: string, value: string): void {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }

  private setStyle(node: HTMLElement, prop: string, value: string): void {
    if (node.style.getPropertyValue(prop) !== value) node.style.setProperty(prop, value);
  }

  private setVisible(node: HTMLElement, visible: boolean): void {
    node.classList.toggle('is-hidden', !visible);
  }
}
