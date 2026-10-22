import { itemLabel } from '../items/items';
import type { Item } from '../items/items';
import type { EngineTempReadout } from '../vehicle/cooling';
import type { AutopilotMode } from '../vehicle/autopilot';
import { FUEL_RESERVE_FRACTION } from '../parts/registry';
import { RIDE_EASY_MPS2, RIDE_HARSH_MPS2 } from '../trip/ride';
import { formatMoney } from '../economy/economy';

/**
 * HUD overlay. Plain DOM, no framework. Every element is created once and cached;
 * per-frame setters only touch the DOM when a displayed value actually changes.
 * These setters run at frame rate, so unguarded `textContent`/attribute writes
 * would be a real cost and a source of needless style recalculations.
 */

export interface DrivingReadout {
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
  /**
   * The autopilot mode driving this car, or null while the PLAYER is driving it. The
   * panel's frame takes the mode's colour: who is steering is the single most important
   * thing a driver can be unsure about, and it is read from the corner of the eye.
   */
  autopilotMode: AutopilotMode | null;
  /**
   * The keyboard and mouse PEDAL LEVER (core/pedallever.ts) while it drives the pedals,
   * null while a pad or touch does, or an autopilot drives: the notch the lever is on
   * and the two pedals as they are now. Drawn as the vertical scale beside the
   * speedometer, because the lever holds a pedal the keys no longer show by being down.
   */
  pedalLever: {
    readonly notch: number;
    readonly throttle: number;
    readonly brake: number;
    /** The brake pedal's ceiling, the car's threshold pedal: a full brake cell. */
    readonly knee: number;
  } | null;
}

/**
 * The ride of the car the player drives (trip/ride.ts `RideMeter` is one): smoothed
 * horizontal acceleration in the car's frame, m/s², and the harsh moments counted so far.
 */
export interface RideReadout {
  /** Along the nose: positive speeding up, negative braking. */
  readonly longitudinal: number;
  /** Across the car: positive towards its left. */
  readonly lateral: number;
  readonly harshMoments: number;
}


const SVG_NS = 'http://www.w3.org/2000/svg';

const LCD_DIGITS = 16;

/**
 * THE PEDAL LEVER SCALE: six sections stacked, the four throttle notches over neutral
 * over the brake (core/pedallever.ts), each `LEVER_CELL` tall.
 */
const LEVER_W = 12;
const LEVER_CELL = 9;
const LEVER_THROTTLE_CELLS = 4;
const LEVER_BRAKE_CELLS = 1;
const LEVER_H = (LEVER_THROTTLE_CELLS + 1 + LEVER_BRAKE_CELLS) * LEVER_CELL;
/** The top of the neutral cell and its foot: the throttle fills up, the brake down. */
const LEVER_NEUTRAL_TOP = LEVER_THROTTLE_CELLS * LEVER_CELL;
const LEVER_NEUTRAL_FOOT = LEVER_NEUTRAL_TOP + LEVER_CELL;
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
/** Length of the mini-map's bead line, px; matches `.hud-race-track` width in hud.css. */
const RACE_LINE_PX = 236;
/**
 * The crosshair fades this long after the view was last turned: long enough to read
 * what the aim settled on, short enough that a still view is clean (owner: 3-5 s).
 */
const CROSSHAIR_IDLE_MS = 4000;
/**
 * THE G-FORCE WIDGET: a small round instrument on the panel that shows how hard the car
 * pushes what it carries. The dot is the push itself, where the load is thrown — up the
 * face when braking, to the right in a left bend — and the rings are the ride's
 * thresholds (trip/ride.ts): calm inside, uncomfortable between, harsh outside. Radius
 * in the widget's own units; the face's edge is `RIDE_FULL_MPS2`.
 */
const RIDE_R = 26;
const RIDE_FULL_MPS2 = 5;

function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
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



export class Hud {
  private readonly tops: Element[] = [];

  private readonly crosshairEl: HTMLElement;
  /** When the view was last turned, ms (`noteLook`); the crosshair fades after it. */
  private lastLookMs = -Infinity;
  private readonly promptEl: HTMLElement;
  /** The cabin-camera editor's axis and eye readout; see vehicle/cabincamera.ts. */
  private readonly cabinEditorEl: HTMLElement;
  private readonly drivingCluster: HTMLElement;
  private readonly invMassEl: HTMLElement;
  private readonly invSlotsEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  /** The mini-map's bead line under the panel; see `setRouteProgress`. */
  private readonly raceEl: HTMLElement;
  private readonly raceTrackEl: HTMLElement;
  private readonly raceLabelEl: HTMLElement;
  /** Player's bead first, then the rivals'. */
  private readonly raceBeads: HTMLElement[] = [];
  /** Last written x per bead, px; NaN forces a write. */
  private readonly raceBeadX: number[] = [];
  private raceKind: 'race' | 'delivery' | 'idle' | null = null;
  private readonly lcdEl: SVGSVGElement;
  /** The money readout (`setMoney`): on the panel while driving, by the pack on foot. */
  private readonly moneyEl: HTMLElement;
  private readonly moneySlot: HTMLElement;
  private readonly inventoryEl: HTMLElement;
  private moneyShown = -1;
  /** The pedal lever scale (`DrivingReadout.pedalLever`): the svg, the notch frame, the fills. */
  private readonly leverEl: SVGSVGElement;
  private readonly leverNotch: SVGRectElement;
  private readonly leverThrottle: SVGRectElement;
  private readonly leverBrake: SVGRectElement;
  private readonly lcdDigits: readonly SVGGElement[];
  private readonly gumBubbleEl: HTMLElement;
  private readonly damageVignetteEl: HTMLElement;
  private readonly deathFadeEl: HTMLElement;
  private readonly root: HTMLElement;
  /** The G-force widget (`setRide`), its dot, and the ring that flashes on a harsh moment. */
  private readonly rideEl: SVGSVGElement;
  private readonly rideDot: SVGCircleElement;
  private readonly ridePulse: SVGCircleElement;
  private rideShown = false;
  /** Last written dot position (widget units) and zone; NaN/-1 force a write. */
  private rideX = Number.NaN;
  private rideY = Number.NaN;
  private rideZone = -1;
  /** Harsh moments already pulsed for; a new one past this flashes the ring. */
  private rideHarshSeen = 0;
  private damageStrength = -1;
  private deathFade = -1;
  private gumBubbleProgress = -1;
  /** Delivery distance in tens of metres last written to the route label. */
  private raceLabelKey = Number.NaN;
  /** The destination post's place name last written to the route label. */
  private raceLabelPlace = '';
  private warningsSignature = '';
  /**
   * The mode the faces are currently painted for, so the class writes happen on a
   * mode CHANGE rather than on every frame the autopilot is engaged.
   */
  private autopilotFaces: AutopilotMode | null = null;
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
    this.cabinEditorEl = el('div', 'hud-cabin-editor is-hidden');

    this.drivingCluster = el('div', 'hud-driving is-hidden');

    const display = this.buildSegmentDisplay();
    this.lcdEl = display.svg;
    this.lcdDigits = display.digits;
    const lever = this.buildPedalLever();
    this.leverEl = lever.svg;
    this.leverNotch = lever.notch;
    this.leverThrottle = lever.throttle;
    this.leverBrake = lever.brake;
    const ride = this.buildRideWidget();
    this.rideEl = ride.svg;
    this.rideDot = ride.dot;
    this.ridePulse = ride.pulse;
    this.moneyEl = el('div', 'hud-money');
    this.moneySlot = el('div', 'hud-money-slot');

    // THE MINI-MAP: the route bead line, from the post behind to the one ahead (or a
    // race's start to its finish), under the panel's row.
    this.raceEl = el('div', 'hud-race is-idle');
    this.raceTrackEl = el('div', 'hud-race-track');
    this.raceTrackEl.append(el('div', 'hud-race-line'), el('div', 'hud-race-start'), el('div', 'hud-race-finish'));
    this.raceLabelEl = el('div', 'hud-race-label');
    this.raceEl.append(this.raceTrackEl, this.raceLabelEl);

    // THE PANEL: the G-force widget, the display with the money under it, the pedal
    // lever; the mini-map across the foot. The car's own instruments are in the car.
    const centre = el('div', 'hud-panel-centre');
    centre.append(this.lcdEl, this.moneySlot);
    const row = el('div', 'hud-panel-row');
    row.append(this.rideEl, centre, this.leverEl);
    const dashboard = el('div', 'hud-dashboard-shell');
    dashboard.append(row, this.raceEl);
    this.drivingCluster.append(dashboard);

    this.invMassEl = el('div', 'hud-inv-mass');
    this.invSlotsEl = el('div', 'hud-inv-items');
    this.inventoryEl = el('div', 'hud-inventory');
    this.inventoryEl.append(this.moneyEl, this.invSlotsEl);

    this.toastEl = el('div', 'hud-toasts');
    this.gumBubbleEl = el('div', 'hud-gum-bubble is-hidden');
    this.damageVignetteEl = el('div', 'hud-damage-vignette');
    this.deathFadeEl = el('div', 'hud-death-fade');

    this.tops = [
      this.crosshairEl,
      this.promptEl,
      this.cabinEditorEl,
      this.drivingCluster,
      this.inventoryEl,
      this.toastEl,
      this.gumBubbleEl,
    ];
    // No full-screen blur element: see the note in hud.css for why it was removed
    // rather than tuned.
    root.append(...this.tops, this.damageVignetteEl, this.deathFadeEl);
  }

  private buildRideWidget(): { svg: SVGSVGElement; dot: SVGCircleElement; pulse: SVGCircleElement } {
    const svg = svgEl('svg');
    svg.setAttribute('class', 'hud-ride');
    svg.setAttribute('viewBox', `${-RIDE_R - 4} ${-RIDE_R - 4} ${2 * RIDE_R + 8} ${2 * RIDE_R + 8}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Ride: G-force');
    const ring = (className: string, r: number): SVGCircleElement => {
      const circle = svgEl('circle');
      circle.setAttribute('class', className);
      circle.setAttribute('r', r.toFixed(2));
      svg.appendChild(circle);
      return circle;
    };
    ring('hud-ride-face', RIDE_R + 3);
    ring('hud-ride-zone is-harsh', RIDE_R);
    ring('hud-ride-zone is-uncomfortable', (RIDE_HARSH_MPS2 / RIDE_FULL_MPS2) * RIDE_R);
    ring('hud-ride-zone is-calm', (RIDE_EASY_MPS2 / RIDE_FULL_MPS2) * RIDE_R);
    for (const [x1, y1, x2, y2] of [[-RIDE_R, 0, RIDE_R, 0], [0, -RIDE_R, 0, RIDE_R]] as const) {
      const line = svgEl('line');
      line.setAttribute('class', 'hud-ride-cross');
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      svg.appendChild(line);
    }
    // The car's nose, at the top of the face.
    const nose = svgEl('path');
    nose.setAttribute('class', 'hud-ride-nose');
    nose.setAttribute('d', `M 0 ${-RIDE_R - 2.6} L 2.6 ${-RIDE_R + 1.4} H -2.6 Z`);
    svg.appendChild(nose);
    const pulse = ring('hud-ride-pulse', RIDE_R);
    const dot = ring('hud-ride-dot', 3.4);
    return { svg, dot, pulse };
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
   * Health remains numerical state only. A recent impact temporarily drains colour,
   * hardens contrast and closes in the black edge treatment; death suppresses every
   * interactive HUD child and owns a separate solid fade that may reach full black.
   */
  setHealthEffects(damage: number, dying: boolean, fade: number): void {
    const strength = Math.min(1, Math.max(0, damage));
    if (Math.abs(strength - this.damageStrength) > 0.001) {
      this.damageStrength = strength;
      const edgeOpacity =
        strength <= 0 ? 0 : Math.min(1, 0.34 + strength * 0.66);
      this.damageVignetteEl.style.setProperty(
        '--damage-opacity',
        String(edgeOpacity),
      );
      this.damageVignetteEl.style.setProperty(
        '--damage-inner',
        `${(66 - strength * 38).toFixed(1)}%`,
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
    // The money sits on the panel while driving and beside the pack on foot.
    const moneyHome = readout === null ? this.inventoryEl : this.moneySlot;
    if (this.moneyEl.parentElement !== moneyHome) moneyHome.prepend(this.moneyEl);
    if (readout === null) {
      this.setVisible(this.drivingCluster, false);
      return;
    }
    this.setVisible(this.drivingCluster, true);

    // WHOSE CAR THIS IS, said by the panel's frame: plain while the player drives, the
    // mode's own colour while the autopilot does.
    const mode = readout.autopilotMode;
    if (mode !== this.autopilotFaces) {
      this.autopilotFaces = mode;
      this.drivingCluster.classList.toggle('is-autopilot-sleeper', mode === 'sleeper');
      this.drivingCluster.classList.toggle('is-autopilot-hurried', mode === 'hurried');
      this.drivingCluster.classList.toggle('is-autopilot-frantic', mode === 'frantic');
    }

    // Faults own the display until the car is healthy; radio never trails them.
    const fuelFraction = readout.tankCapacity > 0 ? readout.fuelLitres / readout.tankCapacity : 0;
    const temperature = readout.temperature;
    const warnings: string[] = [];
    if (fuelFraction < FUEL_RESERVE_FRACTION) {
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
    this.refreshSegmentDisplay();
    this.updatePedalLever(readout.pedalLever);
  }

  /** The player's money, kopecks: on the panel while driving, by the pack on foot. */
  setMoney(kopecks: number): void {
    if (kopecks === this.moneyShown) return;
    this.moneyShown = kopecks;
    this.moneyEl.textContent = formatMoney(kopecks);
  }

  /** Player's dashboard size (Settings.dashboardSize), on top of the presentation's own. */
  setDashboardScale(scale: number): void {
    this.drivingCluster.style.setProperty('--hud-dash-scale', String(scale));
  }

  /**
   * The G-force widget on the panel: the ride of the car the player drives, or null for
   * a still face (the dot at the centre).
   */
  setRide(ride: RideReadout | null): void {
    if (ride === null) {
      // A still face: the dot at the centre.
      if (this.rideX !== 0 || this.rideY !== 0) {
        this.rideX = 0;
        this.rideY = 0;
        this.rideDot.setAttribute('cx', '0');
        this.rideDot.setAttribute('cy', '0');
      }
      this.rideShown = false;
      return;
    }
    if (!this.rideShown) {
      this.rideShown = true;
      // What happened before the readings started is not news.
      this.rideHarshSeen = ride.harshMoments;
    }
    // The push is opposite the acceleration: braking throws the load forward (up the
    // face), a left bend throws it right.
    const scale = RIDE_R / RIDE_FULL_MPS2;
    let x = ride.lateral * scale;
    let y = ride.longitudinal * scale;
    const reach = Math.hypot(x, y);
    if (reach > RIDE_R) {
      x *= RIDE_R / reach;
      y *= RIDE_R / reach;
    }
    x = Math.round(x * 4) / 4;
    y = Math.round(y * 4) / 4;
    if (x !== this.rideX || y !== this.rideY) {
      this.rideX = x;
      this.rideY = y;
      this.rideDot.setAttribute('cx', String(x));
      this.rideDot.setAttribute('cy', String(y));
    }
    const magnitude = Math.hypot(ride.longitudinal, ride.lateral);
    const zone = magnitude > RIDE_HARSH_MPS2 ? 2 : magnitude > RIDE_EASY_MPS2 ? 1 : 0;
    if (zone !== this.rideZone) {
      this.rideZone = zone;
      this.rideEl.classList.toggle('is-uncomfortable', zone === 1);
      this.rideEl.classList.toggle('is-harsh', zone === 2);
    }
    if (ride.harshMoments > this.rideHarshSeen) {
      this.rideHarshSeen = ride.harshMoments;
      this.ridePulse.animate(
        [
          { opacity: 0.95, transform: 'scale(0.75)' },
          { opacity: 0, transform: 'scale(1.18)' },
        ],
        { duration: 650, easing: 'ease-out' },
      );
    }
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


  /**
   * The pedal lever scale: six cells, the four throttle notches over neutral over the
   * brake. A frame marks the notch the lever is on; the throttle fills up from neutral
   * and the brake down from it, as the pedals are now, and the throttle fill brightens
   * past the top notch while the key kicks down.
   */
  private buildPedalLever(): { svg: SVGSVGElement; notch: SVGRectElement; throttle: SVGRectElement; brake: SVGRectElement } {
    const svg = svgEl('svg');
    svg.setAttribute('class', 'hud-pedal-lever');
    svg.setAttribute('viewBox', `0 0 ${LEVER_W} ${LEVER_H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Pedal lever');
    const rect = (cls: string, y: number, h: number): SVGRectElement => {
      const r = svgEl('rect');
      r.setAttribute('class', cls);
      r.setAttribute('x', '2');
      r.setAttribute('y', String(y));
      r.setAttribute('width', String(LEVER_W - 4));
      r.setAttribute('height', String(h));
      svg.appendChild(r);
      return r;
    };
    const throttle = rect('hud-lever-throttle', LEVER_NEUTRAL_TOP, 0);
    const brake = rect('hud-lever-brake', LEVER_NEUTRAL_FOOT, 0);
    for (let i = 1; i < LEVER_H / LEVER_CELL; i++) {
      const line = svgEl('line');
      const neutral = i === LEVER_THROTTLE_CELLS || i === LEVER_THROTTLE_CELLS + 1;
      line.setAttribute('class', neutral ? 'hud-lever-tick is-neutral' : 'hud-lever-tick');
      line.setAttribute('x1', '0');
      line.setAttribute('x2', String(LEVER_W));
      line.setAttribute('y1', String(i * LEVER_CELL));
      line.setAttribute('y2', String(i * LEVER_CELL));
      svg.appendChild(line);
    }
    const notch = rect('hud-lever-notch', LEVER_NEUTRAL_TOP, LEVER_CELL);
    notch.setAttribute('x', '0.75');
    notch.setAttribute('width', String(LEVER_W - 1.5));
    return { svg, notch, throttle, brake };
  }

  private updatePedalLever(lever: DrivingReadout['pedalLever']): void {
    this.leverEl.classList.toggle('is-hidden', lever === null);
    if (lever === null) return;
    // Notch n sits n cells above neutral; the brake below it.
    this.setAttr(this.leverNotch, 'y', String(LEVER_NEUTRAL_TOP - lever.notch * LEVER_CELL));
    // The throttle notches are 20 % apart, one cell each; past the top one's 80 % the
    // fill is full and lit as a kickdown.
    const up = Math.min(LEVER_NEUTRAL_TOP, (lever.throttle / 0.2) * LEVER_CELL);
    this.setAttr(this.leverThrottle, 'y', (LEVER_NEUTRAL_TOP - up).toFixed(1));
    this.setAttr(this.leverThrottle, 'height', up.toFixed(1));
    this.leverEl.classList.toggle('is-kickdown', lever.throttle > 0.81);
    // The brake at the car's threshold pedal fills its cell.
    const down = Math.min(1, lever.knee > 0 ? lever.brake / lever.knee : 0) * LEVER_CELL;
    this.setAttr(this.leverBrake, 'height', down.toFixed(1));
  }


  /**
   * The crosshair is the look's: it shows while the view is turned (mouse, stick, touch)
   * and fades out `CROSSHAIR_IDLE_MS` after the last turn, on foot and seated alike. Dim
   * until the aim names something; on something a car works (`actionable`) it fills,
   * and the fill pulses (hud.css `hud-crosshair-pulse`).
   */
  setPrompt(text: string | null, actionable: boolean): void {
    this.setVisible(this.promptEl, text !== null);
    const idle = performance.now() - this.lastLookMs > CROSSHAIR_IDLE_MS;
    this.crosshairEl.classList.toggle('is-idle', idle);
    this.crosshairEl.classList.toggle('is-actionable', actionable);
    this.crosshairEl.classList.toggle('is-dim', !actionable && text === null);
    if (text !== null) this.setText(this.promptEl, text);
  }

  /** Called every rendered frame: whether the view was turned since the last one. */
  noteLook(turned: boolean): void {
    if (turned) this.lastLookMs = performance.now();
  }

  /** The cabin-camera editor's line, or null to hide it. */
  setCabinEditor(text: string | null): void {
    this.setVisible(this.cabinEditorEl, text !== null);
    if (text !== null) this.setText(this.cabinEditorEl, text);
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


  /**
   * The mini-map: the bead line under the panel. `race`: the player and each rival as 0
   * (source post) .. 1 (finish). `delivery`: the player alone, 0 at the last post behind
   * and 1 at the nearest one ahead that will sign for the cargo, `remainingM` away;
   * `place` is that post's place name (world/placenames.ts). `idle`: the same line to the
   * next post with no contract to take there, drawn grey and faint, there to be watched
   * rather than followed. A bead is moved only when it shifts half a pixel.
   */
  setRouteProgress(
    kind: 'race' | 'delivery' | 'idle',
    player: number,
    rivals: readonly number[],
    remainingM: number,
    place = '',
  ): void {
    if (this.disposed) return;
    if (kind !== this.raceKind) {
      this.raceKind = kind;
      this.raceEl.classList.toggle('is-race', kind === 'race');
      this.raceEl.classList.toggle('is-delivery', kind === 'delivery');
      this.raceEl.classList.toggle('is-idle', kind === 'idle');
      this.raceLabelKey = Number.NaN;
    }
    // Tenths of a kilometre out, tens of metres within one: the label is rebuilt only
    // when that reading or the place changes, not every tick.
    const near = remainingM < 1000;
    const key = kind === 'race' ? -1 : near ? Math.round(remainingM / 10) : 1e6 + Math.round(remainingM / 100);
    if (key !== this.raceLabelKey || place !== this.raceLabelPlace) {
      this.raceLabelKey = key;
      this.raceLabelPlace = place;
      const to = place ? `POST · ${place}` : 'POST';
      this.raceLabelEl.textContent = kind === 'race'
        ? 'RACE'
        : near ? `${to} ${key * 10} m` : `${to} ${((key - 1e6) / 10).toFixed(1)} km`;
    }
    const count = kind === 'race' ? rivals.length + 1 : 1;
    while (this.raceBeads.length < count) {
      const bead = el('div', this.raceBeads.length === 0 ? 'hud-race-bead is-player' : 'hud-race-bead');
      this.raceTrackEl.append(bead);
      this.raceBeads.push(bead);
      this.raceBeadX.push(Number.NaN);
    }
    for (let i = 0; i < this.raceBeads.length; i++) this.setVisible(this.raceBeads[i]!, i < count);
    for (let i = 0; i < count; i++) {
      const x = Math.round((i === 0 ? player : rivals[i - 1]!) * RACE_LINE_PX * 2) / 2;
      if (x === this.raceBeadX[i]) continue;
      this.raceBeadX[i] = x;
      this.raceBeads[i]!.style.transform = `translateX(${x}px)`;
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
