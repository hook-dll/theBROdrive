import { itemLabel } from '../items/items';
import type { Item } from '../items/items';
import type { EngineTempReadout } from '../vehicle/cooling';
import type { AutopilotMode } from '../vehicle/autopilot';
import { FUEL_RESERVE_FRACTION } from '../parts/registry';
import { installShellStyle, setGameText } from './shellsprites';
import { MapScreen, type MapSource, type MapView } from './hudmap';
import { ShellJar } from './hudjar';
import { GyroOrb, type PedalReadout, type RideReadout } from './hudgyro';
import { RaceHud } from './hudrace';
import type { RaceReadout } from '../race/director';

export type { MapPost, MapSource, MapView } from './hudmap';
export { newMapView } from './hudmap';
export type { PedalReadout, RideReadout } from './hudgyro';

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
   * The key that starts the engine (`InputReader.keyLabel('engine')`) while it is stopped
   * and the player sits in the driver's seat; null otherwise. The display then tells him.
   */
  engineStartKey: string | null;
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
   * The pedals as the car is given them now — by keys, a pad, a touch screen or the
   * autopilot — with the keyboard PEDAL LEVER's notch (core/pedallever.ts) while it
   * drives them: the lever scale beside the gyro orb (ui/hudgyro.ts).
   */
  pedals: PedalReadout;
  /** Stopped by stop-start (`Vehicle.stepAutoStop`), not by the key or a stall: no ENGINE OFF. */
  autoStopped: boolean;
  /** The handbrake is on: the display's last digit is a red P. */
  parked: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

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
/**
 * The crosshair fades this long after the view was last turned: long enough to read
 * what the aim settled on, short enough that a still view is clean (owner: 3-5 s).
 */
const CROSSHAIR_IDLE_MS = 4000;
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
  /**
   * THE PANEL along the top edge, on foot and driving alike: the navigator screen in the
   * left corner (`map`), the gyro orb and the pedal lever scale in the right one (`gyro`),
   * and between them the POD — the segment display. The display and the gyro go dark
   * on foot; the map stays lit. The shell jar is not on it: it stands in its own corner,
   * out on foot on a lay-by (`setShellsShown`) and for a moment whenever the shells change.
   */
  private readonly panelEl: HTMLElement;
  private readonly podEl: HTMLElement;
  private readonly map: MapScreen;
  private readonly gyro: GyroOrb;
  private readonly invMassEl: HTMLElement;
  private readonly invSlotsEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly inventoryEl: HTMLElement;
  private readonly lcdEl: SVGSVGElement;
  /** The shell jar (`setShells`, ui/hudjar.ts). */
  private readonly jar: ShellJar;
  /** The race's countdown, lap chip and result banner (`setRace`, ui/hudrace.ts). */
  private readonly race: RaceHud;
  private readonly lcdDigits: readonly SVGGElement[];
  private readonly gumBubbleEl: HTMLElement;
  private readonly damageVignetteEl: HTMLElement;
  private readonly deathFadeEl: HTMLElement;
  private readonly root: HTMLElement;
  private damageStrength = -1;
  private deathFade = -1;
  private gumBubbleProgress = -1;
  private warningsSignature = '';
  /** Whether the instruments are lit: the player is in a car. */
  private driving: boolean | null = null;
  /**
   * The mode the faces are currently painted for, so the class writes happen on a
   * mode CHANGE rather than on every frame the autopilot is engaged.
   */
  private autopilotFaces: AutopilotMode | null = null;
  private engineOff = false;
  private engineStartKey: string | null = null;
  /** The handbrake is on: a red P in the display's last digit (`refreshSegmentDisplay`). */
  private parked = false;
  /** Digits the message ran in at the last refresh: one fewer while `parked`. */
  private displayWidth = LCD_DIGITS;
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

  constructor(root: HTMLElement, mapSource: MapSource) {
    this.root = root;
    installShellStyle();
    this.crosshairEl = el('div', 'hud-crosshair');

    this.promptEl = el('div', 'hud-prompt is-hidden');

    const display = this.buildSegmentDisplay();
    this.lcdEl = display.svg;
    this.lcdDigits = display.digits;

    this.jar = new ShellJar();

    this.podEl = el('div', 'hud-pod');
    this.podEl.append(this.lcdEl);
    this.map = new MapScreen(mapSource);
    this.gyro = new GyroOrb();
    this.panelEl = el('div', 'hud-panel');
    this.panelEl.append(this.map.el, this.podEl, this.gyro.el);

    this.invMassEl = el('div', 'hud-inv-mass');
    this.invSlotsEl = el('div', 'hud-inv-items');
    this.inventoryEl = el('div', 'hud-inventory');
    this.inventoryEl.append(this.invSlotsEl);

    this.toastEl = el('div', 'hud-toasts');
    this.race = new RaceHud();
    this.gumBubbleEl = el('div', 'hud-gum-bubble is-hidden');
    this.damageVignetteEl = el('div', 'hud-damage-vignette');
    this.deathFadeEl = el('div', 'hud-death-fade');

    this.tops = [
      this.crosshairEl,
      this.promptEl,
      this.panelEl,
      this.jar.el,
      this.inventoryEl,
      this.toastEl,
      this.gumBubbleEl,
      this.race.el,
    ];
    // No full-screen blur element: see the note in hud.css for why it was removed
    // rather than tuned.
    root.append(...this.tops, this.damageVignetteEl, this.deathFadeEl);
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

  /**
   * The car's readout while the player is in one, or null on foot: the instruments then
   * go dark — the display blank, the gyro still and the lever scale empty.
   */
  setDriving(readout: DrivingReadout | null): void {
    const driving = readout !== null;
    if (driving !== this.driving) {
      this.driving = driving;
      this.panelEl.classList.toggle('is-driving', driving);
      if (!driving) {
        this.warningsSignature = '';
        this.engineOff = false;
        this.engineStartKey = null;
        this.parked = false;
        this.refreshSegmentDisplay();
        this.gyro.setPedals(null);
      }
    }
    if (readout === null) {
      if (this.autopilotFaces !== null) this.setAutopilotFaces(null);
      return;
    }

    // WHOSE CAR THIS IS, said by the panel's frame: plain while the player drives, the
    // mode's own colour while the autopilot does.
    if (readout.autopilotMode !== this.autopilotFaces) this.setAutopilotFaces(readout.autopilotMode);

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
    // An engine stop-start stopped (`Vehicle.stepAutoStop`) is not a fault: the pedal
    // starts it, so the display says nothing about it.
    this.engineOff = !readout.engineRunning && !readout.autoStopped;
    this.engineStartKey = readout.engineStartKey;
    this.parked = readout.parked;
    this.refreshSegmentDisplay();
    this.gyro.setPedals(readout.pedals);
  }

  private setAutopilotFaces(mode: AutopilotMode | null): void {
    this.autopilotFaces = mode;
    this.podEl.classList.toggle('is-autopilot-sleeper', mode === 'sleeper');
    this.podEl.classList.toggle('is-autopilot-hurried', mode === 'hurried');
    this.podEl.classList.toggle('is-autopilot-frantic', mode === 'frantic');
  }

  /** The player's shells in the jar: poured in as they come, lifted out as they go, the jar flashing into sight to show it. */
  setShells(count: number): void {
    this.jar.set(count);
  }

  /** The race at a track (race/director.ts): countdown, lap and place, result. */
  setRace(readout: RaceReadout): void {
    this.race.set(readout);
  }

  /** `count` shells pushed out of the full jar by new ones: called just before the `setShells` that brings them in. */
  spillShells(count: number): void {
    this.jar.spill(count);
  }

  /** `count` shells taken by a fine (economy/economy.ts `fine`): called just before the `setShells` that takes them out. */
  fineShells(count: number): void {
    this.jar.fine(count);
  }

  /** The shell jar out in its corner (on foot on a lay-by, main.ts), or put away. */
  setShellsShown(shown: boolean): void {
    this.jar.setShown(shown);
  }

  /** Player's dashboard size (Settings.dashboardSize): the whole panel scales with it. */
  setDashboardScale(scale: number): void {
    this.root.style.setProperty('--hud-dash-scale', String(scale));
  }

  /** The gyro orb's steel ball: the ride of the car the player drives, or null for a still bowl. */
  setRide(ride: RideReadout | null): void {
    this.gyro.setRide(ride);
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
      if (this.engineStartKey) problemMessage += ` - ${this.engineStartKey} START`;
    }
    const hasProblems = problemMessage.length > 0;
    const radioMessage = this.radioText === RADIO_OFF_MESSAGE && now >= this.radioOffUntil
      ? ''
      : (this.radioText ?? '');
    // On foot the display is dark.
    const rawMessage = !this.driving ? '' : hasProblems ? problemMessage : radioMessage;
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

    // The handbrake's P holds the last digit; the message runs in the digits before it.
    const width = this.parked ? LCD_DIGITS - 1 : LCD_DIGITS;
    let offset = 0;
    if (message.length > width) {
      const elapsedSteps = Math.floor((now - this.displayEpoch) / LCD_STEP_MS);
      offset = Math.max(0, elapsedSteps - LCD_INITIAL_PAUSE_STEPS) % (message.length + 3);
    }
    if (offset === this.displayOffset && width === this.displayWidth) return;
    this.displayOffset = offset;
    this.displayWidth = width;

    let frame: string;
    if (message.length <= width) {
      const leftPadding = Math.floor((width - message.length) / 2);
      frame = `${' '.repeat(leftPadding)}${message}`.padEnd(width);
    } else {
      const scroll = `${message}   `;
      frame = `${scroll}${scroll}`.slice(offset, offset + width);
    }
    if (this.parked) frame += 'P';
    const last = this.lcdDigits[LCD_DIGITS - 1]!;
    if (last.classList.contains('is-park') !== this.parked) last.classList.toggle('is-park', this.parked);
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
    if (text !== null) setGameText(this.promptEl, text);
  }

  /** Called every rendered frame: whether the view was turned since the last one. */
  noteLook(turned: boolean): void {
    if (turned) this.lastLookMs = performance.now();
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


  /** The navigator screen: see ui/hudmap.ts. */
  setMap(view: MapView): void {
    if (this.disposed) return;
    this.map.update(view);
  }

  setToast(text: string): void {
    if (this.disposed) return;
    const toast = el('div', 'hud-toast');
    setGameText(toast, text);
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
    this.map.dispose();
    this.jar.dispose();
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
