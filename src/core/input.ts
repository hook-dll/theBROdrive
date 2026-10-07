/**
 * Input is data, not device access.
 *
 * Gameplay systems consume an `InputFrame` and never touch the keyboard. That
 * separation is what makes a replay, an AI driver, or a remote player's input
 * indistinguishable from a local one (see NETPLAY notes in world/road.ts).
 */

import type { TouchControls } from './touch';
import { gamepads, PAD, type GamepadHub } from './gamepad';
import { INVENTORY_ITEM_LIMIT } from '../items/items';

/**
 * What `InputFrame.steer` means, decided by the device that produced it.
 *
 *   keys          a keyboard or touch axis, ramped (`keySteerStep`). The vehicle's
 *                 steering assist turns it into a share of the angle that puts the
 *                 front tyres at their peak slip.
 *   keysFull      the same axis with the keyboard's assist off: its curve against the
 *                 whole lock, at any speed.
 *   analogAssist  a position (a pad stick, the precise-control wheel) read against that
 *                 same cap, proportionally: the stick's edge is the tyres' peak.
 *   analog        a position read against the whole steering lock.
 *   direct        a rack angle as a share of lock, for autonomy and anything else that
 *                 has computed the angle it wants (`Vehicle.steeringInputForWheelAngle`).
 *
 * In the three player modes a steer of exactly 0 means no hand is on the wheel, and the
 * tyres' own aligning moment turns it. `direct` always holds the rack where it is told.
 */
export type SteerMode = 'keys' | 'keysFull' | 'analogAssist' | 'analog' | 'direct';

/**
 * What a released steering key does (`keySteerStep`), a player setting:
 *
 *   letGo  the hand leaves the wheel the moment the key comes up, and the tyres'
 *          aligning moment turns it toward where the car is going, at once.
 *   ease   the hand eases off over `STEER_EASE` first, and lets go near the centre.
 */
export type KeySteerRelease = 'letGo' | 'ease';

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
  /** Toggle intents, consumed once by the system that handles them. */
  toggleLights: boolean;
  toggleLeftIndicator: boolean;
  toggleRightIndicator: boolean;
  cycleCamera: boolean;
  /** Step the car radio: off → station 1 → station 2 → off. Tap, consumed by audio. */
  radioCycle: boolean;
  /** Re-centre the view (behind the car when driving, level horizon on foot): tap, consumed by CameraRig. */
  recenterCamera: boolean;
  /** Enter/exit the car (entry needs an open or removed door): tap, consumed once by interaction. */
  interact: boolean;
  /** Pick up a loose part/item, or fit/remove a part at the aimed slot: tap, consumed once by interaction. */
  mount: boolean;
  /** Toggle or equip the held handheld item: tap, consumed by the item owner. */
  useHeld: boolean;
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
  /** Toggle precise control: tap, consumed once by the settings owner. */
  togglePreciseSteer: boolean;
  /** Cycles autopilot: sleeper -> hurried -> frantic -> off; edge-triggered. */
  toggleAutopilot: boolean;
  /** How `steer` is to be read: see `SteerMode`. */
  steerMode: SteerMode;
}

export function emptyInput(): InputFrame {
  return {
    throttle: 0,
    brake: 0,
    reverse: false,
    steer: 0,
    handbrake: false,
    shift: 0,
    toggleLights: false,
    toggleLeftIndicator: false,
    toggleRightIndicator: false,
    cycleCamera: false,
    radioCycle: false,
    recenterCamera: false,
    interact: false,
    mount: false,
    useHeld: false,
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
    toggleAutopilot: false,
    lookYaw: 0,
    lookPitch: 0,
    zoomDelta: 0,
    stickerTurn: 0,
    stickerSize: 0,
    stickerReset: false,
    togglePreciseSteer: false,
    // A synthetic frame is a computed command until a device says otherwise.
    steerMode: 'direct',
  };
}

/**
 * Every remappable action, in display order. This is the single source of truth
 * for the settings screen (labels + defaults) and for the effective bindings
 * (InputReader resolves overrides against it). System controls are deliberately
 * absent: Escape/Backquote pause, plus toggles fullscreen and minus toggles the
 * cinema viewport, all outside InputReader and none can be rebound. The mouse
 * buttons are equally fixed — they map straight to usePrimary/useSecondary and
 * are not actions.
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
  { id: 'lights', label: 'Cycle headlights', defaultKeys: ['KeyL'] },
  { id: 'indicatorLeft', label: 'Left blinker', defaultKeys: ['Comma'] },
  { id: 'indicatorRight', label: 'Right blinker', defaultKeys: ['Period'] },
  { id: 'mouseSteer', label: 'Precise steering', defaultKeys: ['KeyM'] },
  { id: 'camera', label: 'Toggle hood / chase camera', defaultKeys: ['KeyC'] },
  { id: 'recenterCamera', label: 'Recenter camera', defaultKeys: ['KeyV'] },
  // The radio is a car fitting, so it sits on the driving hand's side of the board.
  { id: 'radio', label: 'Radio: station 1 / station 2 / off', defaultKeys: ['KeyR'] },
  { id: 'autopilot', label: 'Autopilot: sleeper / hurried / frantic / off', defaultKeys: ['KeyP'] },
  { id: 'useHeld', label: 'Use held item', defaultKeys: ['KeyE'] },
  { id: 'interact', label: 'Enter / exit vehicle', defaultKeys: ['KeyF'] },
  { id: 'mount', label: 'Pick up / mount', defaultKeys: ['KeyF'] },
  { id: 'drop', label: 'Drop item', defaultKeys: ['KeyQ'] },
  { id: 'removeWearable', label: 'Remove worn item', defaultKeys: ['KeyG'] },
  { id: 'jump', label: 'Jump', defaultKeys: ['Space'] },
  { id: 'sprint', label: 'Sprint', defaultKeys: ['ShiftLeft', 'ShiftRight'] },
  // X and Z are the gearbox; item cycling moves to the bracket keys, which nothing
  // else uses and which stay reachable from the movement hand.
  { id: 'itemNext', label: 'Next item', defaultKeys: ['BracketRight'] },
  { id: 'itemPrev', label: 'Previous item', defaultKeys: ['BracketLeft'] },
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
 * A keyboard pedal is a quick FOOT: the key down moves the pedal toward the floor at a
 * constant speed, the key up lifts it at a faster one. Seconds for the whole travel.
 *
 * A foot moves a pedal at a speed, it does not approach the floor exponentially. The
 * old shaping did: a first-order lag of 0.3 s, which put a held key at only 0.8 of the
 * pedal after half a second and 0.95 after nine tenths, so "floored" was most of a
 * second away. A constant rate reaches the floor at a definite moment: a throttle in a
 * quarter of a second, and the brake, which a driver stamps on, in 0.15.
 *
 * THE RISE IS THE DOSE CONTROL AND THE FALL IS NOT. How long the key is held selects
 * the value, and everything after the key comes up is pedal the driver did not ask for:
 * a release of 0.3 s once turned a 40 ms brake tap into EIGHT times its own dose. Here
 * the lift takes 0.1 s from a floored throttle and 0.08 from a floored brake, and less
 * from a part pedal, so a tap ends almost when the key does (`tools/pedal-dose.ts`:
 * monotonic in press length, mid-range reachable, the tail a fraction of the press).
 *
 * A constant rate also lands exactly on 0 and 1, which matters downstream: the vehicle
 * turns "any throttle at all" into a wheel drive torque, so off has to mean off.
 */
export const KEY_PEDAL_RAMPS = {
  throttle: { riseS: 0.25, fallS: 0.1 },
  brake: { riseS: 0.15, fallS: 0.08 },
} as const;

/**
 * One step of a keyboard (or touch) pedal toward `want`, 0..1, at the ramp's speeds.
 * Exported so `tools/pedal-dose.ts` measures this function rather than a copy of it.
 */
export function keyPedalStep(
  value: number,
  want: number,
  ramp: { readonly riseS: number; readonly fallS: number },
  dt: number,
): number {
  const up = dt / ramp.riseS;
  const down = dt / ramp.fallS;
  const delta = want - value;
  return value + (delta > up ? up : delta < -down ? -down : delta);
}

/**
 * Time constant of a held steering key's wind-up. A key now asks for a share of the
 * front tyres' peak slip rather than of the lock, so it has to reach the top of the
 * travel sooner than the 0.45 s it used to take for the same yaw: 0.3 s puts a held key
 * at the peak in about two thirds of a second, and a 40 ms tap still asks for a light
 * correction. Tune in game.
 */
const STEER_RISE = 0.3;

/**
 * Time constant of the hand easing off after a steering key comes up. Measured with the
 * old instant release (80 km/h, Zhiguli): half the road-wheel angle was gone in one
 * physics step and the yaw in about 0.2 s, two to four times faster than before the
 * driving overhaul, so every correction was taken back the moment the key rose and
 * steering became a fight. 0.25 s halves the slip a key asked for in about 0.14 s,
 * which is what the old 0.32 s axis decay gave through its steeper curve.
 */
const STEER_EASE = 0.25;
/** Below this the easing hand lets go of the wheel: the axis reads exactly 0. */
const STEER_LET_GO = 0.03;

/**
 * One step of the keyboard steering axis toward `want`, -1..1.
 *
 * A held key winds the axis up over `STEER_RISE`; a reversal winds it through zero the
 * same way, the hand still on the wheel. A released key depends on `release`
 * (`KeySteerRelease`). With `letGo` the axis drops to 0 at once, because 0 is how the
 * frame says NO HAND IS ON THE WHEEL (`SteerMode`): the vehicle then lets the tyres'
 * own aligning moment turn it back, at the rate the road gives. With `ease` the axis
 * decays over `STEER_EASE` with the hand still on, and reads 0 — let go — only below
 * `STEER_LET_GO`. Exported so the benches drive the same ramp the game does.
 */
export function keySteerStep(
  value: number,
  want: number,
  dt: number,
  release: KeySteerRelease,
): number {
  if (want === 0) {
    if (release === 'letGo') return 0;
    const eased = value - value * Math.min(1, dt / STEER_EASE);
    return Math.abs(eased) < STEER_LET_GO ? 0 : eased;
  }
  return value + (want - value) * Math.min(1, dt / STEER_RISE);
}

/**
 * Precise-control wheel travel per CSS pixel. Roughly 900 px reaches full lock;
 * mouse sensitivity remains independent so camera preference cannot change steering.
 */
const PRECISE_MOUSE_GAIN = 0.0011;
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
 * Virtual-wheel travel per second while A or D is held in precise mode.
 *
 * At 60 Hz one tick moves 0.0092 of the full wheel range: small enough for a tap to
 * be a deliberate trim, while a hold winds from centre to full lock in 1.8 seconds.
 */
const PRECISE_KEY_RATE = 0.55;

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
  /**
   * Desktop parking brake state. Changed only by a new key press, never key hold, and
   * only while driving (see `setDriving`).
   */
  private keyboardHandbrake = false;
  /** Whether the player is in a driver's seat; set by the game, like precise steering. */
  private driving = false;
  /**
   * Raw horizontal mouse travel in CSS pixels since the last sample, kept apart from
   * `yawDelta` because steering must not inherit the look sensitivity.
   */
  private rawDX = 0;
  /** Is precise control switched on AND applicable (set by the game, not the device)? */
  private preciseSteerEnabled = false;
  /** Analog positions read against the assist's cap; see `setAnalogSteeringAssist`. */
  private analogSteerAssist = true;
  private keyboardSteerAssist = true;
  private keyboardSteerRelease: KeySteerRelease = 'letGo';
  /**
   * Linear steering-wheel position, -1..1. Mouse and keyboard add to the same value;
   * neither releasing a key nor stopping the mouse returns it toward centre.
   */
  private preciseWheel = 0;
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

  /** Attaches the touch overlay's state as a second input source. */
  attachTouch(touch: TouchControls): void {
    this.touch = touch;
  }

  /** Pointer-look gain in radians per CSS pixel. */
  setMouseSensitivity(sensitivity: number): void {
    this.mouseSensitivity = Math.max(0.0001, sensitivity);
  }

  /**
   * Switches precise control on or off. The GAME owns this, not the device: it is on
   * only while the preference is set and the player is actually driving, so the same
   * mouse still looks around freely on foot.
   */
  setPreciseSteering(enabled: boolean): void {
    if (!enabled) this.preciseWheel = 0;
    this.preciseSteerEnabled = enabled;
  }

  /**
   * The settings' steering assist for ANALOG positions — the pad's stick and the
   * precise-control wheel (`SteerMode`).
   */
  setAnalogSteeringAssist(enabled: boolean): void {
    this.analogSteerAssist = enabled;
  }

  /**
   * The settings' steering assist for the KEYBOARD (and the touch wheel, which follows
   * the same ramp): on, a held key asks for the tyres' peak at this speed (`keys`);
   * off, it winds toward the whole lock along the keyboard curve (`keysFull`).
   */
  setKeyboardSteeringAssist(enabled: boolean): void {
    this.keyboardSteerAssist = enabled;
  }

  /** The settings' `KeySteerRelease` for the keyboard and the touch wheel. */
  setKeyboardSteerRelease(release: KeySteerRelease): void {
    this.keyboardSteerRelease = release;
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
    this.driving = driving;
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
    // Losing focus mid-corner must not leave the throttle pinned.
    this.held.clear();
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) {
      void this.canvas.requestPointerLock();
      return;
    }
    // Middle button: the browser's autoscroll would otherwise fire on press.
    if (e.button === 1) e.preventDefault();
    if (e.button === 0) this.held.add('Mouse0');
    if (e.button === 1) this.held.add('Mouse1');
    if (e.button === 2) this.held.add('Mouse2');
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.held.delete('Mouse0');
    if (e.button === 1) this.held.delete('Mouse1');
    if (e.button === 2) this.held.delete('Mouse2');
  };

  private onContextMenu = (e: MouseEvent): void => {
    // Right mouse aims on foot and brakes during precise control; either way the
    // browser menu must not steal it.
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

  /**
   * Produces the frame for this tick. Mutates and returns an internal object, so
   * callers must not retain it across ticks.
   */
  sample(dt: number): InputFrame {
    const f = this.frame;
    // One source of truth per axis: touch-control values and digital inputs meet
    // here, so gameplay receives the same frame regardless of device.
    //
    // In precise mode mouse travel and A/D wind one persistent virtual wheel. The
    // mouse can also drive one-handed: left button is throttle, right is brake, and
    // holding the middle button hands motion back to the camera without moving the
    // wheel. Keyboard and mouse are deliberately additive rather than exclusive.
    const touch = this.touch?.input;
    const preciseDrive = this.preciseSteerEnabled;
    const mouseThrottle = preciseDrive && this.held.has('Mouse0');
    const mouseBrake = preciseDrive && this.held.has('Mouse2');
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
    const keyThrottle = this.anyHeld(this.keys.throttle) ? 1 : 0;
    const keyBrake = this.anyHeld(this.keys.brake) ? 1 : 0;
    if (pad.rightTrigger > 0) this.throttleDevice = 'pad';
    else if (keyThrottle > 0 || mouseThrottle) this.throttleDevice = 'keyboard';
    else if (touchForward > 0) this.throttleDevice = 'touch';
    if (pad.leftTrigger > 0) this.brakeDevice = 'pad';
    else if (keyBrake > 0 || mouseBrake) this.brakeDevice = 'keyboard';
    else if (touchBackward > 0) this.brakeDevice = 'touch';

    // A trigger is a position, so it lands as one: no rise, no fall. A key is a switch,
    // so it moves the pedal like a quick foot (`KEY_PEDAL_RAMPS`).
    const wantThrottle = Math.max(keyThrottle, touchForward, mouseThrottle ? 1 : 0);
    const wantBrake = Math.max(keyBrake, touchBackward, mouseBrake ? 1 : 0);
    f.throttle =
      this.throttleDevice === 'pad'
        ? pad.rightTrigger
        : keyPedalStep(f.throttle, wantThrottle, KEY_PEDAL_RAMPS.throttle, dt);
    f.brake =
      this.brakeDevice === 'pad'
        ? pad.leftTrigger
        : keyPedalStep(f.brake, wantBrake, KEY_PEDAL_RAMPS.brake, dt);
    // Reverse is the HELD command, not the smoothed pedal: on the keyboard that is
    // exactly the key's own state, so a release stops asking for reverse the same
    // instant it did before, while the pedal tail decays.
    f.reverse = this.brakeDevice === 'pad' ? pad.leftTrigger > 0 : wantBrake > 0;

    // Middle-button look suppresses only mouse travel. A/D still turns the wheel, so
    // looking into a bend never steals the keyboard half of the mixed control mode.
    const lookOverride = this.held.has('Mouse1');
    const steerWithMouse = preciseDrive && !lookOverride;
    const keySteer =
      (this.anyHeld(this.keys.right) ? 1 : 0) - (this.anyHeld(this.keys.left) ? 1 : 0);
    if (pad.steer !== 0) this.steerDevice = 'pad';
    else if (keySteer !== 0) this.steerDevice = 'keyboard';
    else if (touch?.steeringActive === true) this.steerDevice = 'touch';
    const analogMode = this.analogSteerAssist ? 'analogAssist' : 'analog';
    if (this.steerDevice === 'pad') {
      // An analog stick is already a position, held and released by the thumb; the
      // keyboard's rise ramp would only put a lag between it and the wheels.
      f.steer = pad.steer;
      f.steerMode = analogMode;
    } else if (preciseDrive) {
      const mouseDelta = steerWithMouse ? this.rawDX * PRECISE_MOUSE_GAIN : 0;
      const next = this.preciseWheel + mouseDelta + keySteer * PRECISE_KEY_RATE * dt;
      this.preciseWheel = next < -1 ? -1 : next > 1 ? 1 : next;
      f.steer = this.preciseWheel;
      f.steerMode = analogMode;
    } else {
      // The touch wheel is already analogue, so it supplies the same target the
      // keyboard ramp follows, and lifting the thumb lets go of the wheel like a key.
      const wantSteer = keySteer !== 0 || !touch?.steeringActive ? keySteer : touch.steer;
      f.steer = keySteerStep(f.steer, wantSteer, dt, this.keyboardSteerRelease);
      f.steerMode = this.keyboardSteerAssist ? 'keys' : 'keysFull';
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
    f.toggleLights =
      this.anyPressed(this.keys.lights)
      || taps?.lights === true
      || (this.driving && this.padPressed(PAD.LS));
    f.toggleLeftIndicator =
      this.anyPressed(this.keys.indicatorLeft) || (this.driving && this.padPressed(PAD.DLeft));
    f.toggleRightIndicator =
      this.anyPressed(this.keys.indicatorRight) || (this.driving && this.padPressed(PAD.DRight));
    f.cycleCamera =
      this.anyPressed(this.keys.camera) || taps?.camera === true || this.padPressed(PAD.Y);
    f.togglePreciseSteer = this.anyPressed(this.keys.mouseSteer) || this.padPressed(PAD.RS);
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
    // X is the pad's F: it enters and leaves a car, picks things up and opens what is
    // aimed at, exactly as the key does.
    f.interact = this.anyPressed(this.keys.interact) || taps?.interact === true || this.padPressed(PAD.X);
    f.mount = this.anyPressed(this.keys.mount) || taps?.mount === true || this.padPressed(PAD.X);
    f.useHeld =
      this.anyPressed(this.keys.useHeld) || taps?.useHeld === true || this.padPressed(PAD.B);
    f.dropItem =
      this.anyPressed(this.keys.drop)
      || taps?.drop === true
      || (!this.driving && this.padPressed(PAD.DDown));
    f.removeWearable =
      this.anyPressed(this.keys.removeWearable)
      || taps?.removeWearable === true
      || (!this.driving && this.padPressed(PAD.Back));
    // Both buttons are pedals while precise control is active, so they must not also
    // fire or aim the held item. The mode is enabled only while driving, so on foot
    // this is exactly the ordinary behavior.
    f.usePrimary = !preciseDrive && this.held.has('Mouse0');
    f.useSecondary = !preciseDrive && this.held.has('Mouse2');
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

    const drag = this.touch?.consumeLook();
    // While the mouse is steering it is not looking: feeding both would spin the
    // camera every time the driver corrected the car. Mouse2 gives the view back, and
    // the right stick is never steering, so it looks in either mode.
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
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.rawDX = 0;
    this.wheelDelta = 0;
    this.pressed.clear();
    for (let i = 0; i < this.padHeld.length; i++) this.padHeld[i] = pad.buttons[i] === true;
    return f;
  }
}
