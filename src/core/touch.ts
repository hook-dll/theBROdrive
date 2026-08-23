/**
 * Touch and tilt controls, for playing on a phone or tablet.
 *
 * The scheme, and the reasoning behind it:
 *
 *  - The RIGHT half of the screen is go, the LEFT half is back off. On foot that is
 *    walk forward / walk backward; in the car it is throttle / brake, which is the
 *    same pair of pedals a driver already has muscle memory for. Two thumbs, no
 *    joysticks, nothing to look at.
 *  - STEERING IS THE DEVICE. Tilt the phone like a wheel. A screen thumbstick would
 *    take one of the two thumbs already committed to the pedals, and steering is the
 *    one input that wants to be analogue and continuous.
 *  - Looking is a DRAG from the middle band. Dragging anywhere would fight the
 *    pedals, so the look zone is a strip down the centre of the screen; a drag
 *    there turns the view, exactly as the mouse does on a desktop.
 *  - Everything else is a button: enter/exit, pick up, camera, spawn a car, pause.
 *    They are the actions with no analogue equivalent, and without them a phone
 *    player cannot even get into the car.
 *
 * The overlay only exists on touch devices, and it is built on the FIRST touch
 * rather than from a user-agent string: a laptop with a touchscreen gets the buttons
 * only if its owner actually touches the screen, and a phone with a paired keyboard
 * keeps working either way. Nothing here is drawn or listened for on a desktop.
 *
 * Like `InputReader`, this produces DATA. It resolves nothing about the game: it
 * fills a state object that `InputReader.sample` folds into the same `InputFrame`
 * the keyboard produces, so every gameplay system stays device-blind.
 */

/** Fraction of screen width taken by the central look strip. */
const LOOK_BAND = 0.34;
/** Radians of view rotation per screen width dragged. */
const LOOK_SENSITIVITY = 3.2;
/**
 * Device roll, in degrees from the calibrated neutral, that means full steering
 * lock. 22 degrees is a comfortable wrist rotation while holding a phone in two
 * hands, and small enough that the horizon does not swing wildly.
 */
const TILT_FULL_DEGREES = 22;
/** Roll below this many degrees is treated as straight ahead: hands are never still. */
const TILT_DEAD_DEGREES = 2.2;
/**
 * Sign of the roll-to-steer mapping.
 *
 * TRUE, measured on a real phone: with the raw gravity resolution below, tilting the
 * device left produced a right-hand steering input — mirrored, which is the one thing
 * about an accelerometer that cannot be checked from a desktop, since a synthetic
 * `DeviceOrientationEvent` reproduces whatever convention the test author assumed
 * rather than what the hardware reports.
 *
 * It is a single sign because the gravity vector is resolved into SCREEN space, which
 * already accounts for the device being held in landscape either way round: rotating
 * the phone 180 degrees flips both the sensor axis and `screen.orientation.angle`, so
 * the product stays the same and one constant covers every orientation.
 */
const TILT_INVERT = true;

/**
 * Fallback steering, for when the accelerometer never reports.
 *
 * It usually never reports for one reason: motion sensors are gated behind a SECURE
 * CONTEXT. `http://<lan-ip>` is not one, so on a phone opened over plain LAN HTTP
 * `deviceorientation` simply stays silent — no error, no permission prompt, nothing.
 * (`localhost` is exempt, which is why it works on the desktop that serves it.)
 *
 * Rather than leave the car unsteerable, the pedal thumb doubles as the wheel: slide
 * it sideways from where it first landed and the car turns, proportional to the
 * slide. This many pixels of slide is full lock.
 */
const SLIDE_FULL_PX = 90;
/** Slide below this many pixels is straight ahead: a thumb never holds still. */
const SLIDE_DEAD_PX = 8;
/** Seconds after the first touch before the missing sensor is called missing. */
const TILT_WAIT_SECONDS = 2.5;

/** Buttons the overlay offers, and the frame field each one taps. */
export type TouchButton = 'interact' | 'mount' | 'camera' | 'spawn' | 'pause' | 'handbrake';

export interface TouchState {
  /** True once a touch has been seen: the overlay is live and steering is tilt. */
  readonly active: boolean;
  /** Right-hand zone held: throttle in the car, forward on foot. */
  readonly forward: boolean;
  /** Left-hand zone held: brake in the car, backward on foot. */
  readonly backward: boolean;
  /** Handbrake button held. */
  readonly handbrake: boolean;
  /** Steering from device roll, -1..1, already dead-zoned and clamped. */
  readonly steer: number;
  /** True while orientation events are arriving, so steering should use `steer`. */
  readonly tilting: boolean;
  /** Look deltas in radians since the last read; cleared by `consumeLook`. */
  lookYaw: number;
  lookPitch: number;
  /** One-shot taps, cleared by `consumeTaps`. */
  interact: boolean;
  mount: boolean;
  camera: boolean;
}

interface TouchHooks {
  /** Spawn button: the overlay has no catalogue, so main decides what to spawn. */
  readonly spawnVehicle: () => void;
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

  /** Neutral roll, degrees, captured when orientation events first arrive. */
  private tiltNeutral: number | null = null;
  private tiltDegrees = 0;
  private tiltSeen = false;
  /** True once the sensor has been given its chance and stayed silent. */
  private tiltBlocked = false;

  private readonly state: TouchState & {
    active: boolean;
    forward: boolean;
    backward: boolean;
    handbrake: boolean;
    steer: number;
    tilting: boolean;
  } = {
    active: false,
    forward: false,
    backward: false,
    handbrake: false,
    steer: 0,
    tilting: false,
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
    // The neutral roll is whatever pose the player was holding when steering began,
    // so it goes stale the moment that pose changes: turning the device, or putting
    // it down and picking it up again. Both of those are observable, and forgetting
    // the neutral is cheap — the next reading becomes the new straight-ahead.
    window.addEventListener('orientationchange', this.recentreTilt);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  dispose(): void {
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.onTouchEnd);
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.removeEventListener('orientationchange', this.recentreTilt);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.overlay?.remove();
    this.overlay = null;
  }

  /** The live state. Mutated in place; never retained by consumers across ticks. */
  get input(): TouchState {
    return this.state;
  }

  /** Both pedals up and the tilt forgotten: called when the tab comes back. */
  private onVisibility = (): void => {
    if (document.visibilityState !== 'visible') return;
    this.zones.clear();
    this.syncPedals();
    this.recentreTilt();
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
    this.syncSlideSteer();
  };

  /**
   * Steering from how far a pedal thumb has slid sideways, used only while the
   * accelerometer is silent (see SLIDE_FULL_PX). Both pedals can steer, and if both
   * are down the larger slide wins rather than the two averaging into nothing.
   */
  private syncSlideSteer(): void {
    if (!this.tiltBlocked) return;
    let best = 0;
    for (const zone of this.zones.values()) {
      if (zone.look) continue;
      const slide = zone.lastX - zone.startX;
      if (Math.abs(slide) > Math.abs(best)) best = slide;
    }
    const magnitude = Math.max(0, Math.abs(best) - SLIDE_DEAD_PX) / (SLIDE_FULL_PX - SLIDE_DEAD_PX);
    this.state.steer = Math.min(1, magnitude) * Math.sign(best);
    this.state.tilting = true;
  }

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) this.zones.delete(touch.identifier);
    this.syncPedals();
    this.syncSlideSteer();
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
  // Tilt
  // ---------------------------------------------------------------------------

  /**
   * First touch: build the overlay, ask for orientation, and start the watchdog.
   *
   * iOS only hands out accelerometer data after an explicit permission call made from
   * a user gesture, which is exactly what this is. Android and desktop Chrome have no
   * such gate, so the request is optional and its absence is not an error.
   *
   * The watchdog exists because the common failure is SILENT: over plain
   * `http://<lan-ip>` the page is not a secure context, so no motion events are ever
   * delivered and nothing tells the player why. After TILT_WAIT_SECONDS with no
   * reading, the hint says so and thumb-slide steering takes over.
   */
  private activate(): void {
    if (this.state.active) return;
    this.state.active = true;
    this.buildOverlay();

    const ctor = window.DeviceOrientationEvent as
      | (typeof window.DeviceOrientationEvent & { requestPermission?: () => Promise<string> })
      | undefined;
    if (!ctor) {
      this.markTiltBlocked('no motion sensor');
    } else if (ctor.requestPermission) {
      void ctor
        .requestPermission()
        .then((result) => {
          if (result === 'granted') window.addEventListener('deviceorientation', this.onOrientation);
          else this.markTiltBlocked('motion access denied');
        })
        .catch(() => this.markTiltBlocked('motion access unavailable'));
    } else {
      window.addEventListener('deviceorientation', this.onOrientation);
    }

    window.setTimeout(() => {
      if (!this.tiltSeen) {
        this.markTiltBlocked(
          window.isSecureContext ? 'no tilt readings' : 'tilt needs https on a phone',
        );
      }
    }, TILT_WAIT_SECONDS * 1000);
  }

  /** Switches steering to the thumb slide and says why on screen. */
  private markTiltBlocked(reason: string): void {
    if (this.tiltBlocked) return;
    this.tiltBlocked = true;
    this.state.steer = 0;
    if (this.hint) {
      this.hint.textContent = `${reason} · slide the pedal thumb left/right to steer`;
      this.hint.classList.remove('is-faded');
      this.hint.classList.add('is-warning');
    }
  }

  /**
   * Device roll, resolved into SCREEN space.
   *
   * `beta`/`gamma` are the device's own front-back and left-right tilt, so which of
   * them is "roll" depends on how the screen is rotated inside the device. Building
   * the gravity vector and then rotating it by `screen.orientation.angle` makes the
   * answer independent of that: `sx` is how far gravity has swung toward the right of
   * the SCREEN, which is what turning the phone like a steering wheel does.
   */
  private onOrientation = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null) return;
    const rad = Math.PI / 180;
    const beta = e.beta * rad;
    const gamma = e.gamma * rad;
    const gx = -Math.cos(beta) * Math.sin(gamma);
    const gy = -Math.sin(beta);

    const angle = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const sx = gx * cos + gy * sin;

    const degrees = Math.asin(Math.max(-1, Math.min(1, sx))) / rad;
    if (this.tiltNeutral === null) this.tiltNeutral = degrees;
    this.tiltDegrees = degrees - this.tiltNeutral;
    if (!this.tiltSeen) this.onTiltRecovered();
    this.tiltSeen = true;

    const magnitude = Math.abs(this.tiltDegrees);
    const usable = Math.max(0, magnitude - TILT_DEAD_DEGREES) / (TILT_FULL_DEGREES - TILT_DEAD_DEGREES);
    const steer = Math.min(1, usable) * Math.sign(this.tiltDegrees) * (TILT_INVERT ? -1 : 1);
    this.state.steer = steer;
    this.state.tilting = true;
  };


  /**
   * A reading arrived after the watchdog had already given up — iOS grants motion
   * access on its own schedule — so steering goes back to the device and the warning
   * goes away.
   */
  private onTiltRecovered(): void {
    if (!this.tiltBlocked) return;
    this.tiltBlocked = false;
    if (this.hint) {
      this.hint.textContent = 'tilt to steer · right half go · left half back · drag centre to look';
      this.hint.classList.remove('is-warning');
      window.setTimeout(() => this.hint?.classList.add('is-faded'), 4000);
    }
  }

  /** Forgets the neutral roll, so the next reading becomes straight-ahead. */
  recentreTilt = (): void => {
    this.tiltNeutral = null;
    this.state.steer = 0;
  };

  // ---------------------------------------------------------------------------
  // Overlay
  // ---------------------------------------------------------------------------

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
    row.appendChild(this.makeButton('spawn', 'car'));
    row.appendChild(this.makeButton('pause', 'menu'));
    overlay.appendChild(row);

    this.hint = document.createElement('div');
    this.hint.className = 'touch-hint';
    this.hint.textContent = 'tilt to steer · right half go · left half back · drag centre to look';
    overlay.appendChild(this.hint);
    // The hint has said its piece after a few seconds of play — unless it has been
    // replaced by the no-sensor warning, which stays.
    window.setTimeout(() => {
      if (!this.tiltBlocked) this.hint?.classList.add('is-faded');
    }, 6000);

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
        this.hooks.spawnVehicle();
        break;
      case 'pause':
        this.hooks.pause();
        break;
    }
  }

  /** Whether the device has ever reported an orientation, for diagnostics. */
  get tiltAvailable(): boolean {
    return this.tiltSeen;
  }
}
