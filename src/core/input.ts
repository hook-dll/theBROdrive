/**
 * Input is data, not device access.
 *
 * Gameplay systems consume an `InputFrame` and never touch the keyboard. That
 * separation is what makes a replay, an AI driver, or a remote player's input
 * indistinguishable from a local one (see NETPLAY notes in world/road.ts).
 */

import type { TouchControls } from './touch';
import { gamepads, PAD, type GamepadHub } from './gamepad';
import { PedalLever } from './pedallever';
import { INVENTORY_ITEM_LIMIT } from '../items/items';
import { STEERING_WHEEL_HALF_LOCK_RAD } from '../vehicle/vehicletuning';

/**
 * What `InputFrame.steer` means, decided by the device that produced it.
 *
 *   keys          a keyboard or touch request: -1, 0 or 1 from the keys, the touch
 *                 wheel's deflection from the thumb. The steering wheel moves toward
 *                 that share of lock, a held key gathering speed like a hand, so how
 *                 long a key is down is how much wheel (`Vehicle.updateSteering`,
 *                 KEYBOARD STEERING in vehicletuning.ts), and let go it eases back to
 *                 centre. Both keys down is 0 here and `steerBothHeld`: the wheel held
 *                 where it is.
 *   analogAssist  a position (a pad stick) read against the tyres' peak at speed,
 *                 proportionally: the stick's edge is the peak.
 *   analog        a position read against the whole steering lock.
 *   direct        a rack angle as a share of lock, held exactly where it is told. Autonomy
 *                 and anything else that has computed the angle it wants send it
 *                 (`Vehicle.steeringInputForWheelAngle`), and so does MOUSE DRIVING: the
 *                 mouse puts the steering wheel's rim at an angle, and rim over the
 *                 steering ratio is the same share of lock as rim over its half-lock
 *                 travel, so the wheel stays where the mouse left it.
 *
 * In the analogue modes a steer of exactly 0 means no hand is on the wheel, and the
 * tyres' own aligning moment turns it; with keys it means so once the wheel is back at
 * centre. `direct` always holds the rack where it is told: nothing turns it but the
 * command.
 */
export type SteerMode = 'keys' | 'analogAssist' | 'analog' | 'direct';

export interface InputFrame {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** Player is holding the backward command; automatic drive uses it for reverse at rest. */
  reverse: boolean;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
  /** Requested shift this tick: -1 down, 0 none, +1 up. */
  shift: number;
  /**
   * The gearbox shifts itself this tick whatever `Settings.gearboxMode` says. Set by the
   * autopilot, which never works the lever: in the manual mode it was left in neutral
   * with its throttle down and the car did not move.
   */
  autoShift: boolean;
  /** Toggle intents, consumed once by the system that handles them. */
  toggleLights: boolean;
  toggleLeftIndicator: boolean;
  toggleRightIndicator: boolean;
  /** Start or stop the engine of the car the player drives: tap, consumed by the driver's seat. */
  toggleEngine: boolean;
  cycleCamera: boolean;
  /** Step the car radio: off → station 1 → station 2 → off. Tap, consumed by audio. */
  radioCycle: boolean;
  /** Re-centre the view (behind the car when driving, level horizon on foot): tap, consumed by CameraRig. */
  recenterCamera: boolean;
  /**
   * F, the one interaction key: tap, consumed once by interaction (player/interaction.ts,
   * `fixedUpdate`), which gives it to what is aimed at or, with nothing aimed, to the held
   * item (`InteractionResult.useHeld`).
   */
  interact: boolean;
  /**
   * The same key while it is held down: a world fixture held on (a pump filling a can) works,
   * and a hand-aimed kit part (the inside mirror) turns, while it is.
   */
  interactDown: boolean;
  /** Drop the held item in front of the player: tap, consumed once by interaction. */
  dropItem: boolean;
  /** Remove the currently worn item: tap, consumed by the wearable owner. */
  removeWearable: boolean;
  /** Primary use of the held item: scrub, pour, fire. Held, not tapped. */
  usePrimary: boolean;
  /** Secondary use: aim down sights, precision placement. */
  useSecondary: boolean;
  /** Cycle the held item: -1 or +1. */
  cycleItem: number;
  /** Direct inventory slot pick from the number row: 0 = none, otherwise 1..3. */
  selectSlot: number;
  /** On-foot movement, camera-relative. */
  moveX: number;
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  /** Crouch or stand up on foot: tap, consumed by the player (player/player.ts). */
  toggleCrouch: boolean;
  /** Mouse look deltas in radians, accumulated since the last frame. */
  lookYaw: number;
  lookPitch: number;
  /** Wheel notches since the last frame. Positive zooms out. */
  zoomDelta: number;
  /**
   * Sticker try-on steps from the touch buttons, taps consumed once: turn by -1/+1
   * notches, size by -1/+1 steps, back upright at catalogue size. The desktop does
   * the same with the wheel, Shift+wheel and the right button.
   */
  stickerTurn: number;
  stickerSize: number;
  stickerReset: boolean;
  /** Mirror the sticker being tried on: the middle button, the pad's B or the touch strip; tap. */
  stickerMirror: boolean;
  /** M: switch mouse driving on or off; tap, consumed once by the settings owner. */
  toggleMouseDriving: boolean;
  /** Cycles autopilot: sleeper -> hurried -> frantic -> off; edge-triggered. */
  toggleAutopilot: boolean;
  /**
   * The races at the tracks (race/director.ts), taps: start the race again from the grid
   * (and race again from the results), and put the car back on the track at its last
   * checkpoint. Consumed by the race; nothing else reads them.
   */
  raceRestart: boolean;
  raceReturn: boolean;
  /** How `steer` is to be read: see `SteerMode`. */
  steerMode: SteerMode;
  /**
   * Both steering keys are down at once (`SteerMode` 'keys' only): `steer` is 0, and the
   * hands are holding the wheel, not letting go of it.
   */
  steerBothHeld: boolean;
}

export function emptyInput(): InputFrame {
  return {
    throttle: 0,
    brake: 0,
    reverse: false,
    steer: 0,
    handbrake: false,
    shift: 0,
    autoShift: false,
    toggleLights: false,
    toggleLeftIndicator: false,
    toggleRightIndicator: false,
    toggleEngine: false,
    cycleCamera: false,
    radioCycle: false,
    recenterCamera: false,
    interact: false,
    interactDown: false,
    dropItem: false,
    removeWearable: false,
    usePrimary: false,
    useSecondary: false,
    cycleItem: 0,
    selectSlot: 0,
    moveX: 0,
    moveZ: 0,
    jump: false,
    sprint: false,
    toggleCrouch: false,
    toggleAutopilot: false,
    lookYaw: 0,
    lookPitch: 0,
    zoomDelta: 0,
    stickerTurn: 0,
    stickerSize: 0,
    stickerReset: false,
    stickerMirror: false,
    toggleMouseDriving: false,
    raceRestart: false,
    raceReturn: false,
    // A synthetic frame is a computed command until a device says otherwise.
    steerMode: 'direct',
    steerBothHeld: false,
  };
}

/**
 * Every remappable action, in display order. This is the single source of truth
 * for the settings screen (labels + defaults) and for the effective bindings
 * (InputReader resolves overrides against it). System controls are deliberately
 * absent: Escape/Backquote pause, plus toggles fullscreen and minus toggles the
 * cinema viewport, all outside InputReader and none can be rebound. The mouse
 * buttons are equally fixed — they map straight to usePrimary/useSecondary (and,
 * while mouse driving, to the pedals and the look hold) and are not actions.
 */
export const BINDABLE_ACTIONS: readonly {
  id: string;
  label: string;
  defaultKeys: readonly string[];
}[] = [
  { id: 'throttle', label: 'Throttle', defaultKeys: ['KeyW', 'ArrowUp'] },
  { id: 'brake', label: 'Brake', defaultKeys: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Steer left', defaultKeys: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Steer right', defaultKeys: ['KeyD', 'ArrowRight'] },
  { id: 'handbrake', label: 'Toggle handbrake', defaultKeys: ['Space'] },
  // Gears sit next to the steering hand on X and Z. The mouse wheel is deliberately
  // NOT a gear lever: it is the chase camera's zoom, and sharing it made zooming
  // while driving impossible.
  { id: 'shiftUp', label: 'Shift up', defaultKeys: ['KeyX'] },
  { id: 'shiftDown', label: 'Shift down', defaultKeys: ['KeyZ'] },
  { id: 'engine', label: 'Start / stop engine', defaultKeys: ['KeyI'] },
  { id: 'lights', label: 'Cycle headlights', defaultKeys: ['KeyL'] },
  { id: 'indicatorLeft', label: 'Left blinker', defaultKeys: ['Comma'] },
  { id: 'indicatorRight', label: 'Right blinker', defaultKeys: ['Period'] },
  { id: 'mouseDriving', label: 'Mouse driving on / off', defaultKeys: ['KeyM'] },
  // While mouse driving, held: the mouse turns the view and the wheel stays put. Shares
  // Shift with sprint by default (see `holderOf` in ui/menu.ts): sprint walks on foot and
  // does nothing in a car.
  { id: 'mouseLook', label: 'Mouse driving: look around (hold)', defaultKeys: ['ShiftLeft', 'ShiftRight'] },
  { id: 'camera', label: 'Switch camera: chase / cabin', defaultKeys: ['KeyC'] },
  { id: 'recenterCamera', label: 'Recenter camera', defaultKeys: ['KeyV'] },
  // The radio is a car fitting, so it sits on the driving hand's side of the board.
  { id: 'radio', label: 'Radio: station 1 / station 2 / off', defaultKeys: ['KeyR'] },
  { id: 'autopilot', label: 'Autopilot: sleeper / hurried / frantic / off', defaultKeys: ['KeyP'] },
  // One key for everything the hand does: what is aimed at first, else the held item
  // (player/interaction.ts, `fixedUpdate`).
  { id: 'interact', label: 'Interact: use, pick up, open, get in / out', defaultKeys: ['KeyF'] },
  { id: 'drop', label: 'Drop item', defaultKeys: ['KeyQ'] },
  { id: 'removeWearable', label: 'Remove worn item', defaultKeys: ['KeyG'] },
  { id: 'jump', label: 'Jump', defaultKeys: ['Space'] },
  { id: 'sprint', label: 'Sprint', defaultKeys: ['ShiftLeft', 'ShiftRight'] },
  // C is the camera key in a car and free on foot, so the two share it the way Space is
  // shared (see `holderOf` in ui/menu.ts).
  { id: 'crouch', label: 'Crouch / stand up', defaultKeys: ['KeyC'] },
  // X and Z are the gearbox; item cycling moves to the bracket keys, which nothing
  // else uses and which stay reachable from the movement hand.
  { id: 'itemNext', label: 'Next item', defaultKeys: ['BracketRight'] },
  { id: 'itemPrev', label: 'Previous item', defaultKeys: ['BracketLeft'] },
  // The races at the tracks: keys nothing else uses, away from the driving hand's own.
  { id: 'raceRestart', label: 'Race: restart from the grid / race again', defaultKeys: ['Backspace'] },
  { id: 'raceReturn', label: 'Race: back to the track (last checkpoint)', defaultKeys: ['KeyT'] },
];

/** Effective binding table with no overrides applied. Shared, never mutated. */
const DEFAULT_BINDINGS: Record<string, readonly string[]> = {};
for (const action of BINDABLE_ACTIONS) DEFAULT_BINDINGS[action.id] = action.defaultKeys;

/** Fixed browser/display controls which must never leak into remappable actions. */
export function isSystemControlCode(code: string): boolean {
  return code === 'Escape'
    || code === 'Backquote'
    || code === 'Equal'
    || code === 'NumpadAdd'
    || code === 'Minus'
    || code === 'NumpadSubtract';
}

/** Turns a KeyboardEvent.code into something a human reads: KeyW -> W. */
export function formatKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse2') return 'RMB';
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * The effective keys for one action: the override when it has usable keys,
 * otherwise the default. Fixed system controls and mouse buttons can never appear
 * in a binding; a bad override degrades to the default rather than silently
 * unbinding the action.
 */
function resolveKeys(
  override: readonly string[] | undefined,
  defaults: readonly string[],
): readonly string[] {
  if (!override || override.length === 0) return defaults;
  let cleaned: string[] | null = null;
  for (const code of override) {
    if (!isSystemControlCode(code) && !code.startsWith('Mouse')) {
      if (cleaned === null) cleaned = [];
      cleaned.push(code);
    }
  }
  return cleaned !== null && cleaned.length > 0 ? cleaned : defaults;
}

/**
 * A TOUCH pedal is a quick FOOT that goes down in TWO STAGES: quickly to a knee, then
 * slowly the rest of the way, and lifts at one faster speed. Seconds for the travel.
 * (The keyboard and the mouse buttons drive the pedal lever instead, core/pedallever.ts;
 * these ramps were theirs and stay the thumb's.)
 *
 * A switch-like press is the only dose control there is. With one
 * constant rise the brake was floored in 0.15 s and the throttle in 0.25: a held key was
 * a full pedal before a driver could judge it, which locked the wheels of a car without
 * ABS and spun a rear-drive car on the power. Two stages give a tap a gentle pedal, a
 * short hold a firm one, and keep the floor for a key held on purpose:
 *
 *   throttle  0 → 0.5 in 0.12 s, then to 1 by 0.72 s;
 *   brake     0 → the knee in 0.1 s, then to 1 by 0.6 s.
 *
 * The brake's knee is the car's own THRESHOLD PEDAL when the game knows it (`setBrakeKnee`,
 * `Vehicle.thresholdBrakePedal`: the share of a floored pedal at which the first axle
 * reaches its tyres' peak), so a held brake key arrives at the hardest stop that still
 * rolls the wheels and only goes past it, into a lock, if it is held on.
 *
 * THE RISE IS THE DOSE CONTROL AND THE FALL IS NOT. Everything after the key comes up is
 * pedal the driver did not ask for: the lift takes 0.1 s from a floored throttle and 0.08
 * from a floored brake, and less from a part pedal, so a tap ends almost when the key
 * does (`tools/pedal-dose.ts`: monotonic in press length, mid-range reachable, the tail a
 * fraction of the press). Constant rates land exactly on 0 and 1, which matters
 * downstream: the vehicle turns "any throttle at all" into a wheel drive torque, so off
 * has to mean off.
 */
export const KEY_PEDAL_RAMPS = {
  throttle: { knee: 0.5, kneeS: 0.12, fullS: 0.72, fallS: 0.1 },
  brake: { knee: 0.6, kneeS: 0.1, fullS: 0.6, fallS: 0.08 },
} as const;

export interface KeyPedalRamp {
  /** The pedal the quick stage reaches, 0..1. */
  readonly knee: number;
  /** Seconds from 0 to the knee. */
  readonly kneeS: number;
  /** Seconds from 0 to the floor, through the knee. */
  readonly fullS: number;
  /** Seconds for the whole lift from the floor. */
  readonly fallS: number;
}

/**
 * One step of a keyboard (or touch) pedal toward `want`, 0..1, at the ramp's speeds;
 * `knee` overrides the ramp's own. Exported so `tools/pedal-dose.ts` measures this
 * function rather than a copy of it.
 */
export function keyPedalStep(value: number, want: number, ramp: KeyPedalRamp, dt: number, knee = ramp.knee): number {
  if (want < value) return Math.max(want, value - dt / ramp.fallS);
  // The quick stage up to the knee, the slow stage past it; a step that crosses the
  // knee stops on it and carries on slowly from the next.
  if (value < knee) return Math.min(want, knee, value + (dt * knee) / ramp.kneeS);
  return Math.min(want, value + (dt * (1 - knee)) / (ramp.fullS - ramp.kneeS));
}

/**
 * MOUSE DRIVING's gain: steering-wheel RIM travel per CSS pixel of horizontal
 * pointer-locked mouse motion, radians (0.5° per pixel).
 *
 * The rim stops at `STEERING_WHEEL_HALF_LOCK_RAD` (485°, where every car's road wheels
 * reach their lock), so centre to lock is 970 px and lock to lock 1940 px: a swipe or
 * two across a mousepad, like a real wheel's hand-over-hand. A 2° motorway correction
 * at the road wheels is 32° of rim on a 16:1 Zhiguli rack, 64 px. Deliberately apart
 * from the Mouse Look sensitivity, so a camera preference never changes the steering.
 */
const MOUSE_RIM_RAD_PER_PX = (0.5 * Math.PI) / 180;
/**
 * Look/camera-orbit rate from a fully deflected right stick, radians per second.
 *
 * A rate rather than a displacement, because a stick is a held position: the same
 * deflection has to keep turning the view for as long as it is held. Scaled by the
 * player's mouse sensitivity relative to `PAD_LOOK_REFERENCE_SENSITIVITY`, so the one
 * control decides how fast the view turns whichever device is turning it.
 */
const PAD_LOOK_RATE = 2.6;
/**
 * The mouse sensitivity at which `PAD_LOOK_RATE` is the stick's rate: the authored
 * default, written as a bare number because settings.ts imports this module and the
 * dependency must not run the other way.
 */
const PAD_LOOK_REFERENCE_SENSITIVITY = 0.0022;
/**
 * Rim travel per second while A or D is held in mouse driving: the keys nudge the same
 * held wheel the mouse does, and it stays where they leave it. 270°/s is a tap of
 * 4.5° at 60 Hz and a hold from centre to lock in 1.8 s.
 */
const MOUSE_DRIVING_KEY_RIM_RAD_S = (270 * Math.PI) / 180;

/**
 * Reads browser input into an `InputFrame`. Owns pointer lock and the analogue
 * smoothing of digital keys; owns no game state.
 */
export class InputReader {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly frame = emptyInput();
  private yawDelta = 0;
  private pitchDelta = 0;
  private wheelDelta = 0;
  private locked = false;
  /** A machine is worked by the cursor (player/machinefocus.ts): a click must not re-lock. */
  private cursorFree = false;
  /**
   * Desktop parking brake state. Changed only by a new key press, never key hold, and
   * only while driving (see `setDriving`).
   */
  private keyboardHandbrake = false;
  /** Whether the player is in a driver's seat; set by the game, like mouse driving. */
  private driving = false;
  /**
   * Raw horizontal mouse travel in CSS pixels since the last sample, kept apart from
   * `yawDelta` because steering must not inherit the look sensitivity.
   */
  private rawDX = 0;
  /** Is mouse driving switched on AND applicable (set by the game, not the device)? */
  private mouseDriving = false;
  /** Analog positions read against the assist's cap; see `setAnalogSteeringAssist`. */
  private analogSteerAssist = true;
  /** The brake's knee, the driven car's threshold pedal; see `setBrakeKnee`. */
  private brakeKnee: number = KEY_PEDAL_RAMPS.brake.knee;
  /** Keyboard and mouse throttle and brake (core/pedallever.ts). */
  private readonly lever = new PedalLever();
  /** No cruise notches on the lever (`setPlainPedals`). */
  private plainPedals = false;
  /**
   * MOUSE DRIVING's steering wheel: the rim angle in radians, positive RIGHT like
   * `steer`, within ±`STEERING_WHEEL_HALF_LOCK_RAD`. Only the mouse and the steering
   * keys move it; nothing returns it toward centre.
   */
  private mouseRimRad = 0;
  /**
   * Effective action -> key list for this reader. Precomputed at construction
   * and on setKeyBindings so the hot path (sample) only reads arrays — it never
   * builds or merges anything per tick.
   */
  private keys: Record<string, readonly string[]> = DEFAULT_BINDINGS;

  /**
   * Touch source, when one exists. Merged in `sample` rather than read by gameplay:
   * a phone's wheel, pedals and camera drag arrive through the same `InputFrame`
   * fields as keyboard and mouse controls.
   */
  private touch: TouchControls | null = null;

  /** The shared pad hub; see core/gamepad.ts. */
  private readonly pads: GamepadHub = gamepads();
  /**
   * Pad buttons as the last sample saw them. The pad is polled, not evented, so this
   * is what turns "the button is down" into the press/release edges the action map
   * wants — and `resyncPad` is what keeps a button held across a pause from firing
   * an action the moment driving resumes.
   */
  private readonly padHeld = new Array<boolean>(PAD.DRight + 1).fill(false);
  /**
   * Press edges for this sample, index-matched to `padHeld`: computed once at the top
   * of `sample` so every action below reads a plain boolean and nothing re-derives it.
   */
  private readonly padEdges = new Array<boolean>(PAD.DRight + 1).fill(false);
  /**
   * Which device last moved each axis, so a pad and the keyboard cannot fight for the
   * same one. An axis belongs to whoever moved it most recently: a stick deflection
   * takes it from the keys, and the first key to go down takes it back. Steering,
   * throttle and brake are latched separately because a player may hold the pad's
   * throttle with one hand and tap the brake key with the other.
   */
  private steerDevice: 'keyboard' | 'pad' | 'touch' = 'keyboard';
  private throttleDevice: 'keyboard' | 'pad' | 'touch' = 'keyboard';
  private brakeDevice: 'keyboard' | 'pad' | 'touch' = 'keyboard';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private mouseSensitivity = 0.0022,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    // Seed the pad's buttons rather than starting from "all released": a pad that
    // already had A down when this reader was built must not read as a press.
    this.resyncPad();
  }

  /**
   * Re-reads the pad's buttons without emitting any edges.
   *
   * Called after an overlay closes, because the menu consumes the same buttons while
   * the loop is stopped: the press that activated "Resume" is still under the
   * player's thumb when the first sample of the resumed drive runs, and without this
   * it would land as a fresh handbrake toggle.
   */
  resyncPad(): void {
    const pad = this.pads.read();
    for (let i = 0; i < this.padHeld.length; i++) this.padHeld[i] = pad.buttons[i] === true;
  }

  /**
   * Puts the parking brake latch down. Called when the autopilot takes the car: it works
   * its own handbrake, and a latch left on would come back the moment it let go, pulling
   * the rear wheels at whatever speed it had reached.
   */
  releaseHandbrake(): void {
    this.keyboardHandbrake = false;
  }

  /** Attaches the touch overlay's state as a second input source. */
  attachTouch(touch: TouchControls): void {
    this.touch = touch;
  }

  /** Pointer-look gain in radians per CSS pixel. */
  setMouseSensitivity(sensitivity: number): void {
    this.mouseSensitivity = Math.max(0.0001, sensitivity);
  }

  /**
   * Switches mouse driving on or off. The GAME owns this, not the device: it is on only
   * while the preference is set and the player drives the car with his own hands, so
   * the same mouse still looks around freely on foot and under the autopilot.
   *
   * `heldSteer` is where the car's steering wheel is now, as a share of lock positive
   * right (`-Vehicle.steeringFraction`). It is read only as the mode comes on, so the
   * mouse takes the wheel where it already stands instead of snapping it to centre.
   */
  setMouseDriving(enabled: boolean, heldSteer: number): void {
    if (enabled && !this.mouseDriving) {
      const share = heldSteer < -1 ? -1 : heldSteer > 1 ? 1 : heldSteer;
      this.mouseRimRad = share * STEERING_WHEEL_HALF_LOCK_RAD;
    }
    this.mouseDriving = enabled;
  }

  /** The settings' steering assist for ANALOG positions: the pad's stick (`SteerMode`). */
  setAnalogSteeringAssist(enabled: boolean): void {
    this.analogSteerAssist = enabled;
  }

  /**
   * The driven car's threshold pedal (`Vehicle.thresholdBrakePedal`): where the touch
   * brake's quick stage stops (`KEY_PEDAL_RAMPS`) and how far the pedal lever's brake goes
   * down, kept off the ends. Without a car the ramp's own knee.
   */
  setBrakeKnee(pedal: number | null): void {
    const knee = pedal ?? KEY_PEDAL_RAMPS.brake.knee;
    this.brakeKnee = knee < 0.3 ? 0.3 : knee > 0.9 ? 0.9 : knee;
  }

  /**
   * Tells the reader whether the player is driving. The GAME owns this, not the device.
   *
   * The handbrake and the jump share Space, and the handbrake is a toggle, so without
   * this every jump on foot flipped the lever of the next car the player sat in: an odd
   * number of jumps in the desert and the car was parked on its handbrake, first gear in,
   * engine revving, wheels standing still — which is exactly how it was reported.
   */
  setDriving(driving: boolean): void {
    // A new seat starts in neutral: a lever left on a throttle notch must not drive off.
    if (driving !== this.driving) this.lever.reset();
    this.driving = driving;
  }

  /** The keys are plain pedals, no cruise notches (core/pedallever.ts `step`): during a race. */
  setPlainPedals(plain: boolean): void {
    this.plainPedals = plain;
  }

  /**
   * The keyboard and mouse pedal lever (core/pedallever.ts) while it is the device
   * on either pedal, for the HUD's scale; null while a pad or the touch pedals hold
   * both.
   */
  get pedalLever(): Readonly<PedalLever> | null {
    return this.throttleDevice === 'keyboard' || this.brakeDevice === 'keyboard' ? this.lever : null;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Never swallow the browser's own shortcuts; only game keys.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!this.held.has(e.code)) this.pressed.add(e.code);
    this.held.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  private onBlur = (): void => {
    // Losing focus mid-corner must not leave the throttle pinned, held or on a notch.
    this.held.clear();
    this.lever.reset();
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) {
      if (this.cursorFree) return;
      void this.canvas.requestPointerLock();
      return;
    }
    // Middle button: the browser's autoscroll would otherwise fire on press.
    if (e.button === 1) e.preventDefault();
    if (e.button === 0) this.held.add('Mouse0');
    if (e.button === 1) {
      this.held.add('Mouse1');
      // An edge too: the middle click mirrors a sticker being tried on.
      this.pressed.add('Mouse1');
    }
    if (e.button === 2) this.held.add('Mouse2');
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.held.delete('Mouse0');
    if (e.button === 1) this.held.delete('Mouse1');
    if (e.button === 2) this.held.delete('Mouse2');
  };

  private onContextMenu = (e: MouseEvent): void => {
    // Right mouse aims on foot and brakes while mouse driving; either way the browser
    // menu must not steal it.
    e.preventDefault();
  };

  private onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.held.clear();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    // `lookYaw` is rightward mouse motion (positive = the player wants to look
    // right) and `lookPitch` is upward (positive = look up). Consumers convert into
    // their own basis; see CameraRig, where turning right *decreases* yaw because
    // forward is (sin y, cos y) and right is therefore (-cos y, sin y).
    this.yawDelta += e.movementX * this.mouseSensitivity;
    this.rawDX += e.movementX;
    this.pitchDelta -= e.movementY * this.mouseSensitivity;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Normalise across deltaMode (pixels vs lines vs pages) so trackpads agree.
    const scale = e.deltaMode === 1 ? 1 / 3 : e.deltaMode === 2 ? 10 : 1 / 100;
    this.wheelDelta += e.deltaY * scale;
    // A notch is also bindable as a pseudo-key, for anyone who does want gears or
    // another tap action on the wheel. Nothing binds it by default (the wheel is
    // the camera's zoom). It is a tap, never a hold: the browser gives discrete
    // events with no release, so it goes in `pressed` and never in `held`.
    if (e.deltaY < 0) this.pressed.add('WheelUp');
    else if (e.deltaY > 0) this.pressed.add('WheelDown');
  };

  get pointerLocked(): boolean {
    return this.locked;
  }

  /** While a machine is worked by the cursor, a click on the canvas leaves the pointer free. */
  setCursorFree(free: boolean): void {
    this.cursorFree = free;
  }

  /** Whether `code` is bound to walking (or jumping) on foot. */
  isMoveKey(code: string): boolean {
    for (const action of ['throttle', 'brake', 'left', 'right', 'jump']) {
      if (this.keys[action]?.includes(code)) return true;
    }
    return false;
  }

  private anyHeld(codes: readonly string[]): boolean {
    for (const c of codes) if (this.held.has(c)) return true;
    return false;
  }

  private anyPressed(codes: readonly string[]): boolean {
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  /** A pad button's press edge for this sample; see `padEdges` in `sample`. */
  private padPressed(index: number): boolean {
    return this.padEdges[index] === true;
  }

  /**
   * Replaces the effective bindings with the given overrides; actions without
   * an override keep their defaults. Called once at startup and whenever the
   * settings change, never in the hot path: the resolved table is rebuilt here
   * so sample() stays allocation-free with dynamic bindings.
   */
  setKeyBindings(overrides: Record<string, readonly string[]>): void {
    const next: Record<string, readonly string[]> = {};
    for (const action of BINDABLE_ACTIONS) {
      next[action.id] = resolveKeys(overrides[action.id], action.defaultKeys);
    }
    this.keys = next;
  }

  /** The first key bound to `action`, as a human reads it (`formatKey`); '' when unbound. */
  keyLabel(action: string): string {
    const code = this.keys[action]?.[0];
    return code === undefined ? '' : formatKey(code);
  }

  /** Every key bound to `action`, the main one first (KeyboardEvent codes). */
  keyCodes(action: string): readonly string[] {
    return this.keys[action] ?? [];
  }

  /**
   * Produces the frame for this tick. Mutates and returns an internal object, so
   * callers must not retain it across ticks.
   */
  sample(dt: number): InputFrame {
    const f = this.frame;
    // One source of truth per axis: touch-control values and digital inputs meet
    // here, so gameplay receives the same frame regardless of device.
    //
    // MOUSE DRIVING (`setMouseDriving`): horizontal mouse travel turns the steering
    // wheel and it stays where it is put, the left button is the throttle and the right
    // the brake, and holding the middle button or the look key turns the view instead
    // while the wheel holds. The keyboard keeps working beside it.
    const touch = this.touch?.input;
    const mouseDriving = this.mouseDriving;
    const mouseThrottle = mouseDriving && this.held.has('Mouse0');
    const mouseBrake = mouseDriving && this.held.has('Mouse2');
    const touchForward = touch?.forward ?? 0;
    const touchBackward = touch?.backward ?? 0;
    // Gamepad: an analog pedal and a key are the same axis, and only one of them may
    // hold it. The pad takes it as soon as its trigger moves; the first key down takes
    // it back. See the device latch fields.
    const pad = this.pads.read();
    // Press edges, computed once: a polled device has no events, so "just pressed"
    // is this sample's reading against the last one's.
    for (let i = 0; i < this.padEdges.length; i++) {
      this.padEdges[i] = this.padHeld[i] === false && pad.buttons[i] === true;
    }
    const keyThrottle = this.anyHeld(this.keys.throttle) || mouseThrottle;
    const keyBrake = this.anyHeld(this.keys.brake) || mouseBrake;
    if (pad.rightTrigger > 0) this.throttleDevice = 'pad';
    else if (keyThrottle) this.throttleDevice = 'keyboard';
    else if (touchForward > 0) this.throttleDevice = 'touch';
    if (pad.leftTrigger > 0) this.brakeDevice = 'pad';
    else if (keyBrake) this.brakeDevice = 'keyboard';
    else if (touchBackward > 0) this.brakeDevice = 'touch';

    // Keys and mouse buttons drive the PEDAL LEVER (core/pedallever.ts): presses move
    // it a notch, holds floor the throttle or drop to full brake. Another device taking
    // a pedal puts it back in neutral, so no notch is waiting when the keys come back.
    if (this.throttleDevice !== 'keyboard' && this.brakeDevice !== 'keyboard') this.lever.reset();
    else this.lever.step(keyThrottle, keyBrake, dt, this.brakeKnee, this.plainPedals);
    // A trigger is a position, so it lands as one: no rise, no fall. A touch pedal is a
    // switch-like thumb, so it moves the pedal like a quick foot (`KEY_PEDAL_RAMPS`).
    f.throttle =
      this.throttleDevice === 'pad'
        ? pad.rightTrigger
        : this.throttleDevice === 'touch'
          ? keyPedalStep(f.throttle, touchForward, KEY_PEDAL_RAMPS.throttle, dt)
          : this.lever.throttle;
    f.brake =
      this.brakeDevice === 'pad'
        ? pad.leftTrigger
        : this.brakeDevice === 'touch'
          ? keyPedalStep(f.brake, touchBackward, KEY_PEDAL_RAMPS.brake, dt, this.brakeKnee)
          : this.lever.brake;
    // Reverse is a HELD command: the trigger, the touch pedal, or the brake key held
    // long (`PedalLever.reverse`), never a tap.
    f.reverse =
      this.brakeDevice === 'pad'
        ? pad.leftTrigger > 0
        : this.brakeDevice === 'touch'
          ? touchBackward > 0
          : this.lever.reverse;

    // While mouse driving, the middle button or the look key (Shift) gives the mouse to
    // the view; the wheel holds the angle it had.
    const mouseLook = this.held.has('Mouse1') || this.anyHeld(this.keys.mouseLook);
    const steerWithMouse = mouseDriving && !mouseLook;
    const mouseSteerPx = steerWithMouse ? this.rawDX : 0;
    const rightHeld = this.anyHeld(this.keys.right);
    const leftHeld = this.anyHeld(this.keys.left);
    const keySteer = (rightHeld ? 1 : 0) - (leftHeld ? 1 : 0);
    if (pad.steer !== 0) this.steerDevice = 'pad';
    else if (keySteer !== 0 || mouseSteerPx !== 0) this.steerDevice = 'keyboard';
    else if (touch?.steeringActive === true) this.steerDevice = 'touch';
    f.steerBothHeld = false;
    if (this.steerDevice === 'pad') {
      // An analog stick is already a position, held and released by the thumb; the
      // keyboard's hands on the wheel would only put a lag between it and the wheels.
      f.steer = pad.steer;
      f.steerMode = this.analogSteerAssist ? 'analogAssist' : 'analog';
    } else if (mouseDriving && this.steerDevice === 'keyboard') {
      // The mouse puts the rim where it wants it (`MOUSE_RIM_RAD_PER_PX`), A/D nudge it
      // (`MOUSE_DRIVING_KEY_RIM_RAD_S`), and the rim stops at the steering lock. Rim over
      // the half-lock travel is the share of lock the road wheels go to (rim over the
      // car's steering ratio), sent `direct` so nothing but this turns the wheel: no
      // assist, no hands' caster return, no self-centring. The rack's speed still
      // applies in `Vehicle.updateSteering`.
      const turned =
        this.mouseRimRad
        + mouseSteerPx * MOUSE_RIM_RAD_PER_PX
        + keySteer * MOUSE_DRIVING_KEY_RIM_RAD_S * dt;
      const stop = STEERING_WHEEL_HALF_LOCK_RAD;
      this.mouseRimRad = turned < -stop ? -stop : turned > stop ? stop : turned;
      f.steer = this.mouseRimRad / stop;
      f.steerMode = 'direct';
    } else {
      // Keys and the touch wheel give a direction, and the vehicle's hands turn the
      // wheel that way for as long as it is held (`SteerMode` 'keys'). The touch wheel's
      // deflection is a share of the hands' rate; lifting the thumb is releasing a key.
      f.steer = keySteer !== 0 || !touch?.steeringActive ? keySteer : touch.steer;
      f.steerMode = 'keys';
      f.steerBothHeld = rightHeld && leftHeld;
    }

    const taps = this.touch?.consumeTaps();
    if (
      this.driving
      && (this.anyPressed(this.keys.handbrake) || taps?.handbrake === true || this.padPressed(PAD.A))
    ) {
      this.keyboardHandbrake = !this.keyboardHandbrake;
    }
    f.handbrake = this.keyboardHandbrake;
    f.shift =
      (this.anyPressed(this.keys.shiftUp) || this.padPressed(PAD.RB) ? 1 : 0) -
      (this.anyPressed(this.keys.shiftDown) || this.padPressed(PAD.LB) ? 1 : 0);
    f.autoShift = false;
    f.toggleLights =
      this.anyPressed(this.keys.lights)
      || taps?.lights === true
      || (this.driving && this.padPressed(PAD.LS));
    f.toggleLeftIndicator =
      this.anyPressed(this.keys.indicatorLeft) || (this.driving && this.padPressed(PAD.DLeft));
    f.toggleRightIndicator =
      this.anyPressed(this.keys.indicatorRight) || (this.driving && this.padPressed(PAD.DRight));
    f.toggleEngine = this.driving && this.anyPressed(this.keys.engine);
    f.cycleCamera =
      this.anyPressed(this.keys.camera) || taps?.camera === true || this.padPressed(PAD.Y);
    // Mouse driving is the mouse's own mode, so the pad has no button for it, and on
    // foot M does nothing: the mouse looks there whatever the setting says.
    f.toggleMouseDriving = this.driving && this.anyPressed(this.keys.mouseDriving);
    f.toggleAutopilot =
      this.anyPressed(this.keys.autopilot)
      || taps?.autopilot === true
      || (this.driving && this.padPressed(PAD.Back));
    f.recenterCamera =
      this.anyPressed(this.keys.recenterCamera)
      || taps?.recenter === true
      || this.padPressed(PAD.DUp);
    f.radioCycle =
      this.anyPressed(this.keys.radio) || (this.driving && this.padPressed(PAD.DDown));
    // The pad's right stick press is otherwise unused: back to the track.
    f.raceRestart = this.driving && this.anyPressed(this.keys.raceRestart);
    f.raceReturn = this.driving && (this.anyPressed(this.keys.raceReturn) || this.padPressed(PAD.RS));
    // X is the pad's F: it does whatever F does, exactly as the key does.
    f.interact = this.anyPressed(this.keys.interact) || taps?.interact === true || this.padPressed(PAD.X);
    f.interactDown = this.anyHeld(this.keys.interact) || pad.buttons[PAD.X] === true;
    f.dropItem =
      this.anyPressed(this.keys.drop)
      || taps?.drop === true
      || (!this.driving && this.padPressed(PAD.DDown));
    f.removeWearable =
      this.anyPressed(this.keys.removeWearable)
      || taps?.removeWearable === true
      || (!this.driving && this.padPressed(PAD.Back));
    // Both buttons are pedals while mouse driving, so they must not also fire or aim the
    // held item. The mode is on only while driving, so on foot this is exactly the
    // ordinary behavior.
    f.usePrimary = !mouseDriving && this.held.has('Mouse0');
    f.useSecondary = !mouseDriving && this.held.has('Mouse2');
    f.cycleItem =
      (this.anyPressed(this.keys.itemNext) ? 1 : 0) -
      (this.anyPressed(this.keys.itemPrev) ? 1 : 0);
    if (!this.driving) {
      if (this.padPressed(PAD.DRight)) f.cycleItem += 1;
      if (this.padPressed(PAD.DLeft)) f.cycleItem -= 1;
    }

    // Number row 1..3 picks an inventory slot directly. The numpad row is accepted
    // too so either hand works.
    f.selectSlot = 0;
    for (let n = 1; n <= INVENTORY_ITEM_LIMIT; n++) {
      if (this.pressed.has(`Digit${n}`) || this.pressed.has(`Numpad${n}`)) {
        f.selectSlot = n;
        break;
      }
    }
    // On foot the left stick walks and the right stick looks; the keyboard's pedals
    // retain forward/backward movement, and digital keys remain authoritative on each
    // movement axis. The pad is a position like the touch wheel, so it goes in whole.
    const keyMoveX =
      (this.anyHeld(this.keys.right) ? 1 : 0) - (this.anyHeld(this.keys.left) ? 1 : 0);
    const keyMoveZ =
      (this.anyHeld(this.keys.throttle) ? 1 : 0) -
      (this.anyHeld(this.keys.brake) ? 1 : 0);
    f.moveX = keyMoveX !== 0 ? keyMoveX : pad.moveX !== 0 ? pad.moveX : touch?.steer ?? 0;
    f.moveZ =
      keyMoveZ !== 0
        ? keyMoveZ
        : pad.moveZ !== 0
          ? pad.moveZ
          : touchForward - touchBackward;
    f.jump = this.anyPressed(this.keys.jump) || this.padPressed(PAD.A);
    f.sprint = this.anyHeld(this.keys.sprint) || pad.buttons[PAD.LS] === true;
    // The pad's Y is the camera in a car, and the crouch on foot, as C is.
    f.toggleCrouch =
      this.anyPressed(this.keys.crouch) || taps?.crouch === true || (!this.driving && this.padPressed(PAD.Y));

    const drag = this.touch?.consumeLook();
    // While the mouse is steering it is not looking: feeding both would spin the
    // camera every time the driver corrected the car. The middle button or the look key
    // gives the view back, and the right stick is never steering, so it looks either way.
    const padLook =
      PAD_LOOK_RATE *
      Math.min(1, this.mouseSensitivity / PAD_LOOK_REFERENCE_SENSITIVITY) *
      Math.min(dt, 0.1);
    f.lookYaw =
      (steerWithMouse ? drag?.yaw ?? 0 : this.yawDelta + (drag?.yaw ?? 0)) + pad.lookX * padLook;
    f.lookPitch =
      (steerWithMouse ? drag?.pitch ?? 0 : this.pitchDelta + (drag?.pitch ?? 0)) +
      pad.lookY * padLook;
    f.zoomDelta = this.wheelDelta + (this.touch?.consumeZoom(dt) ?? 0);
    f.stickerTurn = taps?.stickerTurn ?? 0;
    f.stickerSize = taps?.stickerSize ?? 0;
    f.stickerReset = taps?.stickerReset === true;
    // The middle button is a mouse driving's look hold, but mouse driving is a car's and
    // a sticker is tried on on foot; B is the pad's, free in play since F does all.
    f.stickerMirror = this.pressed.has('Mouse1') || taps?.stickerMirror === true || (!this.driving && this.padPressed(PAD.B));
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.rawDX = 0;
    this.wheelDelta = 0;
    this.pressed.clear();
    for (let i = 0; i < this.padHeld.length; i++) this.padHeld[i] = pad.buttons[i] === true;
    return f;
  }
}
