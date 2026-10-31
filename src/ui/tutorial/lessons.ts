/**
 * THE CONTROLS TUTORIAL'S LESSONS: what there is to learn, when it is worth saying, and
 * how the game shows it has been learnt. Three presenters (whisper.ts, notebook.ts,
 * manual.ts) draw the same lessons; this file only reads the game.
 *
 * A lesson is never "taught" by a click-through: it is done when the player does the
 * thing (a door opens, the car moves off, a mirror turns), whether a hint was on screen
 * or not. Its context (`when`) says where a hint would be welcome, so nothing is shown
 * to a player who is busy with something else, and nothing is shown twice once done.
 *
 * main.ts fills one `TutorialFrame` per rendered frame and reports the fixed step's
 * one-shot events (`noteTick`); the tracker turns them into edges and timers. It reads
 * the game and writes nothing back but its own progress (localStorage).
 */
import type { FoleyEvent } from '../../audio/foley';

/** One rendered frame of what the tutorial reads. Filled in place by main.ts. */
export interface TutorialFrame {
  dt: number;
  /** Nothing is taught now: a cutscene, dying, a race, a machine framed up close. */
  blocked: boolean;
  /** The player sits in a car (any seat). */
  seated: boolean;
  /** ...in its driver's seat. */
  driver: boolean;
  carId: string | null;
  seat: string;
  /** The drawing camera is the cabin view (not the chase). */
  cabinView: boolean;
  engineRunning: boolean;
  /** Stopped by stop-start: the throttle starts it again, `I` is not needed. */
  autoStopped: boolean;
  /** Stopped by the key or stalled, the starter not turning: `I` would start it. */
  engineOff: boolean;
  speedKmh: number;
  /** The steering wheel, −1..1 of lock. */
  steer: number;
  brake: number;
  throttle: number;
  handbrake: boolean;
  gear: string;
  manualGearbox: boolean;
  /** The pedal lever's throttle notch (core/pedallever.ts), 0 when none or not on keys. */
  notch: number;
  mouseDriving: boolean;
  autopilot: boolean;
  headlightsOn: boolean;
  indicatorOn: boolean;
  night: boolean;
  /** F is held on a mirror and the mouse turns it. */
  aimingMirror: boolean;
  /** The crosshair lit on something F works (`InteractionResult.actionable`). */
  actionable: boolean;
  /** An opened compartment's grid under the eye. */
  bay: 'bonnet' | 'trunk' | null;
  /** On foot, metres to the nearest kit car's centre (Infinity: none near). */
  nearKitCarM: number;
  /** The nearest kit car's (or the driven car's) fuel flap is open. */
  flapOpen: boolean;
  holdingCan: boolean;
  /** On foot: horizontal metres walked this frame. */
  walkedM: number;
  /** On foot: radians the view turned this frame. */
  turnedRad: number;
}

export function emptyTutorialFrame(): TutorialFrame {
  return {
    dt: 0, blocked: true, seated: false, driver: false, carId: null, seat: 'driver', cabinView: false,
    engineRunning: false, autoStopped: false, engineOff: false, speedKmh: 0, steer: 0, brake: 0, throttle: 0, handbrake: false,
    gear: 'N', manualGearbox: false, notch: 0, mouseDriving: false, autopilot: false, headlightsOn: false,
    indicatorOn: false, night: false, aimingMirror: false, actionable: false, bay: null,
    nearKitCarM: Infinity, flapOpen: false, holdingCan: false, walkedM: 0, turnedRad: 0,
  };
}

/** Edges (true for the one frame they happen) and running totals, kept by `LessonTracker`. */
export interface Signals {
  doorOpened: boolean;
  bonnetOpened: boolean;
  bootOpened: boolean;
  flapOpened: boolean;
  poured: boolean;
  gotIn: boolean;
  gotOut: boolean;
  seatChanged: boolean;
  engineStarted: boolean;
  handbrakeReleased: boolean;
  cameraSwitched: boolean;
  gearChanged: boolean;
  indicatorOn: boolean;
  lightsChanged: boolean;
  autopilotOn: boolean;
  walkedM: number;
  turnedRad: number;
  /** Seconds since a door was last opened (Infinity: never). */
  sinceDoorS: number;
  /** Seconds steered (|wheel| > 0.2) while moving. */
  steerS: number;
  /** Seconds braking (> 0.3) above 10 km/h. */
  brakeS: number;
  /** Seconds on a throttle notch above 15 km/h. */
  cruiseS: number;
  /** Seconds holding the throttle key past 30 km/h without a notch. */
  heldThrottleS: number;
  mirrorS: number;
  /** Seconds driven with the mouse above 10 km/h. */
  mouseS: number;
  /** Seconds driven by hand above 5 km/h, this whole session. */
  drivenS: number;
  /** Seconds sat in a car standing still (under 3 km/h), since it last moved. */
  standingS: number;
}

export type Chapter = 'foot' | 'cabin' | 'road';

export const CHAPTER_TITLE: Readonly<Record<Chapter, string>> = {
  foot: 'On foot',
  cabin: 'At the wheel',
  road: 'On the road',
};

/** The manual's pages (manual.ts draws them). */
export type PageId = 'foot' | 'car' | 'fluids' | 'wheel' | 'cabin' | 'lever' | 'mouse' | 'road';

export interface Lesson {
  readonly id: string;
  readonly chapter: Chapter;
  /** The notebook's line: what to try, in a few words. */
  readonly title: string;
  /**
   * The hint, with key glyphs: `{action}` is the key bound to a `BINDABLE_ACTIONS` id,
   * `{wasd}` the four movement keys, `{lmb}` `{rmb}` `{mmb}` `{mouse}` `{wheel}` the mouse.
   */
  readonly hint: string;
  /** The manual page that explains it. */
  readonly page: PageId;
  /** Whether it applies to this player at all (a manual gearbox's gears). */
  readonly applies?: (f: TutorialFrame) => boolean;
  /** Where a hint for it would be welcome. */
  readonly when: (f: TutorialFrame, s: Signals) => boolean;
  /** Seconds `when` must hold before a hint is shown: room to find it first. */
  readonly dwell: number;
  readonly done: (f: TutorialFrame, s: Signals) => boolean;
  /** The F key is the answer and the crosshair is lit: the hint's key can light up too. */
  readonly interact?: boolean;
}

const NEAR_CAR_M = 6;
const nearCar = (f: TutorialFrame): boolean => !f.seated && f.nearKitCarM < NEAR_CAR_M;
const driving = (f: TutorialFrame): boolean => f.driver && !f.autopilot;

export const LESSONS: readonly Lesson[] = [
  // ---- On foot ------------------------------------------------------------------
  {
    id: 'walk', chapter: 'foot', page: 'foot', dwell: 2.5,
    title: 'Walk and look around',
    hint: '{wasd} walk · {mouse} look around · hold {sprint} to hurry',
    when: (f) => !f.seated,
    done: (_f, s) => s.walkedM > 8 && s.turnedRad > 1.2,
  },
  {
    id: 'door', chapter: 'foot', page: 'car', dwell: 3, interact: true,
    title: 'Open a car door',
    hint: 'Look at a door and press {interact}',
    when: nearCar,
    done: (_f, s) => s.doorOpened,
  },
  {
    id: 'getIn', chapter: 'foot', page: 'car', dwell: 2.5, interact: true,
    title: 'Get in',
    hint: 'Look through the open door at a seat · {interact} to sit down',
    when: (f, s) => nearCar(f) && s.sinceDoorS < 90,
    done: (_f, s) => s.gotIn,
  },
  {
    id: 'bonnet', chapter: 'foot', page: 'car', dwell: 5, interact: true,
    title: 'Look under the bonnet',
    hint: 'Aim at the bonnet · {interact} lifts it, {interact} again lets it down',
    when: nearCar,
    done: (_f, s) => s.bonnetOpened,
  },
  {
    id: 'boot', chapter: 'foot', page: 'car', dwell: 6, interact: true,
    title: 'Open the boot',
    hint: 'The boot lid or tailgate opens on {interact} too',
    when: nearCar,
    done: (_f, s) => s.bootOpened,
  },
  {
    id: 'flap', chapter: 'foot', page: 'car', dwell: 8, interact: true,
    title: 'Find the fuel flap',
    hint: 'A small flap on the body is the tank · {interact} opens it',
    when: nearCar,
    done: (_f, s) => s.flapOpened,
  },
  {
    id: 'fluids', chapter: 'foot', page: 'fluids', dwell: 2,
    title: 'Top up oil, water or petrol',
    hint: 'Can in hand, aim at the engine, the radiator or the open flap · hold {lmb} to pour',
    when: (f) => !f.seated && (f.holdingCan || f.bay === 'bonnet' || f.flapOpen),
    done: (_f, s) => s.poured,
  },
  // ---- At the wheel -------------------------------------------------------------
  {
    // The display already reads ENGINE OFF - I START: the whisper waits a little longer.
    id: 'engine', chapter: 'cabin', page: 'wheel', dwell: 4,
    title: 'Start the engine',
    hint: '{engine} turns the key',
    when: (f) => f.driver && f.engineOff,
    done: (_f, s) => s.engineStarted,
  },
  {
    id: 'handbrake', chapter: 'cabin', page: 'wheel', dwell: 2.5,
    title: 'Let the handbrake off',
    hint: 'The red P is the handbrake · {handbrake} lets it off',
    when: (f) => driving(f) && (f.engineRunning || f.autoStopped) && f.handbrake,
    done: (_f, s) => s.handbrakeReleased,
  },
  {
    id: 'go', chapter: 'cabin', page: 'wheel', dwell: 2,
    title: 'Move off',
    hint: 'Hold {throttle} to go · {brake} to slow down',
    when: (f) => driving(f) && (f.engineRunning || f.autoStopped) && !f.handbrake && f.speedKmh < 3,
    done: (f) => f.driver && f.speedKmh > 12,
  },
  {
    id: 'steer', chapter: 'cabin', page: 'wheel', dwell: 3,
    title: 'Steer',
    hint: '{left} {right} turn the steering wheel · let go and it comes back',
    when: (f) => driving(f) && f.speedKmh > 5,
    done: (_f, s) => s.steerS > 1.5,
  },
  {
    id: 'brake', chapter: 'cabin', page: 'wheel', dwell: 6,
    title: 'Brake to a stop',
    hint: 'Hold {brake} to brake · held at a standstill it backs up',
    when: (f) => driving(f) && f.speedKmh > 20,
    done: (_f, s) => s.brakeS > 0.6,
  },
  {
    id: 'camera', chapter: 'cabin', page: 'wheel', dwell: 4,
    title: 'Switch the view',
    hint: '{camera} chase view or the seat · {recenterCamera} looks ahead again',
    when: (f, s) => f.seated && s.drivenS > 12,
    done: (_f, s) => s.cameraSwitched,
  },
  {
    id: 'mirror', chapter: 'cabin', page: 'cabin', dwell: 8,
    title: 'Set a mirror',
    hint: 'Look at a mirror · hold {interact} and move {mouse}',
    when: (f) => f.seated && f.cabinView,
    done: (_f, s) => s.mirrorS > 0.4,
  },
  {
    id: 'seat', chapter: 'cabin', page: 'cabin', dwell: 12, interact: true,
    title: 'Try another seat',
    hint: 'Standing still, look at another seat · {interact} moves you there',
    when: (f) => f.seated && f.cabinView && f.speedKmh < 3,
    done: (_f, s) => s.seatChanged,
  },
  {
    id: 'getOut', chapter: 'cabin', page: 'cabin', dwell: 3,
    title: 'Get out',
    hint: 'Stopped, look out at the road · {interact} gets out by the nearest door',
    when: (f, s) => f.seated && s.standingS > 25,
    done: (_f, s) => s.gotOut,
  },
  // ---- On the road --------------------------------------------------------------
  {
    id: 'cruise', chapter: 'road', page: 'lever', dwell: 1,
    title: 'Cruise on the lever',
    hint: 'Tap {throttle}: the lever stays at 20 · 40 · 60 · 80 % · a tap of {brake} drops a notch',
    when: (f, s) => driving(f) && s.heldThrottleS > 8,
    done: (_f, s) => s.cruiseS > 2,
  },
  {
    id: 'gears', chapter: 'road', page: 'wheel', dwell: 3,
    title: 'Change gear',
    hint: '{shiftUp} up a gear · {shiftDown} down',
    applies: (f) => f.manualGearbox,
    when: (f) => driving(f) && f.manualGearbox && f.speedKmh > 5,
    done: (_f, s) => s.gearChanged,
  },
  {
    id: 'indicators', chapter: 'road', page: 'road', dwell: 25,
    title: 'Signal a turn',
    hint: '{indicatorLeft} left blinker · {indicatorRight} right',
    when: (f) => driving(f) && f.speedKmh > 15,
    done: (_f, s) => s.indicatorOn,
  },
  {
    id: 'lights', chapter: 'road', page: 'road', dwell: 3,
    title: 'Headlights',
    hint: '{lights} dipped · main beam · off',
    when: (f) => f.driver && f.night && !f.headlightsOn,
    done: (_f, s) => s.lightsChanged,
  },
  {
    id: 'mouse', chapter: 'road', page: 'mouse', dwell: 1,
    title: 'Drive with the mouse',
    hint: '{mouseDriving} mouse driving: {mouse} turns the wheel · {lmb} gas · {rmb} brake · hold {mouseLook} to look',
    when: (f, s) => driving(f) && f.speedKmh > 10 && s.drivenS > 50,
    done: (_f, s) => s.mouseS > 3,
  },
  {
    id: 'autopilot', chapter: 'road', page: 'road', dwell: 1,
    title: 'Let the car drive',
    hint: '{autopilot} autopilot: sleeper · hurried · frantic · off',
    when: (f, s) => driving(f) && f.speedKmh > 30 && s.drivenS > 110,
    done: (_f, s) => s.autopilotOn,
  },
];

export const CHAPTERS: readonly Chapter[] = ['foot', 'cabin', 'road'];

/** Watches frames, keeps the edges and timers, and marks lessons done. */
export class LessonTracker {
  readonly done = new Set<string>();
  readonly signals: Signals = {
    doorOpened: false, bonnetOpened: false, bootOpened: false, flapOpened: false, poured: false,
    gotIn: false, gotOut: false, seatChanged: false, engineStarted: false, handbrakeReleased: false,
    cameraSwitched: false, gearChanged: false, indicatorOn: false, lightsChanged: false, autopilotOn: false,
    walkedM: 0, turnedRad: 0, sinceDoorS: Infinity, steerS: 0, brakeS: 0, cruiseS: 0, heldThrottleS: 0,
    mirrorS: 0, mouseS: 0, drivenS: 0, standingS: 0,
  };
  /** Seconds each lesson's context has held without a break. */
  private readonly contextS = new Map<string, number>();
  /** The fixed step's events since the last frame. */
  private pendingFoley = 0;
  private pendingPour = false;
  private prev: TutorialFrame | null = null;
  /** Called with a lesson's id the frame it is done. */
  onDone: ((id: string) => void) | null = null;

  constructor(done: Iterable<string>) {
    for (const id of done) this.done.add(id);
  }

  /** One fixed step's sound and continuous action (`InteractionResult`). */
  noteTick(sound: FoleyEvent | null, pouring: boolean): void {
    if (sound === 'door-open') this.pendingFoley |= 1;
    else if (sound === 'bonnet-open') this.pendingFoley |= 2;
    else if (sound === 'boot-open') this.pendingFoley |= 4;
    if (pouring) this.pendingPour = true;
  }

  /** Seconds the lesson's context has held, 0 when it does not hold now. */
  held(id: string): number {
    return this.contextS.get(id) ?? 0;
  }

  update(f: TutorialFrame): void {
    const s = this.signals;
    const p = this.prev;
    const dt = f.dt;
    s.doorOpened = (this.pendingFoley & 1) !== 0;
    s.bonnetOpened = (this.pendingFoley & 2) !== 0;
    s.bootOpened = (this.pendingFoley & 4) !== 0;
    s.poured = this.pendingPour;
    this.pendingFoley = 0;
    this.pendingPour = false;
    s.sinceDoorS = s.doorOpened ? 0 : s.sinceDoorS + dt;
    s.flapOpened = p !== null && f.flapOpen && !p.flapOpen;
    s.gotIn = p !== null && f.seated && !p.seated;
    s.gotOut = p !== null && !f.seated && p.seated;
    s.seatChanged = p !== null && f.seated && p.seated && f.carId === p.carId && f.seat !== p.seat;
    // A stop-start restart is the throttle's doing, not the key's.
    s.engineStarted = p !== null && f.driver && p.driver && f.engineRunning && !p.engineRunning && !p.autoStopped;
    s.handbrakeReleased = p !== null && f.driver && p.driver && !f.handbrake && p.handbrake;
    s.cameraSwitched = p !== null && f.seated && p.seated && f.cabinView !== p.cabinView;
    // An automatic changes gear by itself: only a manual box's change is the player's.
    s.gearChanged = p !== null && f.driver && p.driver && f.manualGearbox && f.carId === p.carId && f.gear !== p.gear && f.speedKmh > 3;
    s.indicatorOn = p !== null && f.driver && f.indicatorOn && !p.indicatorOn;
    s.lightsChanged = p !== null && f.driver && p.driver && f.headlightsOn !== p.headlightsOn;
    s.autopilotOn = p !== null && f.driver && f.autopilot && !p.autopilot;
    if (!f.seated) {
      s.walkedM += f.walkedM;
      s.turnedRad += f.turnedRad;
    }
    const byHand = f.driver && !f.autopilot;
    const moving = f.speedKmh > 5;
    s.steerS += byHand && moving && Math.abs(f.steer) > 0.2 ? dt : 0;
    s.brakeS += byHand && f.speedKmh > 10 && f.brake > 0.3 ? dt : 0;
    s.cruiseS = byHand && f.notch > 0 && f.speedKmh > 15 ? s.cruiseS + dt : 0;
    s.heldThrottleS = byHand && f.notch === 0 && f.speedKmh > 30 && f.throttle > 0.3 ? s.heldThrottleS + dt : 0;
    s.mirrorS = f.aimingMirror ? s.mirrorS + dt : 0;
    s.mouseS = byHand && f.mouseDriving && f.speedKmh > 10 ? s.mouseS + dt : 0;
    s.drivenS += byHand && moving ? dt : 0;
    s.standingS = f.seated && f.speedKmh < 3 ? s.standingS + dt : 0;

    for (const lesson of LESSONS) {
      if (this.done.has(lesson.id)) continue;
      if (lesson.done(f, s)) {
        this.done.add(lesson.id);
        this.contextS.delete(lesson.id);
        this.onDone?.(lesson.id);
        continue;
      }
      if (!f.blocked && lesson.when(f, s)) this.contextS.set(lesson.id, (this.contextS.get(lesson.id) ?? 0) + dt);
      else this.contextS.delete(lesson.id);
    }
    if (p === null) this.prev = { ...f };
    else Object.assign(p, f);
  }
}

/** The situation's chapter: what the player is doing now. */
export function chapterNow(f: TutorialFrame): Chapter {
  if (!f.seated) return 'foot';
  return f.driver && f.speedKmh > 25 ? 'road' : 'cabin';
}

const STORE_KEY = 'brodrive-tutorial-v1';

export type TutorialVariant = 'whisper' | 'notebook' | 'manual';

export interface TutorialProgress {
  variant: TutorialVariant | null;
  done: string[];
  /** Manual pages opened at least once. */
  read: string[];
}

export function loadProgress(): TutorialProgress {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TutorialProgress>;
      const variant = parsed.variant === 'whisper' || parsed.variant === 'notebook' || parsed.variant === 'manual'
        ? parsed.variant
        : null;
      return {
        variant,
        done: Array.isArray(parsed.done) ? parsed.done.filter((x) => typeof x === 'string') : [],
        read: Array.isArray(parsed.read) ? parsed.read.filter((x) => typeof x === 'string') : [],
      };
    }
  } catch {
    // A broken record is no tutorial.
  }
  return { variant: null, done: [], read: [] };
}

export function saveProgress(progress: TutorialProgress): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(progress));
  } catch {
    // Private mode: the tutorial forgets on reload, nothing else breaks.
  }
}
