import { itemLabel } from '../items/items';
import type { Item } from '../items/items';
import { DAY_LENGTH } from '../game/state';
import type { EngineTempReadout } from '../vehicle/cooling';

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
  engineDestroyed: boolean;
  /**
   * Engine coolant temperature, or null when the car has no engine fitted (the
   * gauge then reads nothing rather than lying about a cold engine).
   */
  temperature: EngineTempReadout | null;
  /**
   * Water and oil as fractions of capacity. These have no dial: they sit still
   * for tens of minutes and then matter suddenly, which is a warning lamp's job,
   * not a gauge's.
   */
  waterFraction: number;
  oilFraction: number;
  /** Parking brake state. Keyboard and touch controls both latch it. */
  handbrake: boolean;
  /**
   * Is traction control cutting drive torque this frame? The lamp is lit only while
   * the aid is doing something, which is what makes it teach where the grip ran out.
   */
  tcsActive: boolean;
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
/** Fuel fraction below which the analogue gauge reads as an alarm. */
const FUEL_ALARM_FRACTION = 0.12;
/**
 * Water/oil fraction below which the warning lamp lights. Higher than the fuel
 * alarm because these are not fixable at the roadside from a jerrycan you happen
 * to be carrying — you want warning early enough to plan a stop around it.
 */
const FLUID_ALARM_FRACTION = 0.25;
/** Analogue speedometer limit. Faster vehicles pin gracefully at the dial end. */
const SPEEDOMETER_MAX_KMH = 160;
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


export class Hud {
  private readonly tops: HTMLElement[] = [];

  private readonly crosshairEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly drivingCluster: HTMLElement;
  private readonly tachValue: SVGPathElement;
  private readonly tachNeedle: SVGLineElement;
  private readonly speedValue: SVGPathElement;
  private readonly speedNeedle: SVGLineElement;
  private readonly gearEl: HTMLElement;
  private readonly fuelEl: SVGSVGElement;
  private readonly fuelValue: SVGPathElement;
  private readonly fuelNeedle: SVGLineElement;
  private readonly engineOffEl: HTMLElement;
  private readonly temperatureCluster: HTMLElement;
  private readonly temperatureEl: SVGSVGElement;
  private readonly temperatureValue: SVGPathElement;
  private readonly temperatureNeedle: SVGLineElement;
  private readonly temperatureReadoutEl: HTMLElement;
  private readonly handbrakeEl: HTMLElement;
  private readonly tcsEl: HTMLElement;
  private readonly warningsEl: HTMLElement;
  private readonly invMassEl: HTMLElement;
  private readonly invSlotsEl: HTMLElement;
  private readonly odometerEl: HTMLElement;
  private readonly clockNeedle: SVGLineElement;
  private readonly toastEl: HTMLElement;
  private readonly radioEl: HTMLElement;
  private readonly gumBubbleEl: HTMLElement;
  private gumBubbleProgress = -1;

  private tachDeg = -1;
  private speedDeg = -1;
  private fuelDeg = -1;
  private clockDeg = -1;
  private temperatureDeg = -1;
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

    this.promptEl = el('div', 'hud-prompt is-hidden');

    this.drivingCluster = el('div', 'hud-driving is-hidden');

    const tach = this.buildDial('hud-tach', true);
    this.tachValue = tach.value;
    this.tachNeedle = tach.needle;

    const speed = this.buildDial('hud-speedometer');
    this.speedValue = speed.value;
    this.speedNeedle = speed.needle;

    this.odometerEl = el('div', 'hud-odometer');
    const speedCluster = el('div', 'hud-speed-cluster');
    speedCluster.append(speed.svg, this.odometerEl);

    const fuel = this.buildDial('hud-fuel', false, true);
    this.fuelEl = fuel.svg;
    this.fuelValue = fuel.value;
    this.fuelNeedle = fuel.needle;

    const temperature = this.buildDial('hud-temperature');
    this.temperatureEl = temperature.svg;
    this.temperatureValue = temperature.value;
    this.temperatureNeedle = temperature.needle;
    this.temperatureReadoutEl = el('div', 'hud-odometer');
    this.temperatureCluster = el('div', 'hud-speed-cluster');
    this.temperatureCluster.append(temperature.svg, this.temperatureReadoutEl);

    const clock = this.buildClock();
    this.clockNeedle = clock.needle;

    this.gearEl = el('div', 'hud-gear');

    // Both of these cells are always present, so an indicator lighting up cannot
    // widen or move the dashboard. Only their illumination changes.
    this.handbrakeEl = el('div', 'hud-handbrake');
    this.handbrakeEl.textContent = 'P';
    this.tcsEl = el('div', 'hud-tcs');
    this.tcsEl.textContent = 'TCS';
    const indicators = el('div', 'hud-indicators');
    indicators.append(this.gearEl, this.handbrakeEl, this.tcsEl);

    this.engineOffEl = el('div', 'hud-engine-off is-hidden');
    this.engineOffEl.textContent = 'ENGINE OFF';

    this.warningsEl = el('div', 'hud-warnings is-hidden');

    const gaugeRow = el('div', 'hud-gauge-row');
    gaugeRow.append(tach.svg, speedCluster, fuel.svg, this.temperatureCluster, clock.svg, indicators);

    this.drivingCluster.append(
      gaugeRow,
      this.engineOffEl,
      this.warningsEl,
    );

    // The radio is part of the driving dashboard and scales/moves with it.
    this.radioEl = el('div', 'hud-radio is-hidden');
    this.drivingCluster.appendChild(this.radioEl);

    this.invMassEl = el('div', 'hud-inv-mass');
    this.invSlotsEl = el('div', 'hud-inv-items');
    const inventoryEl = el('div', 'hud-inventory');
    inventoryEl.append(this.invSlotsEl);


    this.toastEl = el('div', 'hud-toasts');
    this.gumBubbleEl = el('div', 'hud-gum-bubble is-hidden');

    this.tops = [
      this.crosshairEl,
      this.promptEl,
      this.drivingCluster,
      inventoryEl,
      this.toastEl,
      this.gumBubbleEl,
    ];
    root.append(...this.tops);
  }

  private buildDial(
    className: string,
    redline = false,
    fuelIcon = false,
  ): { svg: SVGSVGElement; value: SVGPathElement; needle: SVGLineElement } {
    const svg = svgEl('svg');
    svg.setAttribute('class', `hud-dial ${className}`);
    svg.setAttribute('viewBox', `0 0 ${TACH_SIZE} ${TACH_SIZE}`);
    svg.setAttribute('width', String(TACH_SIZE));
    svg.setAttribute('height', String(TACH_SIZE));

    const track = svgEl('path');
    track.setAttribute('class', 'hud-dial-track');
    track.setAttribute('d', arcPath(CX, CY, R, START_ANGLE, END_ANGLE));
    svg.appendChild(track);

    if (redline) {
      const redlineArc = svgEl('path');
      redlineArc.setAttribute('class', 'hud-dial-redline');
      redlineArc.setAttribute(
        'd',
        arcPath(CX, CY, R, START_ANGLE + REDLINE_FRACTION * SWEEP_ANGLE, END_ANGLE),
      );
      svg.appendChild(redlineArc);
    }

    if (fuelIcon) {
      // Same threshold treatment as the tachometer's redline: it lives on the
      // track beneath the value arc, never painted over the filled gauge.
      const lowFuelArc = svgEl('path');
      lowFuelArc.setAttribute('class', 'hud-dial-redline');
      lowFuelArc.setAttribute(
        'd',
        arcPath(CX, CY, R, START_ANGLE, START_ANGLE + FUEL_ALARM_FRACTION * SWEEP_ANGLE),
      );
      svg.appendChild(lowFuelArc);
    }

    const value = svgEl('path');
    value.setAttribute('class', 'hud-dial-value');
    value.setAttribute('d', '');
    svg.appendChild(value);

    if (fuelIcon) {
      const icon = svgEl('path');
      icon.setAttribute('class', 'hud-fuel-icon');
      icon.setAttribute('d', 'M47 43 H64 V79 H47 Z M51 48 H60 V60 H51 Z M64 49 H69 Q73 49 73 54 V70 Q73 75 68 75 H66 V71 H68 Q69 71 69 69 V54 Q69 53 67 53 H64 Z');
      svg.appendChild(icon);
    }

    const needle = svgEl('line');
    needle.setAttribute('class', 'hud-dial-needle');
    needle.setAttribute('x1', String(CX));
    needle.setAttribute('y1', String(CY));
    svg.appendChild(needle);

    return { svg, value, needle };
  }

  /** A numberless single-hand clock, using the dashboard dial palette. */
  private buildClock(): { svg: SVGSVGElement; needle: SVGLineElement } {
    const svg = svgEl('svg');
    svg.setAttribute('class', 'hud-dial hud-clock-dial');
    svg.setAttribute('viewBox', `0 0 ${TACH_SIZE} ${TACH_SIZE}`);
    svg.setAttribute('width', String(TACH_SIZE));
    svg.setAttribute('height', String(TACH_SIZE));

    const track = svgEl('circle');
    track.setAttribute('class', 'hud-dial-track');
    track.setAttribute('cx', String(CX));
    track.setAttribute('cy', String(CY));
    track.setAttribute('r', String(R));
    svg.appendChild(track);

    // Twelve numberless hour marks, inside the thick outer track so they read as
    // printing on the face rather than as teeth on its rim. Quarter-hours are only
    // two viewBox units longer: enough to orient the eye immediately, not enough to
    // turn a tiny dashboard clock into a labelled wall clock.
    for (let hour = 0; hour < 12; hour++) {
      const deg = hour * 30 - 90; // 12 o'clock is straight up in SVG coordinates.
      const quarter = hour % 3 === 0;
      const inner = polar(CX, CY, quarter ? R - 15 : R - 12, deg);
      const outer = polar(CX, CY, R - 7, deg);
      const tick = svgEl('line');
      tick.setAttribute('class', quarter ? 'hud-clock-tick is-quarter' : 'hud-clock-tick');
      tick.setAttribute('x1', inner.x.toFixed(2));
      tick.setAttribute('y1', inner.y.toFixed(2));
      tick.setAttribute('x2', outer.x.toFixed(2));
      tick.setAttribute('y2', outer.y.toFixed(2));
      svg.appendChild(tick);
    }

    const needle = svgEl('line');
    needle.setAttribute('class', 'hud-dial-needle');
    needle.setAttribute('x1', String(CX));
    needle.setAttribute('y1', String(CY));
    svg.appendChild(needle);
    return { svg, needle };
  }

  setDriving(readout: DrivingReadout | null): void {
    if (readout === null) {
      this.setVisible(this.drivingCluster, false);
      this.setVisible(this.crosshairEl, true);
      return;
    }
    this.setVisible(this.drivingCluster, true);
    this.setVisible(this.crosshairEl, false);

    this.tachDeg = this.updateDial(
      readout.rpm,
      Math.max(readout.redlineRpm / REDLINE_FRACTION, 1),
      this.tachDeg,
      this.tachValue,
      this.tachNeedle,
    );
    this.speedDeg = this.updateDial(
      Math.abs(readout.speedKmh),
      SPEEDOMETER_MAX_KMH,
      this.speedDeg,
      this.speedValue,
      this.speedNeedle,
    );

    this.setText(this.gearEl, readout.gearLabel);

    const fuelFraction = readout.tankCapacity > 0 ? readout.fuelLitres / readout.tankCapacity : 0;
    this.fuelDeg = this.updateDial(
      fuelFraction,
      1,
      this.fuelDeg,
      this.fuelValue,
      this.fuelNeedle,
      FUEL_ALARM_FRACTION,
    );
    this.fuelEl.classList.toggle('is-alarm', fuelFraction < FUEL_ALARM_FRACTION);

    const temperature = readout.temperature;
    this.setVisible(this.temperatureCluster, temperature !== null);
    if (temperature !== null) {
      this.temperatureDeg = this.updateDial(
        temperature.fraction,
        1,
        this.temperatureDeg,
        this.temperatureValue,
        this.temperatureNeedle,
      );
      this.setText(this.temperatureReadoutEl, `${Math.round(temperature.celsius)} C`);
      this.temperatureEl.classList.toggle('is-cold', temperature.zone === 'cold');
      this.temperatureEl.classList.toggle('is-normal', temperature.zone === 'normal');
      this.temperatureEl.classList.toggle('is-warm', temperature.zone === 'warm');
      this.temperatureEl.classList.toggle('is-hot', temperature.zone === 'hot');
      this.temperatureEl.classList.toggle('is-critical', temperature.zone === 'critical');
    }

    // Warning lamps. Built as a single string and diff-guarded, because this is in
    // the render path and the usual state of it is "unchanged for ten minutes".
    const warnings: string[] = [];
    if (readout.engineDestroyed) warnings.push('ENGINE DESTROYED');
    if (temperature !== null && temperature.warning !== null) {
      warnings.push(temperature.warning);
    }
    if (readout.waterFraction < FLUID_ALARM_FRACTION) {
      warnings.push(readout.waterFraction <= 0 ? 'NO WATER' : 'WATER LOW');
    }
    if (readout.oilFraction < FLUID_ALARM_FRACTION) {
      warnings.push(readout.oilFraction <= 0 ? 'NO OIL' : 'OIL LOW');
    }
    const signature = warnings.join(' · ');
    if (signature !== this.warningsSignature) {
      this.warningsSignature = signature;
      this.warningsEl.textContent = signature;
      this.setVisible(this.warningsEl, signature.length > 0);
    }
    this.setVisible(this.engineOffEl, !readout.engineRunning);
    this.handbrakeEl.classList.toggle('is-active', readout.handbrake);
    this.tcsEl.classList.toggle('is-active', readout.tcsActive);
  }

  /** Radio line, or null when the radio has nothing to say (not in a car). */
  setRadio(text: string | null): void {
    this.setVisible(this.radioEl, text !== null);
    if (text !== null) this.setText(this.radioEl, text);
  }

  private updateDial(
    value: number,
    max: number,
    previousDeg: number,
    valuePath: SVGPathElement,
    needle: SVGLineElement,
    valueStartFraction = 0,
  ): number {
    const fraction = Math.min(Math.max(value / max, 0), 1);
    const deg = START_ANGLE + fraction * SWEEP_ANGLE;
    const rounded = Math.round(deg * 10) / 10;
    if (rounded === previousDeg) return previousDeg;
    const startDeg = START_ANGLE + valueStartFraction * SWEEP_ANGLE;
    this.setAttr(valuePath, 'd', fraction <= valueStartFraction ? '' : arcPath(CX, CY, R, startDeg, deg));
    const tip = polar(CX, CY, NEEDLE_R, deg);
    this.setAttr(needle, 'x2', tip.x.toFixed(2));
    this.setAttr(needle, 'y2', tip.y.toFixed(2));
    return rounded;
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


  /**
   * One composited DOM circle, deliberately cheaper than transparent geometry in
   * the 3D scene. Main keeps it hidden while chewing, then drives its five-second
   * growth from zero to the covered-frame pop.
   */
  setBubbleGum(active: boolean, progress: number): void {
    this.setVisible(this.gumBubbleEl, active);
    if (!active) {
      this.gumBubbleProgress = -1;
      return;
    }
    const p = Math.min(Math.max(progress, 0), 1);
    const rounded = Math.round(p * 1000) / 1000;
    if (rounded === this.gumBubbleProgress) return;
    this.gumBubbleProgress = rounded;
    this.gumBubbleEl.style.setProperty('--gum-grow', String(rounded));
  }

  private rebuildInventory(items: readonly Item[]): void {
    this.invSlotsEl.textContent = '';
    this.invSlots = [];
    // Snapshot, not the live array: setInventory's dirty test compares length and
    // per-slot content against this, so aliasing `inventory.all` (which mutates in
    // place on add/remove) would make every length check compare the array to
    // itself and a removal could leave its slot on screen forever.
    this.invItems = items.slice();
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

  setTravel(km: number, timeOfDay: number): void {
    this.setText(this.odometerEl, `TRIP ${km.toFixed(1)} km`);
    const halfDay = DAY_LENGTH * 0.5;
    const fraction = (((timeOfDay % halfDay) + halfDay) % halfDay) / halfDay;
    const deg = -90 + fraction * 360;
    const rounded = Math.round(deg * 10) / 10;
    if (rounded === this.clockDeg) return;
    this.clockDeg = rounded;
    const tip = polar(CX, CY, NEEDLE_R, deg);
    this.setAttr(this.clockNeedle, 'x2', tip.x.toFixed(2));
    this.setAttr(this.clockNeedle, 'y2', tip.y.toFixed(2));
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

  private setVisible(node: HTMLElement, visible: boolean): void {
    node.classList.toggle('is-hidden', !visible);
  }

}
