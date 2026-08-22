/**
 * Input is data, not device access.
 *
 * Gameplay systems consume an `InputFrame` and never touch the keyboard. That
 * separation is what makes a replay, an AI driver, or a remote player's input
 * indistinguishable from a local one (see NETPLAY notes in world/road.ts).
 */

export interface InputFrame {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
  /** Requested shift this tick: -1 down, 0 none, +1 up. */
  shift: number;
  /** Toggle intents, consumed once by the system that handles them. */
  toggleLights: boolean;
  cycleCamera: boolean;
  /** Re-centre the view (behind the car when driving, level horizon on foot): tap, consumed by CameraRig. */
  recenterCamera: boolean;
  /** Enter/exit the car (entry needs an open or removed door): tap, consumed once by interaction. */
  interact: boolean;
  /** Pick up a loose part/item, or fit/remove a part at the aimed slot: tap, consumed once by interaction. */
  mount: boolean;
  /** Drop the held item in front of the player: tap, consumed once by interaction. */
  dropItem: boolean;
  /** Primary use of the held item: scrub, pour, fire. Held, not tapped. */
  usePrimary: boolean;
  /** Secondary use: aim down sights, precision placement. */
  useSecondary: boolean;
  /** Cycle the held item: -1 or +1. */
  cycleItem: number;
  /** Direct inventory slot pick from the number row: 0 = none, otherwise 1..8. */
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
}

export function emptyInput(): InputFrame {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    shift: 0,
    toggleLights: false,
    cycleCamera: false,
    recenterCamera: false,
    interact: false,
    mount: false,
    dropItem: false,
    usePrimary: false,
    useSecondary: false,
    cycleItem: 0,
    selectSlot: 0,
    moveX: 0,
    moveZ: 0,
    jump: false,
    sprint: false,
    lookYaw: 0,
    lookPitch: 0,
    zoomDelta: 0,
  };
}

/**
 * Every remappable action, in display order. This is the single source of truth
 * for the settings screen (labels + defaults) and for the effective bindings
 * (InputReader resolves overrides against it). Escape is deliberately absent:
 * it is the pause key, handled outside InputReader, and can never be rebound.
 * The mouse buttons are equally fixed — they map straight to
 * usePrimary/useSecondary and are not actions.
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
  { id: 'handbrake', label: 'Handbrake', defaultKeys: ['Space'] },
  // Gears sit next to the steering hand on X and Z. The mouse wheel is deliberately
  // NOT a gear lever: it is the chase camera's zoom, and sharing it made zooming
  // while driving impossible.
  { id: 'shiftUp', label: 'Shift up', defaultKeys: ['KeyX'] },
  { id: 'shiftDown', label: 'Shift down', defaultKeys: ['KeyZ'] },
  { id: 'lights', label: 'Toggle lights', defaultKeys: ['KeyL'] },
  { id: 'camera', label: 'Cycle camera', defaultKeys: ['KeyC'] },
  { id: 'recenterCamera', label: 'Recenter camera', defaultKeys: ['KeyV'] },
  { id: 'interact', label: 'Interact', defaultKeys: ['KeyE'] },
  { id: 'mount', label: 'Pick up / mount', defaultKeys: ['KeyF'] },
  { id: 'drop', label: 'Drop item', defaultKeys: ['KeyQ'] },
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

/**
 * The effective keys for one action: the override when it has usable keys,
 * otherwise the default. Escape is the pause key (handled outside InputReader)
 * and the mouse buttons are the fixed usePrimary/useSecondary actions, so
 * neither can ever appear in a binding; a bad override degrades to the default
 * rather than silently unbinding the action.
 */
function resolveKeys(
  override: readonly string[] | undefined,
  defaults: readonly string[],
): readonly string[] {
  if (!override || override.length === 0) return defaults;
  let cleaned: string[] | null = null;
  for (const code of override) {
    if (code !== 'Escape' && !code.startsWith('Mouse')) {
      if (cleaned === null) cleaned = [];
      cleaned.push(code);
    }
  }
  return cleaned !== null && cleaned.length > 0 ? cleaned : defaults;
}

/** Seconds for a digital key to ramp an analogue axis from 0 to 1. */
const AXIS_RISE = 0.18;
const AXIS_FALL = 0.3;
const STEER_RISE = 0.25;
/** Steering self-centres faster than the player releases, as a real wheel does. */
const STEER_RETURN = 0.55;

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
   * Effective action -> key list for this reader. Precomputed at construction
   * and on setKeyBindings so the hot path (sample) only reads arrays — it never
   * builds or merges anything per tick.
   */
  private keys: Record<string, readonly string[]> = DEFAULT_BINDINGS;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mouseSensitivity = 0.0022,
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
    if (e.button === 0) this.held.add('Mouse0');
    if (e.button === 2) this.held.add('Mouse2');
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.held.delete('Mouse0');
    if (e.button === 2) this.held.delete('Mouse2');
  };

  private onContextMenu = (e: MouseEvent): void => {
    // Right mouse is aim-down-sights; the browser menu must not steal it.
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

    const wantThrottle = this.anyHeld(this.keys.throttle) ? 1 : 0;
    const wantBrake = this.anyHeld(this.keys.brake) ? 1 : 0;
    f.throttle +=
      (wantThrottle - f.throttle) * Math.min(1, dt / (wantThrottle > 0 ? AXIS_RISE : AXIS_FALL));
    f.brake += (wantBrake - f.brake) * Math.min(1, dt / (wantBrake > 0 ? AXIS_RISE : AXIS_FALL));

    const wantSteer =
      (this.anyHeld(this.keys.right) ? 1 : 0) - (this.anyHeld(this.keys.left) ? 1 : 0);
    f.steer +=
      (wantSteer - f.steer) * Math.min(1, dt / (wantSteer === 0 ? STEER_RETURN : STEER_RISE));

    f.handbrake = this.anyHeld(this.keys.handbrake);
    f.shift =
      (this.anyPressed(this.keys.shiftUp) ? 1 : 0) -
      (this.anyPressed(this.keys.shiftDown) ? 1 : 0);
    f.toggleLights = this.anyPressed(this.keys.lights);
    f.cycleCamera = this.anyPressed(this.keys.camera);
    f.recenterCamera = this.anyPressed(this.keys.recenterCamera);
    f.interact = this.anyPressed(this.keys.interact);
    f.mount = this.anyPressed(this.keys.mount);
    f.dropItem = this.anyPressed(this.keys.drop);
    f.usePrimary = this.held.has('Mouse0');
    f.useSecondary = this.held.has('Mouse2');
    f.cycleItem =
      (this.anyPressed(this.keys.itemNext) ? 1 : 0) -
      (this.anyPressed(this.keys.itemPrev) ? 1 : 0);

    // Number row 1..8 picks an inventory slot directly. Digit codes are contiguous,
    // and the numpad row is accepted too so either hand works.
    f.selectSlot = 0;
    for (let n = 1; n <= 8; n++) {
      if (this.pressed.has(`Digit${n}`) || this.pressed.has(`Numpad${n}`)) {
        f.selectSlot = n;
        break;
      }
    }
    f.moveX = (this.anyHeld(this.keys.right) ? 1 : 0) - (this.anyHeld(this.keys.left) ? 1 : 0);
    f.moveZ =
      (this.anyHeld(this.keys.throttle) ? 1 : 0) - (this.anyHeld(this.keys.brake) ? 1 : 0);
    f.jump = this.anyPressed(this.keys.jump);
    f.sprint = this.anyHeld(this.keys.sprint);

    f.lookYaw = this.yawDelta;
    f.lookPitch = this.pitchDelta;
    f.zoomDelta = this.wheelDelta;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.wheelDelta = 0;
    this.pressed.clear();
    return f;
  }
}
