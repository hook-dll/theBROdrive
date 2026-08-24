/**
 * Touch controls for playing on a phone or tablet.
 *
 * Pedals occupy the screen halves, the centre strip drags the camera, and a
 * persistent horizontal slider supplies precise analogue steering. This works over
 * plain HTTP: no motion-sensor permission, HTTPS certificate, or device tilt is
 * required.
 */

/** Fraction of screen width taken by the central look strip. */
const LOOK_BAND = 0.34;
/** Radians of view rotation per screen width dragged. */
const LOOK_SENSITIVITY = 3.2;

/** Buttons the overlay offers, and the frame field each one taps. */
export type TouchButton = 'interact' | 'mount' | 'camera' | 'spawn' | 'pause' | 'handbrake';

export interface TouchState {
  /** True once a touch has been seen and the overlay is live. */
  readonly active: boolean;
  /** Right-hand zone held: throttle in the car, forward on foot. */
  readonly forward: boolean;
  /** Left-hand zone held: brake in the car, backward on foot. */
  readonly backward: boolean;
  /** Handbrake button held. */
  readonly handbrake: boolean;
  /** Steering-slider value, -1..1. */
  readonly steer: number;
  /** True while the touch steering slider owns the steering axis. */
  readonly steeringActive: boolean;
  /** Look deltas in radians since the last read; cleared by `consumeLook`. */
  lookYaw: number;
  lookPitch: number;
  /** One-shot taps, cleared by `consumeTaps`. */
  interact: boolean;
  mount: boolean;
  camera: boolean;
}

interface TouchHooks {
  /**
   * Spawn button: the overlay has no catalogue, so main decides what to spawn.
   * Optional and dev-only — see `PauseHooks.spawnVehicle`. Absent hook means the
   * 'car' button is never built, so the row is one narrower on a phone.
   */
  readonly spawnVehicle?: () => void;
  /** Pause button: same overlay the Escape key opens. */
  readonly pause: () => void;
}

interface Zone {
  readonly forward: boolean;
  readonly backward: boolean;
  readonly look: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

export class TouchControls {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly hooks: TouchHooks;

  private overlay: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private readonly zones = new Map<number, Zone>();
  private readonly buttonsHeld = new Set<TouchButton>();

  private readonly state: TouchState & {
    active: boolean;
    forward: boolean;
    backward: boolean;
    handbrake: boolean;
    steer: number;
    steeringActive: boolean;
  } = {
    active: false,
    forward: false,
    backward: false,
    handbrake: false,
    steer: 0,
    steeringActive: false,
    lookYaw: 0,
    lookPitch: 0,
    interact: false,
    mount: false,
    camera: false,
  };

  constructor(root: HTMLElement, canvas: HTMLCanvasElement, hooks: TouchHooks) {
    this.root = root;
    this.canvas = canvas;
    this.hooks = hooks;
    // Passive: false, because a drag on the canvas must not also scroll or zoom the
    // page, and preventDefault is the only way to say so.
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  dispose(): void {
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.onTouchEnd);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.overlay?.remove();
    this.overlay = null;
  }

  /** The live state. Mutated in place; never retained by consumers across ticks. */
  get input(): TouchState {
    return this.state;
  }

  /** Release pedals and centre steering when the tab returns. */
  private onVisibility = (): void => {
    if (document.visibilityState !== 'visible') return;
    this.zones.clear();
    this.syncPedals();
    this.state.steer = 0;
  };

  /** Reads and clears the accumulated look drag. */
  consumeLook(): { yaw: number; pitch: number } {
    const yaw = this.state.lookYaw;
    const pitch = this.state.lookPitch;
    this.state.lookYaw = 0;
    this.state.lookPitch = 0;
    return { yaw, pitch };
  }

  /** Reads and clears the one-shot button taps. */
  consumeTaps(): { interact: boolean; mount: boolean; camera: boolean } {
    const taps = {
      interact: this.state.interact,
      mount: this.state.mount,
      camera: this.state.camera,
    };
    this.state.interact = false;
    this.state.mount = false;
    this.state.camera = false;
    return taps;
  }

  // ---------------------------------------------------------------------------
  // Touch
  // ---------------------------------------------------------------------------

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.activate();
    for (const touch of Array.from(e.changedTouches)) {
      this.zones.set(touch.identifier, this.zoneFor(touch));
    }
    this.syncPedals();
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      const zone = this.zones.get(touch.identifier);
      if (!zone) continue;
      const dx = touch.clientX - zone.lastX;
      const dy = touch.clientY - zone.lastY;
      zone.lastX = touch.clientX;
      zone.lastY = touch.clientY;
      if (!zone.look) continue;
      // Same convention as the mouse: positive yaw is "look right", positive pitch
      // is "look up", and the consumer converts into its own basis.
      const perWidth = LOOK_SENSITIVITY / Math.max(1, window.innerWidth);
      this.state.lookYaw += dx * perWidth;
      this.state.lookPitch -= dy * perWidth;
    }
  };


  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) this.zones.delete(touch.identifier);
    this.syncPedals();
  };

  /**
   * Which control a touch landed on. The central band is the look strip; either side
   * of it is a pedal. A touch keeps the zone it started in for its whole life, so
   * sliding a thumb off the edge of the throttle does not silently lift off.
   */
  private zoneFor(touch: Touch): Zone {
    const width = Math.max(1, window.innerWidth);
    const x = touch.clientX / width;
    const half = LOOK_BAND / 2;
    const look = x > 0.5 - half && x < 0.5 + half;
    return {
      look,
      forward: !look && x >= 0.5,
      backward: !look && x < 0.5,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
    };
  }

  private syncPedals(): void {
    let forward = false;
    let backward = false;
    for (const zone of this.zones.values()) {
      if (zone.forward) forward = true;
      if (zone.backward) backward = true;
    }
    this.state.forward = forward;
    this.state.backward = backward;
  }

  // ---------------------------------------------------------------------------
  // Overlay
  // ---------------------------------------------------------------------------

  private activate(): void {
    if (this.state.active) return;
    this.state.active = true;
    this.state.steeringActive = true;
    this.buildOverlay();
  }


  private buildOverlay(): void {
    if (this.overlay) return;
    const overlay = document.createElement('div');
    overlay.className = 'touch-ui';

    // One row along the top edge, out of the way of both thumbs: the bottom corners
    // belong to the pedals, and a button sitting where a thumb rests gets pressed by
    // accident. Words rather than key letters — "E" and "F" mean nothing on a device
    // that has no keyboard.
    const row = document.createElement('div');
    row.className = 'touch-row';
    row.appendChild(this.makeButton('interact', 'enter/exit'));
    row.appendChild(this.makeButton('mount', 'pickup'));
    row.appendChild(this.makeButton('handbrake', 'brake'));
    row.appendChild(this.makeButton('camera', 'view'));
    if (this.hooks.spawnVehicle) row.appendChild(this.makeButton('spawn', 'car'));
    row.appendChild(this.makeButton('pause', 'menu'));
    overlay.appendChild(row);

    const steering = document.createElement('input');
    steering.type = 'range';
    steering.className = 'touch-steering';
    steering.min = '-1';
    steering.max = '1';
    steering.step = '0.01';
    steering.value = '0';
    steering.setAttribute('aria-label', 'Steering');
    steering.addEventListener('input', () => {
      this.state.steer = steering.valueAsNumber;
    });
    overlay.appendChild(steering);

    this.hint = document.createElement('div');
    this.hint.className = 'touch-hint';
    this.hint.textContent = 'steer with slider · right half go · left half back · drag centre to look';
    overlay.appendChild(this.hint);
    window.setTimeout(() => this.hint?.classList.add('is-faded'), 6000);

    this.root.appendChild(overlay);
    this.overlay = overlay;
  }

  /**
   * A momentary button: `touchstart` arms it, `touchend` releases it. The handbrake
   * is the exception — it LATCHES, because holding a button down with one thumb while
   * the other works the pedals is not something a phone player can do, and a parking
   * brake that only exists while a finger is on it is not a parking brake. Tap on,
   * tap off; the button stays lit while it is on, and the HUD says so too.
   */
  private makeButton(id: TouchButton, label: string): HTMLElement {
    const button = document.createElement('button');
    button.className = 'touch-btn';
    button.textContent = label;
    button.type = 'button';
    const latching = id === 'handbrake';
    button.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (latching) {
          this.state.handbrake = !this.state.handbrake;
          button.classList.toggle('is-down', this.state.handbrake);
          return;
        }
        this.press(id);
        button.classList.add('is-down');
      },
      { passive: false },
    );
    const release = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      if (latching) return;
      this.buttonsHeld.delete(id);
      button.classList.remove('is-down');
    };
    button.addEventListener('touchend', release, { passive: false });
    button.addEventListener('touchcancel', release, { passive: false });
    return button;
  }

  private press(id: TouchButton): void {
    this.buttonsHeld.add(id);
    switch (id) {
      case 'interact':
        this.state.interact = true;
        break;
      case 'mount':
        this.state.mount = true;
        break;
      case 'camera':
        this.state.camera = true;
        break;
      case 'handbrake':
        // Handled by the latch above; never reached.
        break;
      case 'spawn':
        this.hooks.spawnVehicle?.();
        break;
      case 'pause':
        this.hooks.pause();
        break;
    }
  }

}
