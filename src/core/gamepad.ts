/**
 * Gamepad is data, not device access.
 *
 * Same contract as `InputReader`: this module owns the Gamepad API and nothing
 * else. It hands out a plain `GamepadState` — dead-zoned axes, held buttons — and
 * two consumers read it: `InputReader` merges it into the `InputFrame` the game
 * drives from, and the menu overlay uses it for focus navigation while the loop is
 * stopped. Neither of them ever touches `navigator.getGamepads`.
 *
 * ONE HUB, shared, because hot-plug is a device EVENT and two readers with their own
 * `gamepadconnected` listeners would toast the same pad twice. The pad is read, not
 * owned: `read()` takes a fresh snapshot and writes it into the caller-visible
 * `state` object, and nothing here keeps game state.
 *
 * The layout is the W3C "standard" mapping — what an Xbox pad reports in Chrome:
 * left stick steer, LT/RT analog pedals, A/B/X/Y, the bumpers as gear paddles, the
 * D-pad for the secondary driving actions. `standard` is required for a pad to be
 * used, because the whole mapping is indices: a device that reports its own layout
 * would otherwise drive the car with its triggers as its steering.
 */

/** Button indices of the W3C "standard" mapping, named for the reading code. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Back: 8,
  Start: 9,
  LS: 10,
  RS: 11,
  DUp: 12,
  DDown: 13,
  DLeft: 14,
  DRight: 15,
} as const;

/** Standard-mapping button count; longer pads (touchpads, extra paddles) are ignored. */
const BUTTON_COUNT = 17;

/**
 * Radial dead-zone default, as a fraction of full stick travel.
 *
 * Radial rather than per-axis so a stick pushed into a corner cannot read as more
 * than one full deflection, and small because the thumbsticks this game is played
 * with are Hall-effect or fresh: 8% is the drift these pads show at rest.
 */
export const DEFAULT_DEADZONE = 0.08;

/**
 * Dead-zone for the analog triggers, as a fraction of travel.
 *
 * Chrome reports an untouched Xbox trigger as 0 exactly, but a slightly worn one
 * rests a few percent in; anything under this reads as no pedal at all, so a car with
 * a pad attached never creeps.
 */
const TRIGGER_DEADZONE = 0.04;

/**
 * Steering response curve exponent, applied to the dead-zoned stick.
 *
 * Above 1, so the middle of the stick's travel is the fine control it is on a real
 * wheel and full lock still arrives at the stop. This is deliberately MILD and
 * deliberately not a keyboard-style ramp: an analog stick is already a position, and
 * smoothing it would make the front wheels lag the thumbs.
 */
const STEER_CURVE = 1.4;

/** Shortest and longest a single `playEffect` rumble lasts, milliseconds. */
const RUMBLE_DURATION_MS = 160;
/**
 * How often a held rumble is re-issued, milliseconds.
 *
 * A haptic effect has a duration and then stops, so a continuous signal is a series
 * of short effects that overlap. 80 ms is under the ~100 ms at which a human reads
 * a gap as a break, and it is not one call per frame: at 144 Hz that would be three
 * `playEffect` promises per effect for no extra feel.
 */
const RUMBLE_INTERVAL_MS = 80;

/** One frame of rumble demand, levels 0..1. Reused by the caller, never retained. */
export interface RumbleFrame {
  /** Strong motor: suspension bumps, landings, impacts. */
  strong: number;
  /**
   * Weak motor: road texture under the tyres, tyre slide, lock-up, and the steering
   * going light as the front tyres' aligning moment collapses past its peak — the one
   * piece of steering feel a pad without force feedback can carry.
   */
  weak: number;
  /** Left trigger motor, 0..1; only used on pads that support trigger rumble. */
  leftTrigger: number;
  /** Right trigger motor, 0..1; only used on pads that support trigger rumble. */
  rightTrigger: number;
}

/** The pad's state for one frame. Owned by the hub, rewritten in place. */
export interface GamepadState {
  /** A pad answered this read. */
  connected: boolean;
  /** Steering, -1..1: dead-zone, sensitivity and response curve already applied. */
  steer: number;
  /** Left stick, dead-zone applied and unscaled: on-foot movement, -1..1. */
  moveX: number;
  /** Left stick forward (+1 = pushed away from the player): on-foot movement. */
  moveZ: number;
  /** Right stick, dead-zone applied: camera look, -1..1 (+x right, +y up). */
  lookX: number;
  lookY: number;
  /** Analog pedal travel, 0..1: LT is the brake, RT the throttle. */
  leftTrigger: number;
  rightTrigger: number;
  /**
   * Held buttons by standard-mapping index. The same array every read — edges are the
   * reader's business, because only the reader knows which frame it last saw.
   */
  buttons: readonly boolean[];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Radial dead-zone: below `deadzone` the stick is at rest, and above it the remaining
 * travel is rescaled to the full 0..1 so the first millimetre past the dead-zone is a
 * slow crawl rather than a jump.
 */
function deadzoneAxis(x: number, y: number, deadzone: number, out: { x: number; y: number }): void {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone || mag === 0) {
    out.x = 0;
    out.y = 0;
    return;
  }
  const scale = Math.min(1, (mag - deadzone) / (1 - deadzone)) / mag;
  out.x = x * scale;
  out.y = y * scale;
}

const _stick = { x: 0, y: 0 };

/**
 * The shared pad hub: hot-plug, one snapshot per read, and the rumble actuators.
 *
 * `read()` is the only hot path and it allocates nothing of its own: it writes into
 * `state` and its own scratch vectors. The browser's `getGamepads()` necessarily
 * builds a fresh array of `Gamepad` snapshots each call, which is the API's cost and
 * the reason the two consumers both go through this one hub rather than each polling
 * for themselves.
 */
export class GamepadHub {
  readonly state: GamepadState = {
    connected: false,
    steer: 0,
    moveX: 0,
    moveZ: 0,
    lookX: 0,
    lookY: 0,
    leftTrigger: 0,
    rightTrigger: 0,
    buttons: new Array<boolean>(BUTTON_COUNT).fill(false),
  };

  /** Dead-zone in stick travel, from the settings; see `DEFAULT_DEADZONE`. */
  private deadzone = DEFAULT_DEADZONE;
  /**
   * Steering sensitivity multiplier, from the settings: 1 leaves the stick as it is,
   * lower makes full lock need more travel, higher reaches it sooner. Applied to the
   * stick BEFORE the curve so the whole response rotates rather than just its top.
   */
  private steerSensitivity = 1;
  /** Gamepad of the last read, kept only for its actuators. */
  private actuator: GamepadHapticActuator | null = null;
  private triggerRumble = false;
  /** Milliseconds of the last issued effect; see `RUMBLE_INTERVAL_MS`. */
  private lastRumbleMs = -1e9;
  /** True while an effect issued by `vibrate` may still be running. */
  private rumbling = false;
  /** Name of the pad that connected since a consumer last asked, if any. */
  private notice: string | null = null;

  constructor() {
    window.addEventListener('gamepadconnected', this.onConnected);
    window.addEventListener('gamepaddisconnected', this.onDisconnected);
  }

  private onConnected = (event: GamepadEvent): void => {
    // The carried name is Chrome's full string ("Xbox Wireless Controller (STANDARD
    // GAMEPAD Vendor: 045e Product: 0b13)"); the part before the parenthesis is the
    // one a toast can show.
    this.notice = event.gamepad.id.split(' (')[0] ?? event.gamepad.id;
  };

  private onDisconnected = (): void => {
    this.actuator = null;
    this.triggerRumble = false;
    this.rumbling = false;
  };

  /** Dead-zone for stick axes, 0..1, from the settings. */
  setDeadzone(deadzone: number): void {
    this.deadzone = clamp01(deadzone);
  }

  /** Steering sensitivity multiplier, nominally 0.2..2; see the field's note. */
  setSteeringSensitivity(sensitivity: number): void {
    this.steerSensitivity = sensitivity > 0.05 ? Math.min(3, sensitivity) : 0.05;
  }

  /**
   * The pad that connected since the last call, or null. Consumed, so only one
   * surface announces one connect.
   */
  takeConnectionNotice(): string | null {
    const notice = this.notice;
    this.notice = null;
    return notice;
  }

  /** True while a pad with the standard mapping is answering. */
  get connected(): boolean {
    return this.state.connected;
  }

  /**
   * A fresh snapshot, written into `state` and returned. Callers must not retain it:
   * the next read rewrites it.
   */
  read(): GamepadState {
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const candidate of pads) {
      if (candidate !== null && candidate.connected && candidate.mapping === 'standard') {
        pad = candidate;
        break;
      }
    }
    const state = this.state;
    if (pad === null) {
      state.connected = false;
      state.steer = 0;
      state.moveX = 0;
      state.moveZ = 0;
      state.lookX = 0;
      state.lookY = 0;
      state.leftTrigger = 0;
      state.rightTrigger = 0;
      const buttons = state.buttons as boolean[];
      for (let i = 0; i < BUTTON_COUNT; i++) buttons[i] = false;
      this.actuator = null;
      this.triggerRumble = false;
      this.rumbling = false;
      return state;
    }

    state.connected = true;
    deadzoneAxis(pad.axes[0] ?? 0, pad.axes[1] ?? 0, this.deadzone, _stick);
    state.moveX = _stick.x;
    // The stick's Y axis is negative away from the player; movement and steering
    // both read forward as positive.
    state.moveZ = -_stick.y;
    const steer = Math.max(-1, Math.min(1, _stick.x * this.steerSensitivity));
    state.steer = Math.sign(steer) * Math.pow(Math.abs(steer), STEER_CURVE);

    deadzoneAxis(pad.axes[2] ?? 0, pad.axes[3] ?? 0, this.deadzone, _stick);
    state.lookX = _stick.x;
    state.lookY = -_stick.y;

    const lt = pad.buttons[PAD.LT]?.value ?? 0;
    const rt = pad.buttons[PAD.RT]?.value ?? 0;
    state.leftTrigger = lt > TRIGGER_DEADZONE ? clamp01((lt - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE)) : 0;
    state.rightTrigger = rt > TRIGGER_DEADZONE ? clamp01((rt - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE)) : 0;

    const buttons = state.buttons as boolean[];
    for (let i = 0; i < BUTTON_COUNT; i++) buttons[i] = pad.buttons[i]?.pressed === true;

    const actuator = pad.vibrationActuator ?? null;
    if (actuator !== this.actuator) {
      this.actuator = actuator;
      // `effects` is the spec's list of supported effect types, but it is not in the
      // DOM typings yet, so it is read through a cast and treated as absent when a
      // browser does not expose it.
      const effects = (actuator as { effects?: readonly string[] } | null)?.effects;
      this.triggerRumble = Array.isArray(effects) && effects.includes('trigger-rumble');
    }
    return state;
  }

  /**
   * Asks the pad to shake, `frame` scaled 0..1 by the caller. Rate-limited: a short
   * effect is re-issued every `RUMBLE_INTERVAL_MS` while the demand lasts, so a
   * continuous signal costs about twelve calls a second and never one per frame.
   *
   * `nowMs` is passed rather than read so the caller's clock decides, which keeps a
   * paused game from issuing effects behind the overlay.
   */
  vibrate(frame: RumbleFrame, nowMs: number): void {
    const actuator = this.actuator;
    const strong = clamp01(frame.strong);
    const weak = clamp01(frame.weak);
    if (actuator === null) return;
    if (strong <= 0 && weak <= 0) {
      this.stopRumble();
      return;
    }
    if (this.rumbling && nowMs - this.lastRumbleMs < RUMBLE_INTERVAL_MS) return;
    this.lastRumbleMs = nowMs;
    this.rumbling = true;
    const dual = actuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration: RUMBLE_DURATION_MS,
      strongMagnitude: strong,
      weakMagnitude: weak,
    });
    // A rejected promise is the pad's own answer ("not supported, not permitted");
    // there is nothing to recover and nothing to report.
    dual?.catch(() => undefined);
    if (this.triggerRumble) {
      const left = clamp01(frame.leftTrigger);
      const right = clamp01(frame.rightTrigger);
      if (left > 0 || right > 0) {
        const trigger = actuator.playEffect('trigger-rumble', {
          startDelay: 0,
          duration: RUMBLE_DURATION_MS,
          strongMagnitude: 0,
          weakMagnitude: 0,
          leftTrigger: left,
          rightTrigger: right,
        });
        trigger?.catch(() => undefined);
      }
    }
  }

  /**
   * Silences the pad now. Called when the thing being reported stops existing — the
   * game pauses, the player steps out, the window loses focus — because an effect
   * already issued cannot be recalled by refusing to issue the next one.
   */
  stopRumble(): void {
    if (!this.rumbling) return;
    this.rumbling = false;
    const reset = this.actuator?.reset();
    reset?.catch(() => undefined);
  }
}

let hub: GamepadHub | null = null;

/** The one hub. Created on first use, so a session with no pad pays only for this. */
export function gamepads(): GamepadHub {
  return (hub ??= new GamepadHub());
}
