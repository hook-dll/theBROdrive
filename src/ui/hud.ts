import { itemLabel } from '../items/items';
import type { Item } from '../items/items';
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
  gearLabel: string;
  fuelLitres: number;
  tankCapacity: number;
  engineRunning: boolean;
  engineDestroyed: boolean;
  /** Missing engine, incompatible fuel, or an engine with no oil. */
  checkEngine: boolean;
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

// Both primary instruments use the same 270° sweep. Its missing lower quarter
// keeps the existing cut-off-circle silhouette; half scale lands at 12 o'clock.
const DIAL_SIZE = 120;
const CX = DIAL_SIZE / 2;
const CY = DIAL_SIZE / 2;
const MAIN_FACE_R = 54;
const MAIN_NEEDLE_R = 37;
const AUX_CX = 60;
const AUX_CY = 62;
const AUX_R = 44;
const AUX_NEEDLE_R = 35;
const AUX_START_ANGLE = 200;
const AUX_SWEEP_ANGLE = 140;
const AUX_END_ANGLE = AUX_START_ANGLE + AUX_SWEEP_ANGLE;
const START_ANGLE = 135;
const SWEEP_ANGLE = 270;
const END_ANGLE = START_ANGLE + SWEEP_ANGLE;

interface MainDialScale {
  readonly max: number;
  readonly minorStep: number;
  readonly halfStep: number;
  readonly majorStep: number;
  readonly redFrom: number;
}

const SPEEDOMETER_SCALE: MainDialScale = {
  max: 200,
  minorStep: 10,
  halfStep: 10,
  majorStep: 20,
  redFrom: 180,
};
const TACHOMETER_SCALE: MainDialScale = {
  max: 8000,
  minorStep: 1000,
  halfStep: 1000,
  majorStep: 1000,
  redFrom: 6000,
};

const LCD_DIGITS = 16;
const LCD_STEP_MS = 180;
const LCD_INITIAL_PAUSE_STEPS = 4;
const RADIO_OFF_MESSAGE = 'RADIO OFF';
const RADIO_OFF_DURATION_MS = 5000;
const SEGMENT_IDS = 'abcdefghijklmnop';
const SEGMENT_LINES: readonly (readonly [number, number, number, number])[] = [
  [2, 1.5, 5.35, 1.5], [6.65, 1.5, 10, 1.5],
  [10.5, 2.25, 10.5, 11.75], [10.5, 14.25, 10.5, 23.75],
  [6.65, 24.5, 10, 24.5], [2, 24.5, 5.35, 24.5],
  [1.5, 14.25, 1.5, 23.75], [1.5, 2.25, 1.5, 11.75],
  [2, 13, 5.35, 13], [6.65, 13, 10, 13],
  [2.4, 2.5, 5.55, 11.7], [6, 2.4, 6, 11.6],
  [9.6, 2.5, 6.45, 11.7], [6.45, 14.3, 9.6, 23.5],
  [6, 14.4, 6, 23.6], [5.55, 14.3, 2.4, 23.5],
];
const SEGMENT_GLYPHS: Readonly<Record<string, string>> = {
  ' ': '', '-': 'ij', '_': 'ef', '!': 'lo', '/': 'mp',
  '0': 'abcdefgh', '1': 'cd', '2': 'abcijgef', '3': 'abcdeij',
  '4': 'hcdij', '5': 'abhijdef', '6': 'abhgijdef', '7': 'abcd',
  '8': 'abcdefghij', '9': 'abhcdijef',
  A: 'abhgcdij', B: 'hgcdefij', C: 'abhgfe', D: 'abcdeflo',
  E: 'abhgijfe', F: 'abhgij', G: 'abhgfedj', H: 'hgcdij',
  I: 'abeflo', J: 'cdefg', K: 'hgmn', L: 'hgef',
  M: 'hgcdkm', N: 'hgcdkn', O: 'abcdefgh', P: 'abhcgij',
  Q: 'abcdefghn', R: 'abhcgijn', S: 'abhijdef', T: 'ablo',
  U: 'hgcdef', V: 'hcpn', W: 'hgcdnp', X: 'kmpn',
  Y: 'kmo', Z: 'abmpef',
};

/** Fuel fraction below which the analogue gauge reads as an alarm. */
const FUEL_ALARM_FRACTION = 0.12;
/**
 * Water/oil fraction below which the warning lamp lights. Higher than the fuel
 * alarm because these are not fixable at the roadside from a jerrycan you happen
 * to be carrying — you want warning early enough to plan a stop around it.
 */
const FLUID_ALARM_FRACTION = 0.25;
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

/**
 * The glyph table as CSS, installed once per document.
 *
 * Which segments a character lights is fixed data, so it belongs in a stylesheet
 * rather than in sixteen class writes per digit per frame: the display then costs
 * ONE attribute write per changed digit and the selector match is the browser's own
 * work. One rule per segment, listing every character that lights it.
 */
let segmentRulesInstalled = false;
function installSegmentGlyphRules(): void {
  if (segmentRulesInstalled) return;
  segmentRulesInstalled = true;
  const rules: string[] = [];
  for (let segment = 0; segment < SEGMENT_IDS.length; segment++) {
    const id = SEGMENT_IDS[segment]!;
    const selectors: string[] = [];
    for (const [character, glyph] of Object.entries(SEGMENT_GLYPHS)) {
      if (!glyph.includes(id)) continue;
      selectors.push(`.hud-lcd-digit[data-c="${character}"] .hud-lcd-s${segment}`);
    }
    if (selectors.length === 0) continue;
    rules.push(`${selectors.join(',')}{stroke:var(--hud-lcd-on)}`);
  }
  const style = document.createElement('style');
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
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
  private readonly tachNeedle: SVGLineElement;
  private readonly speedNeedle: SVGLineElement;
  private readonly gearEl: HTMLElement;
  private readonly fuelEl: SVGSVGElement;
  private readonly fuelNeedle: SVGLineElement;
  private readonly temperatureCluster: HTMLElement;
  private readonly temperatureEl: SVGSVGElement;
  private readonly temperatureNeedle: SVGLineElement;
  private readonly handbrakeEl: HTMLElement;
  private readonly tcsEl: HTMLElement;
  private readonly invMassEl: HTMLElement;
  private readonly invSlotsEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly checkEngineEl: HTMLElement;
  private readonly oilWarningEl: HTMLElement;
  private readonly lcdEl: SVGSVGElement;
  private readonly lcdDigits: readonly SVGGElement[];
  private readonly gumBubbleEl: HTMLElement;
  private readonly damageVignetteEl: HTMLElement;
  private readonly deathFadeEl: HTMLElement;
  private readonly root: HTMLElement;
  private damageStrength = -1;
  private deathFade = -1;
  private gumBubbleProgress = -1;

  private tachDeg = -1;
  private speedDeg = -1;
  private fuelDeg = -1;
  private temperatureDeg = -1;
  private warningsSignature = '';
  private engineOff = false;
  private radioText: string | null = null;
  private radioOffUntil = 0;
  private displayMessage = '';
  private displayEpoch = 0;
  private displayOffset = -1;
  private displayAlarm = false;
  /** Sanitised LCD text, cached against the raw source it was derived from. */
  private sanitizedSource: string | null = null;
  private sanitized = '';
  /** Per-digit character actually written to the DOM. */
  private readonly displayCharacters: string[] = Array.from({ length: LCD_DIGITS }, () => '\u0000');
  private invSlots: HTMLElement[] = [];
  private invItems: readonly Item[] = [];
  private invLabels: string[] = [];
  private invSelected = -1;
  private toasts: HTMLElement[] = [];
  private toastTimers = new Set<number>();
  private disposed = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.crosshairEl = el('div', 'hud-crosshair');

    this.promptEl = el('div', 'hud-prompt is-hidden');

    this.drivingCluster = el('div', 'hud-driving is-hidden');

    const tach = this.buildMainDial('hud-tach', TACHOMETER_SCALE);
    this.tachNeedle = tach.needle;

    const speed = this.buildMainDial('hud-speedometer', SPEEDOMETER_SCALE);
    this.speedNeedle = speed.needle;


    const fuel = this.buildAuxDial('hud-fuel', 'fuel');
    this.fuelEl = fuel.svg;
    this.fuelNeedle = fuel.needle;
    const fuelCluster = el('div', 'hud-aux-cluster');
    fuelCluster.append(fuel.svg);

    const temperature = this.buildAuxDial('hud-temperature', 'temperature');
    this.temperatureEl = temperature.svg;
    this.temperatureNeedle = temperature.needle;
    this.temperatureCluster = el('div', 'hud-aux-cluster');
    this.temperatureCluster.append(temperature.svg);

    const display = this.buildSegmentDisplay();
    this.lcdEl = display.svg;
    this.lcdDigits = display.digits;

    this.gearEl = el('div', 'hud-gear');
    this.handbrakeEl = el('div', 'hud-handbrake');
    this.handbrakeEl.textContent = 'P';
    this.tcsEl = el('div', 'hud-tcs');
    this.tcsEl.textContent = 'TCS';
    this.checkEngineEl = this.buildIconLamp(
      'hud-check-engine',
      'Check engine',
      'M 4 5 H 7 L 9 3 H 16 L 18 5 H 21 V 14 H 18 L 16 16 H 7 L 5 14 H 2 V 7 H 4 Z M 9 8 H 16 M 12.5 6 V 11',
    );
    this.oilWarningEl = this.buildIconLamp(
      'hud-oil-warning',
      'Oil low',
      'M 3 8 H 14 L 18 11 V 15 H 7 Q 3 15 3 11 Z M 14 8 L 18 5 H 21 M 20 12 Q 23 14 20 16',
    );

    const indicatorTop = el('div', 'hud-indicator-row');
    indicatorTop.append(this.checkEngineEl, this.oilWarningEl, this.handbrakeEl);
    const indicatorBottom = el('div', 'hud-indicator-row');
    indicatorBottom.append(this.gearEl, this.tcsEl);
    const indicators = el('div', 'hud-icon-panel');
    indicators.append(indicatorTop, indicatorBottom);

    const centreTop = el('div', 'hud-centre-top');
    centreTop.append(this.temperatureCluster, indicators, fuelCluster);
    const centreBlock = el('div', 'hud-centre-block');
    centreBlock.append(centreTop, this.lcdEl);

    const gaugeRow = el('div', 'hud-gauge-row');
    gaugeRow.append(tach.svg, centreBlock, speed.svg);

    const dashboard = el('div', 'hud-dashboard-shell');
    dashboard.append(gaugeRow);
    this.drivingCluster.append(dashboard);

    this.invMassEl = el('div', 'hud-inv-mass');
    this.invSlotsEl = el('div', 'hud-inv-items');
    const inventoryEl = el('div', 'hud-inventory');
    inventoryEl.append(this.invSlotsEl);


    this.toastEl = el('div', 'hud-toasts');
    this.gumBubbleEl = el('div', 'hud-gum-bubble is-hidden');
    this.damageVignetteEl = el('div', 'hud-damage-vignette');
    this.deathFadeEl = el('div', 'hud-death-fade');

    this.tops = [
      this.crosshairEl,
      this.promptEl,
      this.drivingCluster,
      inventoryEl,
      this.toastEl,
      this.gumBubbleEl,
    ];
    root.append(...this.tops, this.damageVignetteEl, this.deathFadeEl);
  }

  private buildIconLamp(className: string, label: string, pathData: string): HTMLElement {
    const lamp = el('div', `hud-indicator-lamp ${className}`);
    lamp.setAttribute('role', 'img');
    lamp.setAttribute('aria-label', label);
    const svg = svgEl('svg');
    svg.setAttribute('viewBox', '0 0 24 18');
    svg.setAttribute('aria-hidden', 'true');
    const path = svgEl('path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    lamp.appendChild(svg);
    return lamp;
  }

  private buildMainDial(
    className: string,
    scale: MainDialScale,
  ): { svg: SVGSVGElement; needle: SVGLineElement } {
    const svg = svgEl('svg');
    svg.setAttribute('class', `hud-dial hud-main-dial ${className}`);
    svg.setAttribute('viewBox', `0 0 ${DIAL_SIZE} ${DIAL_SIZE}`);
    svg.setAttribute('width', String(DIAL_SIZE));
    svg.setAttribute('height', String(DIAL_SIZE));

    const faceStart = polar(CX, CY, MAIN_FACE_R, START_ANGLE);
    const face = svgEl('path');
    face.setAttribute('class', 'hud-main-dial-face');
    face.setAttribute(
      'd',
      `${arcPath(CX, CY, MAIN_FACE_R, START_ANGLE, END_ANGLE)} L ${faceStart.x.toFixed(2)} ${faceStart.y.toFixed(2)} Z`,
    );
    svg.appendChild(face);
    const rim = svgEl('path');
    rim.setAttribute('class', 'hud-main-dial-rim');
    rim.setAttribute('d', arcPath(CX, CY, 51.5, START_ANGLE, END_ANGLE));
    svg.appendChild(rim);

    for (let value = 0; value <= scale.max; value += scale.minorStep) {
      const fraction = value / scale.max;
      const deg = START_ANGLE + fraction * SWEEP_ANGLE;
      const major = value % scale.majorStep === 0;
      const half = !major && value % scale.halfStep === 0;
      const outer = polar(CX, CY, 50, deg);
      const inner = polar(CX, CY, major ? 40 : half ? 43 : 46.5, deg);
      const tick = svgEl('line');
      tick.setAttribute(
        'class',
        `hud-dial-tick${major ? ' is-major' : half ? ' is-half' : ''}${value >= scale.redFrom ? ' is-red' : ''}`,
      );
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
    const hub = svgEl('circle');
    hub.setAttribute('class', 'hud-dial-hub');
    hub.setAttribute('cx', String(CX));
    hub.setAttribute('cy', String(CY));
    hub.setAttribute('r', '2.6');
    svg.appendChild(hub);

    return { svg, needle };
  }

  private buildAuxDial(
    className: string,
    kind: 'fuel' | 'temperature',
  ): { svg: SVGSVGElement; needle: SVGLineElement } {
    const svg = svgEl('svg');
    svg.setAttribute('class', `hud-dial hud-aux-dial ${className}`);
    svg.setAttribute('viewBox', '0 0 120 72');
    svg.setAttribute('width', '120');
    svg.setAttribute('height', '72');

    const face = svgEl('path');
    face.setAttribute('class', 'hud-aux-face');
    face.setAttribute('d', 'M 5 67 Q 11 7 60 5 Q 109 7 115 67 Z');
    svg.appendChild(face);

    const track = svgEl('path');
    track.setAttribute('class', 'hud-aux-track');
    track.setAttribute('d', arcPath(AUX_CX, AUX_CY, AUX_R, AUX_START_ANGLE, AUX_END_ANGLE));
    svg.appendChild(track);

    const zones = kind === 'fuel'
      ? [
          ['is-red', 0, 0.18],
          ['is-neutral', 0.45, 1],
        ] as const
      : [
          ['is-green', 0.27, 0.68],
          ['is-red', 0.8, 1],
        ] as const;
    for (const [zoneClass, start, end] of zones) {
      const zone = svgEl('path');
      zone.setAttribute('class', `hud-aux-zone ${zoneClass}`);
      zone.setAttribute(
        'd',
        arcPath(
          AUX_CX,
          AUX_CY,
          AUX_R,
          AUX_START_ANGLE + start * AUX_SWEEP_ANGLE,
          AUX_START_ANGLE + end * AUX_SWEEP_ANGLE,
        ),
      );
      svg.appendChild(zone);
    }

    for (let step = 0; step <= 10; step += 5) {
      const fraction = step / 10;
      const deg = AUX_START_ANGLE + fraction * AUX_SWEEP_ANGLE;
      const major = step % 5 === 0;
      const outer = polar(AUX_CX, AUX_CY, AUX_R, deg);
      const inner = polar(AUX_CX, AUX_CY, major ? 36.5 : 40, deg);
      const tick = svgEl('line');
      tick.setAttribute('class', `hud-aux-tick${major ? ' is-major' : ''}`);
      tick.setAttribute('x1', inner.x.toFixed(2));
      tick.setAttribute('y1', inner.y.toFixed(2));
      tick.setAttribute('x2', outer.x.toFixed(2));
      tick.setAttribute('y2', outer.y.toFixed(2));
      svg.appendChild(tick);
    }


    const needle = svgEl('line');
    needle.setAttribute('class', 'hud-aux-needle');
    needle.setAttribute('x1', String(AUX_CX));
    needle.setAttribute('y1', String(AUX_CY));
    svg.appendChild(needle);
    const hub = svgEl('circle');
    hub.setAttribute('class', 'hud-aux-hub');
    hub.setAttribute('cx', String(AUX_CX));
    hub.setAttribute('cy', String(AUX_CY));
    hub.setAttribute('r', '3');
    svg.appendChild(hub);

    return { svg, needle };
  }

  private buildSegmentDisplay(): {
    svg: SVGSVGElement;
    digits: readonly SVGGElement[];
  } {
    installSegmentGlyphRules();
    const svg = svgEl('svg');
    svg.setAttribute('class', 'hud-lcd');
    svg.setAttribute('viewBox', `0 0 ${LCD_DIGITS * 13 + 2} 28`);
    svg.setAttribute('role', 'status');
    const digits: SVGGElement[] = [];
    for (let digit = 0; digit < LCD_DIGITS; digit++) {
      const group = svgEl('g') as SVGGElement;
      group.setAttribute('class', 'hud-lcd-digit');
      group.setAttribute('transform', `translate(${digit * 13 + 1} 1)`);
      group.setAttribute('data-c', ' ');
      let index = 0;
      for (const [x1, y1, x2, y2] of SEGMENT_LINES) {
        const segment = svgEl('line');
        segment.setAttribute('class', `hud-lcd-segment hud-lcd-s${index}`);
        segment.setAttribute('x1', String(x1));
        segment.setAttribute('y1', String(y1));
        segment.setAttribute('x2', String(x2));
        segment.setAttribute('y2', String(y2));
        group.appendChild(segment);
        index++;
      }
      svg.appendChild(group);
      digits.push(group);
    }
    return { svg, digits };
  }


  /**
   * Health remains numerical state only. Its sole presentation is this soft black
   * edge treatment; death suppresses every interactive HUD child and owns a separate
   * solid fade that is allowed to reach full black.
   */
  setHealthEffects(damage: number, dying: boolean, fade: number): void {
    const strength = Math.min(1, Math.max(0, damage));
    if (Math.abs(strength - this.damageStrength) > 0.001) {
      this.damageStrength = strength;
      const edgeOpacity =
        strength <= 0 ? 0 : Math.min(0.96, 0.22 + strength * 0.74);
      this.damageVignetteEl.style.setProperty(
        '--damage-opacity',
        String(edgeOpacity),
      );
      this.damageVignetteEl.style.setProperty(
        '--damage-blur',
        `${(5 + strength * 15).toFixed(1)}px`,
      );
      this.damageVignetteEl.style.setProperty(
        '--damage-inner',
        `${(68 - strength * 34).toFixed(1)}%`,
      );
    }
    const black = Math.min(1, Math.max(0, fade));
    if (black === 1 ? this.deathFade !== 1 : Math.abs(black - this.deathFade) > 0.001) {
      this.deathFade = black;
      this.deathFadeEl.style.opacity = String(black);
    }
    this.root.classList.toggle('is-death-sequence', dying);
  }

  setDriving(readout: DrivingReadout | null): void {
    if (readout === null) {
      this.setVisible(this.drivingCluster, false);
      this.setVisible(this.crosshairEl, true);
      return;
    }
    this.setVisible(this.drivingCluster, true);
    this.setVisible(this.crosshairEl, false);

    this.tachDeg = this.updateMainNeedle(
      readout.rpm,
      TACHOMETER_SCALE.max,
      this.tachDeg,
      this.tachNeedle,
    );
    this.speedDeg = this.updateMainNeedle(
      Math.abs(readout.speedKmh),
      SPEEDOMETER_SCALE.max,
      this.speedDeg,
      this.speedNeedle,
    );

    this.setText(this.gearEl, readout.gearLabel);

    const fuelFraction = readout.tankCapacity > 0 ? readout.fuelLitres / readout.tankCapacity : 0;
    this.fuelDeg = this.updateAuxNeedle(
      fuelFraction,
      this.fuelDeg,
      this.fuelNeedle,
    );
    this.fuelEl.classList.toggle('is-alarm', fuelFraction < FUEL_ALARM_FRACTION);

    const temperature = readout.temperature;
    this.setVisible(this.temperatureCluster, temperature !== null);
    if (temperature !== null) {
      this.temperatureDeg = this.updateAuxNeedle(
        temperature.fraction,
        this.temperatureDeg,
        this.temperatureNeedle,
      );
      this.temperatureEl.classList.toggle('is-cold', temperature.zone === 'cold');
      this.temperatureEl.classList.toggle('is-normal', temperature.zone === 'normal');
      this.temperatureEl.classList.toggle('is-warm', temperature.zone === 'warm');
      this.temperatureEl.classList.toggle('is-hot', temperature.zone === 'hot');
      this.temperatureEl.classList.toggle('is-critical', temperature.zone === 'critical');
    }

    // Faults own the display until the car is healthy; radio never trails them.
    const warnings: string[] = [];
    if (fuelFraction < FUEL_ALARM_FRACTION) {
      warnings.push(readout.fuelLitres <= 0 ? 'NO FUEL' : 'FUEL LOW');
    }
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
    const signature = warnings.join('   ');
    if (signature !== this.warningsSignature) this.warningsSignature = signature;
    this.engineOff = !readout.engineRunning;
    this.checkEngineEl.classList.toggle('is-active', readout.checkEngine);
    this.oilWarningEl.classList.toggle('is-active', readout.oilFraction < FLUID_ALARM_FRACTION);
    this.refreshSegmentDisplay();
    this.handbrakeEl.classList.toggle('is-active', readout.handbrake);
    this.tcsEl.classList.toggle('is-active', readout.tcsActive);
  }

  /** Radio remains a message source for the LCD; it has no separate lamp cell. */
  setRadio(text: string | null): void {
    if (text === this.radioText) {
      if (text !== RADIO_OFF_MESSAGE || this.radioOffUntil === 0) return;
      const now = performance.now();
      if (now < this.radioOffUntil) return;
      this.refreshSegmentDisplay(now);
      return;
    }
    const now = performance.now();
    this.radioText = text;
    this.radioOffUntil = text === RADIO_OFF_MESSAGE
      ? now + RADIO_OFF_DURATION_MS
      : 0;
    this.refreshSegmentDisplay(now);
  }

  private refreshSegmentDisplay(now = performance.now()): void {
    let problemMessage = this.warningsSignature;
    if (this.engineOff) {
      problemMessage += `${problemMessage ? '   ' : ''}ENGINE OFF`;
    }
    const hasProblems = problemMessage.length > 0;
    const radioMessage = this.radioText === RADIO_OFF_MESSAGE && now >= this.radioOffUntil
      ? ''
      : (this.radioText ?? '');
    const rawMessage = hasProblems ? problemMessage : radioMessage;
    // This runs every frame while driving, and the message changes about as often as
    // a station does. Sanitising it per frame was five string allocations a frame for
    // an answer that had not moved.
    if (rawMessage !== this.sanitizedSource) {
      this.sanitizedSource = rawMessage;
      this.sanitized = rawMessage
        .toUpperCase()
        .replace(/[·—–]/g, ' ')
        .replace(/[^A-Z0-9 !/_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    const message = this.sanitized;
    if (message !== this.displayMessage || hasProblems !== this.displayAlarm) {
      this.displayMessage = message;
      this.displayAlarm = hasProblems;
      this.displayEpoch = now;
      this.displayOffset = -1;
      this.setAttr(this.lcdEl, 'aria-label', message);
      this.lcdEl.classList.toggle('is-alarm', hasProblems);
    }

    let offset = 0;
    if (message.length > LCD_DIGITS) {
      const elapsedSteps = Math.floor((now - this.displayEpoch) / LCD_STEP_MS);
      offset = Math.max(0, elapsedSteps - LCD_INITIAL_PAUSE_STEPS) % (message.length + 3);
    }
    if (offset === this.displayOffset) return;
    this.displayOffset = offset;

    let frame: string;
    if (message.length <= LCD_DIGITS) {
      const leftPadding = Math.floor((LCD_DIGITS - message.length) / 2);
      frame = `${' '.repeat(leftPadding)}${message}`.padEnd(LCD_DIGITS);
    } else {
      const scroll = `${message}   `;
      frame = `${scroll}${scroll}`.slice(offset, offset + LCD_DIGITS);
    }
    // One attribute write per digit, and CSS decides which of its sixteen segments
    // are lit (see installSegmentGlyphRules). The display used to write 256 class
    // names per scroll step and every lit segment carried its own drop-shadow
    // filter, so a scrolling message repainted the whole cluster five times a
    // second — measurable as interaction latency whenever the radio had a line.
    for (let digit = 0; digit < LCD_DIGITS; digit++) {
      const character = frame[digit] ?? ' ';
      if (character === this.displayCharacters[digit]) continue;
      this.displayCharacters[digit] = character;
      this.lcdDigits[digit]!.setAttribute('data-c', character);
    }
  }


  private updateMainNeedle(
    value: number,
    max: number,
    previousDeg: number,
    needle: SVGLineElement,
  ): number {
    const fraction = Math.min(Math.max(value / max, 0), 1);
    const deg = START_ANGLE + fraction * SWEEP_ANGLE;
    const rounded = Math.round(deg * 10) / 10;
    if (rounded === previousDeg) return previousDeg;
    const tip = polar(CX, CY, MAIN_NEEDLE_R, deg);
    this.setAttr(needle, 'x2', tip.x.toFixed(2));
    this.setAttr(needle, 'y2', tip.y.toFixed(2));
    return rounded;
  }

  private updateAuxNeedle(
    fractionValue: number,
    previousDeg: number,
    needle: SVGLineElement,
  ): number {
    const fraction = Math.min(Math.max(fractionValue, 0), 1);
    const deg = AUX_START_ANGLE + fraction * AUX_SWEEP_ANGLE;
    const rounded = Math.round(deg * 10) / 10;
    if (rounded === previousDeg) return previousDeg;
    const tip = polar(AUX_CX, AUX_CY, AUX_NEEDLE_R, deg);
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
      const key = el('span', 'hud-inv-key');
      key.textContent = String(i + 1);
      node.appendChild(key);
      const name = el('span', 'hud-inv-name');
      name.textContent = label;
      node.appendChild(name);
      this.invSlotsEl.appendChild(node);
      this.invSlots.push(node);
      this.invLabels.push(label);
    }
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
    this.damageVignetteEl.remove();
    this.deathFadeEl.remove();
    this.root.classList.remove('is-death-sequence');
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
