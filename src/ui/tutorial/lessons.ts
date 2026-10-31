/**
 * THE CONTROLS TUTORIAL'S LESSONS: what there is to learn, when it is worth saying, and
 * how the game shows it has been learnt. whisper.ts draws them; this file only reads.
 *
 * Three kinds, each counted done only when the player really does the thing, hint or no
 * hint, and never shown again after:
 *
 *  - THE FIRST STEPS (`walk`): the movement keys and the mouse, no words, shown to a
 *    player who has just appeared on foot, gone once he has walked and looked round.
 *  - AIM HINTS (`AIM_KINDS`): the F key beside the crosshair while it rests on a door,
 *    a lid, the fuel flap, a seat, a mirror or a cabin fitting nobody has used yet.
 *    Gone the moment the aim leaves it; done on F pressed at it (the mirror: on turning it).
 *  - WHISPERS (`LESSONS`): one short line where it helps, after the player has had time
 *    to find it alone (`Lesson.dwell`).
 *
 * main.ts fills one `TutorialFrame` per rendered frame and reports the fixed step's
 * events (`noteTick`); the tracker turns them into edges and timers. It reads the game
 * and writes nothing back but its own progress (localStorage).
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
  /** The drawing camera is the cabin view (not the chase). */
  cabinView: boolean;
  engineRunning: boolean;
  /** Stopped by stop-start: the throttle starts it again, `I` is not needed. */
  autoStopped: boolean;
  /** Stopped by the key or stalled, the starter not turning: `I` would start it. */
  engineOff: boolean;
  speedKmh: number;
  brake: number;
  throttle: number;
  handbrake: boolean;
  gear: string;
  manualGearbox: boolean;
  /** The pedal lever's throttle notch (core/pedallever.ts), 0 when none or not on keys. */
  notch: number;
  mouseDriving: boolean;
  /** The mouse-driving look hold (Shift or the middle button) is down. */
  mouseLookHeld: boolean;
  autopilot: boolean;
  headlightsOn: boolean;
  indicatorOn: boolean;
  night: boolean;
  /** F is held on a mirror and the mouse turns it. */
  aimingMirror: boolean;
  /** What F would work in the aim now (`aimKindOf`), or null. */
  aim: AimKind | null;
  /** An opened compartment's grid under the eye. */
  bay: 'bonnet' | 'trunk' | null;
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
    dt: 0, blocked: true, seated: false, driver: false, carId: null, cabinView: false,
    engineRunning: false, autoStopped: false, engineOff: false, speedKmh: 0, brake: 0, throttle: 0,
    handbrake: false, gear: 'N', manualGearbox: false, notch: 0, mouseDriving: false, mouseLookHeld: false,
    autopilot: false, headlightsOn: false, indicatorOn: false, night: false, aimingMirror: false, aim: null,
    bay: null, flapOpen: false, holdingCan: false, walkedM: 0, turnedRad: 0,
  };
}

/** The unnamed kit things F works, grouped as the player learns them. */
export type AimKind = 'door' | 'bonnet' | 'boot' | 'flap' | 'seat' | 'mirror' | 'fitting';

/** The lesson id of an aim hint. */
export const aimLesson = (kind: AimKind): string => `aim:${kind}`;

/**
 * An aimed kit control (`Interaction.aimId`) as a hint: a side door or sliding door, the
 * bonnet, the boot lid or tailgate (and a truck's boards and tent flap), the fuel flap, a
 * seat, any mirror, and everything else in the cabin F works (the light switch, stalks,
 * hazards, the radio knob, the horn, window cranks, visors, the courtesy lamp).
 */
export function aimKindOf(id: string | null): AimKind | null {
  if (id === null) return null;
  if (id === 'seat') return 'seat';
  if (id.startsWith('door_')) return 'door';
  if (id === 'bonnet') return 'bonnet';
  if (id === 'boot' || id.startsWith('tailgate') || id.startsWith('board_') || id === 'tent_flap') return 'boot';
  if (id === 'flap') return 'flap';
  if (id.startsWith('mirror')) return 'mirror';
  return 'fitting';
}

/** Edges (true for the one frame they happen) and running totals, kept by `LessonTracker`. */
export interface Signals {
  poured: boolean;
  gotOut: boolean;
  engineStarted: boolean;
  handbrakeReleased: boolean;
  cameraSwitched: boolean;
  gearChanged: boolean;
  indicatorOn: boolean;
  lightsChanged: boolean;
  autopilotOn: boolean;
  mouseDrivingOn: boolean;
  walkedM: number;
  turnedRad: number;
  /** Seconds braking (> 0.3) above 10 km/h. */
  brakeS: number;
  /** Seconds on a throttle notch above 15 km/h. */
  cruiseS: number;
  /** Seconds holding the throttle key past 30 km/h without a notch. */
  heldThrottleS: number;
  mirrorS: number;
  /** Seconds the look hold has been down while mouse driving. */
  mouseLookS: number;
  /** Seconds driven by hand above 5 km/h, this whole session. */
  drivenS: number;
  /** Seconds sat in a car standing still (under 3 km/h), since it last moved. */
  standingS: number;
}

/** The first steps: on foot, no words; done once he has walked and looked round. */
export const WALK = 'walk';
const walkDone = (s: Signals): boolean => s.walkedM > 6 && s.turnedRad > 1;

export interface Lesson {
  readonly id: string;
  /**
   * The line, with key glyphs: `{action}` is the key bound to a `BINDABLE_ACTIONS` id,
   * `{lmb}` `{rmb}` `{mmb}` `{mouse}` the mouse.
   */
  readonly hint: string;
  /** Said at once, over whatever line is showing: the player has just switched into it. */
  readonly urgent?: boolean;
  /** Whether it applies to this player at all (a manual gearbox's gears). */
  readonly applies?: (f: TutorialFrame) => boolean;
  /** Where a line for it would be welcome. */
  readonly when: (f: TutorialFrame, s: Signals) => boolean;
  /** Seconds `when` must hold before the line is shown: room to find it first. */
  readonly dwell: number;
  readonly done: (f: TutorialFrame, s: Signals) => boolean;
}

const driving = (f: TutorialFrame): boolean => f.driver && !f.autopilot;
const ready = (f: TutorialFrame): boolean => f.engineRunning || f.autoStopped;

export const LESSONS: readonly Lesson[] = [
  {
    id: 'fluids', dwell: 2,
    hint: 'Hold {lmb} to pour',
    when: (f) => !f.seated && f.holdingCan && (f.bay === 'bonnet' || f.flapOpen),
    done: (_f, s) => s.poured,
  },
  {
    // The display already reads ENGINE OFF - I START: the line waits a little longer.
    id: 'engine', dwell: 4,
    hint: '{engine} start the engine',
    when: (f) => f.driver && f.engineOff,
    done: (_f, s) => s.engineStarted,
  },
  {
    id: 'handbrake', dwell: 2.5,
    hint: '{handbrake} handbrake off',
    when: (f) => driving(f) && ready(f) && f.handbrake,
    done: (_f, s) => s.handbrakeReleased,
  },
  {
    id: 'go', dwell: 2,
    hint: '{throttle} go · {brake} brake',
    when: (f) => driving(f) && ready(f) && !f.handbrake && f.speedKmh < 3,
    done: (f) => f.driver && f.speedKmh > 12,
  },
  {
    id: 'brake', dwell: 6,
    hint: 'Hold {brake} to brake · at a stop it backs up',
    when: (f) => driving(f) && f.speedKmh > 20,
    done: (_f, s) => s.brakeS > 0.6,
  },
  {
    id: 'camera', dwell: 4,
    hint: '{camera} behind the car or in the seat',
    when: (f, s) => f.seated && s.drivenS > 12,
    done: (_f, s) => s.cameraSwitched,
  },
  {
    id: 'getOut', dwell: 3,
    hint: 'Look out at the road · {interact} get out',
    when: (f, s) => f.seated && f.aim === null && s.standingS > 25,
    done: (_f, s) => s.gotOut,
  },
  {
    id: 'cruise', dwell: 1,
    hint: 'Tap {throttle} to cruise: each tap a notch, 20 to 80 %',
    when: (f, s) => driving(f) && s.heldThrottleS > 8,
    done: (_f, s) => s.cruiseS > 2,
  },
  {
    id: 'gears', dwell: 3,
    hint: '{shiftUp} gear up · {shiftDown} gear down',
    applies: (f) => f.manualGearbox,
    when: (f) => driving(f) && f.manualGearbox && f.speedKmh > 5,
    done: (_f, s) => s.gearChanged,
  },
  {
    id: 'mouse', dwell: 1,
    hint: '{mouseDriving} drive with the mouse or the keyboard',
    when: (f, s) => driving(f) && !f.mouseDriving && f.speedKmh > 10 && s.drivenS > 40,
    done: (_f, s) => s.mouseDrivingOn,
  },
  {
    id: 'mouseLook', dwell: 1, urgent: true,
    hint: 'Hold {mouseLook} to look around',
    when: (f) => driving(f) && f.mouseDriving,
    done: (_f, s) => s.mouseLookS > 0.4,
  },
  {
    id: 'indicators', dwell: 25,
    hint: '{indicatorLeft} {indicatorRight} blinkers',
    when: (f) => driving(f) && f.speedKmh > 15,
    done: (_f, s) => s.indicatorOn,
  },
  {
    id: 'lights', dwell: 3,
    hint: '{lights} headlights',
    when: (f) => f.driver && f.night && !f.headlightsOn,
    done: (_f, s) => s.lightsChanged,
  },
  {
    id: 'autopilot', dwell: 1,
    hint: '{autopilot} autopilot',
    when: (f, s) => driving(f) && f.speedKmh > 30 && s.drivenS > 110,
    done: (_f, s) => s.autopilotOn,
  },
];

/** Watches frames, keeps the edges and timers, and marks lessons done. */
export class LessonTracker {
  readonly done = new Set<string>();
  readonly signals: Signals = {
    poured: false, gotOut: false, engineStarted: false, handbrakeReleased: false, cameraSwitched: false,
    gearChanged: false, indicatorOn: false, lightsChanged: false, autopilotOn: false, mouseDrivingOn: false,
    walkedM: 0, turnedRad: 0, brakeS: 0, cruiseS: 0, heldThrottleS: 0, mirrorS: 0, mouseLookS: 0,
    drivenS: 0, standingS: 0,
  };
  /** Seconds each lesson's context has held without a break. */
  private readonly contextS = new Map<string, number>();
  private pendingPour = false;
  /** Aim kinds F was pressed at since the last frame. */
  private readonly pendingUsed = new Set<AimKind>();
  private prev: TutorialFrame | null = null;
  /** Called with a lesson's id the frame it is done. */
  onDone: ((id: string) => void) | null = null;

  constructor(done: Iterable<string>) {
    for (const id of done) this.done.add(id);
  }

  /** One fixed step: its continuous action, and F pressed at an aimed kit thing. */
  noteTick(_sound: FoleyEvent | null, pouring: boolean, aim: AimKind | null, pressed: boolean): void {
    if (pouring) this.pendingPour = true;
    // The mirror is learnt by turning it (`aimingMirror`), not by the press that starts it.
    if (pressed && aim !== null && aim !== 'mirror') this.pendingUsed.add(aim);
  }

  /** Seconds the lesson's context has held, 0 when it does not hold now. */
  held(id: string): number {
    return this.contextS.get(id) ?? 0;
  }

  private mark(id: string): void {
    if (this.done.has(id)) return;
    this.done.add(id);
    this.contextS.delete(id);
    this.onDone?.(id);
  }

  update(f: TutorialFrame): void {
    const s = this.signals;
    const p = this.prev;
    const dt = f.dt;
    s.poured = this.pendingPour;
    this.pendingPour = false;
    for (const kind of this.pendingUsed) this.mark(aimLesson(kind));
    this.pendingUsed.clear();
    s.gotOut = p !== null && !f.seated && p.seated;
    // A stop-start restart is the throttle's doing, not the key's.
    s.engineStarted = p !== null && f.driver && p.driver && f.engineRunning && !p.engineRunning && !p.autoStopped;
    s.handbrakeReleased = p !== null && f.driver && p.driver && !f.handbrake && p.handbrake;
    s.cameraSwitched = p !== null && f.seated && p.seated && f.cabinView !== p.cabinView;
    // An automatic changes gear by itself: only a manual box's change is the player's.
    s.gearChanged = p !== null && f.driver && p.driver && f.manualGearbox && f.carId === p.carId && f.gear !== p.gear && f.speedKmh > 3;
    s.indicatorOn = p !== null && f.driver && f.indicatorOn && !p.indicatorOn;
    s.lightsChanged = p !== null && f.driver && p.driver && f.headlightsOn !== p.headlightsOn;
    s.autopilotOn = p !== null && f.driver && f.autopilot && !p.autopilot;
    s.mouseDrivingOn = p !== null && f.mouseDriving && !p.mouseDriving;
    if (!f.seated) {
      s.walkedM += f.walkedM;
      s.turnedRad += f.turnedRad;
    }
    const byHand = f.driver && !f.autopilot;
    s.brakeS += byHand && f.speedKmh > 10 && f.brake > 0.3 ? dt : 0;
    s.cruiseS = byHand && f.notch > 0 && f.speedKmh > 15 ? s.cruiseS + dt : 0;
    s.heldThrottleS = byHand && f.notch === 0 && f.speedKmh > 30 && f.throttle > 0.3 ? s.heldThrottleS + dt : 0;
    s.mirrorS = f.aimingMirror ? s.mirrorS + dt : 0;
    s.mouseLookS = byHand && f.mouseDriving && f.mouseLookHeld ? s.mouseLookS + dt : 0;
    s.drivenS += byHand && f.speedKmh > 5 ? dt : 0;
    s.standingS = f.seated && f.speedKmh < 3 ? s.standingS + dt : 0;

    if (s.mirrorS > 0.3) this.mark(aimLesson('mirror'));
    if (walkDone(s)) this.mark(WALK);
    for (const lesson of LESSONS) {
      if (this.done.has(lesson.id)) continue;
      if (lesson.done(f, s)) {
        this.mark(lesson.id);
        continue;
      }
      if (!f.blocked && lesson.when(f, s)) this.contextS.set(lesson.id, (this.contextS.get(lesson.id) ?? 0) + dt);
      else this.contextS.delete(lesson.id);
    }
    if (p === null) this.prev = { ...f };
    else Object.assign(p, f);
  }
}

const STORE_KEY = 'brodrive-tutorial-v2';

export interface TutorialProgress {
  on: boolean;
  done: string[];
}

export function loadProgress(): TutorialProgress {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TutorialProgress>;
      return {
        on: parsed.on === true,
        done: Array.isArray(parsed.done) ? parsed.done.filter((x) => typeof x === 'string') : [],
      };
    }
  } catch {
    // A broken record is no tutorial.
  }
  return { on: false, done: [] };
}

export function saveProgress(progress: TutorialProgress): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(progress));
  } catch {
    // Private mode: the tutorial forgets on reload, nothing else breaks.
  }
}
