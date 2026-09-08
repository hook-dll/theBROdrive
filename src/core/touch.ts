/**
 * Context-aware touch controls for phones and tablets.
 *
 * Pedals supply forward/backward movement in either mode. The left thumb gets a
 * steering wheel in a car and a camera-look joystick on foot; open canvas remains
 * an equivalent free-look surface. Face buttons mirror their printed keyboard keys.
 */

/** Ignore tiny wheel drags around its resting position. */
const WHEEL_DEAD_ZONE = 0.06;
/** Camera rotation per screen pixel dragged. */
const LOOK_RADIANS_PER_PIXEL = 0.0035;
/** Wheel-notch equivalent emitted per second at full zoom-fader deflection. */
const ZOOM_SPEED = 1.2;

type TouchButton =
  | 'useHeld'
  | 'interact'
  | 'camera'
  | 'recenter'
  | 'drop'
  | 'removeWearable'
  | 'lights'
  | 'autopilot'
  | 'handbrake'
  | 'cinema';

export interface TouchState {
  /** True once a touch has been seen and the overlay is live. */
  readonly active: boolean;
  /** Analogue forward command, 0..1. */
  readonly forward: number;
  /** Analogue brake/reverse command, 0..1. */
  readonly backward: number;
  /** Steering-wheel axis, -1..1. */
  readonly steer: number;
  /** True only while touch controls display and own the driving wheel. */
  readonly steeringActive: boolean;
  /** One-shot taps, cleared by `consumeTaps`. */
  interact: boolean;
  mount: boolean;
  useHeld: boolean;
  camera: boolean;
  recenter: boolean;
  drop: boolean;
  removeWearable: boolean;
  lights: boolean;
  autopilot: boolean;
  handbrake: boolean;
}

interface TouchHooks {
  /** Pause button: same overlay the Escape and Backquote keys open. */
  readonly pause: () => void;
  /** Fullscreen button: same in-page fullscreen mode as the plus key. */
  readonly fullscreen: () => void;
  /** Cinema viewport: same letterbox toggle as the minus key. */
  readonly cinema: () => void;
}

type DrivePedal = 'forward' | 'backward';
type TouchMode = 'foot' | 'drive';

interface ButtonSpec {
  readonly id: TouchButton;
  readonly key: string;
  readonly label: string;
  readonly mode: TouchMode;
  readonly side: 'left' | 'right';
  readonly position: 'top' | 'lower-left' | 'lower-right' | 'bottom';
}

const BUTTONS: readonly ButtonSpec[] = [
  { id: 'useHeld', key: 'E', label: 'Use held item', mode: 'foot', side: 'left', position: 'top' },
  { id: 'interact', key: 'F', label: 'Enter / exit vehicle', mode: 'foot', side: 'left', position: 'lower-left' },
  { id: 'drop', key: 'Q', label: 'Drop item', mode: 'foot', side: 'left', position: 'lower-right' },
  { id: 'removeWearable', key: 'G', label: 'Remove worn item', mode: 'foot', side: 'left', position: 'bottom' },
  { id: 'camera', key: 'C', label: 'Toggle hood / chase camera', mode: 'drive', side: 'left', position: 'top' },
  { id: 'recenter', key: 'V', label: 'Recenter view', mode: 'drive', side: 'left', position: 'lower-left' },
  { id: 'lights', key: 'L', label: 'Cycle headlights', mode: 'drive', side: 'left', position: 'lower-right' },
  { id: 'interact', key: 'F', label: 'Exit vehicle', mode: 'drive', side: 'right', position: 'top' },
  { id: 'autopilot', key: 'P', label: 'Cycle autopilot', mode: 'drive', side: 'right', position: 'lower-left' },
  { id: 'handbrake', key: 'SPACE', label: 'Toggle handbrake', mode: 'drive', side: 'right', position: 'lower-right' },
  { id: 'cinema', key: '-', label: 'Toggle cinema viewport', mode: 'drive', side: 'right', position: 'bottom' },
];

export class TouchControls {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly hooks: TouchHooks;

  private overlay: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private wheel: HTMLElement | null = null;
  private wheelRim: HTMLElement | null = null;
  private wheelTouchId: number | null = null;
  private wheelStartX = 0;
  private lookStick: HTMLElement | null = null;
  private lookStickThumb: HTMLElement | null = null;
  private lookStickTouchId: number | null = null;
  private lookStickStartX = 0;
  private lookStickStartY = 0;
  private lookStickLastX = 0;
  private lookStickLastY = 0;
  private forwardPedal: HTMLButtonElement | null = null;
  private backwardPedal: HTMLButtonElement | null = null;
  private forwardTouchId: number | null = null;
  private backwardTouchId: number | null = null;
  private fullscreenButton: HTMLButtonElement | null = null;
  private zoomFader: HTMLElement | null = null;
  private zoomThumb: HTMLElement | null = null;
  private zoomTouchId: number | null = null;
  private cameraDrag: { id: number; x: number; y: number } | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private zoomAxis = 0;
  private driving = false;
  private zoomAvailable = false;

  private readonly state: TouchState & {
    active: boolean;
    forward: number;
    backward: number;
    steer: number;
    steeringActive: boolean;
  } = {
    active: false,
    forward: 0,
    backward: 0,
    steer: 0,
    steeringActive: false,
    interact: false,
    mount: false,
    useHeld: false,
    camera: false,
    recenter: false,
    drop: false,
    removeWearable: false,
    lights: false,
    autopilot: false,
    handbrake: false,
  };

  constructor(root: HTMLElement, canvas: HTMLCanvasElement, hooks: TouchHooks) {
    this.root = root;
    this.canvas = canvas;
    this.hooks = hooks;
    // Passive: false, because a drag on the canvas must not also scroll or zoom.
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
  }

  dispose(): void {
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.onTouchEnd);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.overlay?.remove();
    this.overlay = null;
  }

  /** The live state. Mutated in place; never retained by consumers across ticks. */
  get input(): TouchState {
    return this.state;
  }

  /** Switches the visible controls without rebuilding the overlay or its listeners. */
  setDriving(driving: boolean): void {
    if (driving === this.driving) return;
    this.driving = driving;
    this.releaseDriveControls();
    this.releaseLookStick();
    this.state.steeringActive = this.state.active && driving;
    this.overlay?.classList.toggle('is-driving', driving);
    this.overlay?.classList.toggle('has-zoom', driving && this.zoomAvailable);
    if (!driving) this.releaseZoomFader();
    this.updateHint();
  }

  /** The distance fader belongs exclusively to the external driving camera. */
  setZoomAvailable(available: boolean): void {
    if (available === this.zoomAvailable) return;
    this.zoomAvailable = available;
    const visible = this.driving && available;
    this.overlay?.classList.toggle('has-zoom', visible);
    if (!visible) this.releaseZoomFader();
  }

  /** Release all analogue touch axes when the tab returns. */
  private onVisibility = (): void => {
    if (document.visibilityState !== 'visible') return;
    this.releaseDriveControls();
    this.releaseCameraDrag();
    this.releaseLookStick();
    this.releaseZoomFader();
  };

  /** Reads and clears camera rotation accumulated by free screen dragging. */
  consumeLook(): { yaw: number; pitch: number } {
    const look = { yaw: this.lookYaw, pitch: this.lookPitch };
    this.lookYaw = 0;
    this.lookPitch = 0;
    return look;
  }

  /** Converts the held fader displacement into wheel-notch-equivalent zoom. */
  consumeZoom(dt: number): number {
    return this.zoomAxis * ZOOM_SPEED * dt;
  }

  /** Reads and clears the one-shot face-button taps. */
  consumeTaps(): {
    interact: boolean;
    mount: boolean;
    useHeld: boolean;
    camera: boolean;
    recenter: boolean;
    drop: boolean;
    removeWearable: boolean;
    lights: boolean;
    autopilot: boolean;
    handbrake: boolean;
  } {
    const taps = {
      interact: this.state.interact,
      mount: this.state.mount,
      useHeld: this.state.useHeld,
      camera: this.state.camera,
      recenter: this.state.recenter,
      drop: this.state.drop,
      removeWearable: this.state.removeWearable,
      lights: this.state.lights,
      autopilot: this.state.autopilot,
      handbrake: this.state.handbrake,
    };
    this.state.interact = false;
    this.state.mount = false;
    this.state.useHeld = false;
    this.state.camera = false;
    this.state.recenter = false;
    this.state.drop = false;
    this.state.removeWearable = false;
    this.state.lights = false;
    this.state.autopilot = false;
    this.state.handbrake = false;
    return taps;
  }

  // ---------------------------------------------------------------------------
  // Wheel, pedals and camera drag
  // ---------------------------------------------------------------------------

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.activate();
    const touch = e.changedTouches.item(0);
    if (touch && !this.cameraDrag) {
      this.cameraDrag = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier !== this.cameraDrag?.id) continue;
      this.lookYaw += (touch.clientX - this.cameraDrag.x) * LOOK_RADIANS_PER_PIXEL;
      this.lookPitch -= (touch.clientY - this.cameraDrag.y) * LOOK_RADIANS_PER_PIXEL;
      this.cameraDrag.x = touch.clientX;
      this.cameraDrag.y = touch.clientY;
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === this.cameraDrag?.id) this.cameraDrag = null;
    }
  };

  private bindWheel(control: HTMLElement, rim: HTMLElement): void {
    control.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.wheelTouchId !== null) return;
        const touch = e.changedTouches.item(0);
        if (!touch) return;
        this.wheelTouchId = touch.identifier;
        this.wheelStartX = touch.clientX;
        control.classList.add('is-active');
      },
      { passive: false },
    );
    control.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const touch = this.touchWithId(e.changedTouches, this.wheelTouchId);
        if (!touch) return;
        const travel = Math.max(1, control.getBoundingClientRect().width * 0.42);
        const raw = Math.max(-1, Math.min(1, (touch.clientX - this.wheelStartX) / travel));
        const magnitude = Math.abs(raw);
        this.state.steer =
          magnitude <= WHEEL_DEAD_ZONE
            ? 0
            : Math.sign(raw) * ((magnitude - WHEEL_DEAD_ZONE) / (1 - WHEEL_DEAD_ZONE));
        rim.style.transform = `rotate(${this.state.steer * 110}deg)`;
      },
      { passive: false },
    );
    const release = (e: TouchEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.touchWithId(e.changedTouches, this.wheelTouchId)) return;
      this.releaseWheel();
    };
    control.addEventListener('touchend', release, { passive: false });
    control.addEventListener('touchcancel', release, { passive: false });
  }

  private bindLookStick(control: HTMLElement, thumb: HTMLElement): void {
    control.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.lookStickTouchId !== null) return;
        const touch = e.changedTouches.item(0);
        if (!touch) return;
        this.lookStickTouchId = touch.identifier;
        this.lookStickStartX = this.lookStickLastX = touch.clientX;
        this.lookStickStartY = this.lookStickLastY = touch.clientY;
        control.classList.add('is-active');
      },
      { passive: false },
    );
    control.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const touch = this.touchWithId(e.changedTouches, this.lookStickTouchId);
        if (!touch) return;
        this.lookYaw += (touch.clientX - this.lookStickLastX) * LOOK_RADIANS_PER_PIXEL;
        this.lookPitch -= (touch.clientY - this.lookStickLastY) * LOOK_RADIANS_PER_PIXEL;
        this.lookStickLastX = touch.clientX;
        this.lookStickLastY = touch.clientY;
        const radius = Math.max(1, control.getBoundingClientRect().width * 0.31);
        const dx = touch.clientX - this.lookStickStartX;
        const dy = touch.clientY - this.lookStickStartY;
        const distance = Math.hypot(dx, dy);
        const scale = distance > radius ? radius / distance : 1;
        thumb.style.transform =
          `translate(-50%, -50%) translate(${dx * scale}px, ${dy * scale}px)`;
      },
      { passive: false },
    );
    const release = (e: TouchEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.touchWithId(e.changedTouches, this.lookStickTouchId)) return;
      this.releaseLookStick();
    };
    control.addEventListener('touchend', release, { passive: false });
    control.addEventListener('touchcancel', release, { passive: false });
  }

  private bindPedal(button: HTMLButtonElement, pedal: DrivePedal): void {
    button.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.pedalTouchId(pedal) !== null) return;
        const touch = e.changedTouches.item(0);
        if (!touch) return;
        this.setPedalTouchId(pedal, touch.identifier);
        this.state[pedal] = 1;
        button.classList.add('is-down');
      },
      { passive: false },
    );
    const release = (e: TouchEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.touchWithId(e.changedTouches, this.pedalTouchId(pedal))) return;
      this.setPedalTouchId(pedal, null);
      this.state[pedal] = 0;
      button.classList.remove('is-down');
    };
    button.addEventListener('touchend', release, { passive: false });
    button.addEventListener('touchcancel', release, { passive: false });
  }

  private touchWithId(touches: TouchList, id: number | null): Touch | null {
    if (id === null) return null;
    for (const touch of Array.from(touches)) {
      if (touch.identifier === id) return touch;
    }
    return null;
  }

  private pedalTouchId(pedal: DrivePedal): number | null {
    return pedal === 'forward' ? this.forwardTouchId : this.backwardTouchId;
  }

  private setPedalTouchId(pedal: DrivePedal, id: number | null): void {
    if (pedal === 'forward') this.forwardTouchId = id;
    else this.backwardTouchId = id;
  }

  private releaseWheel(): void {
    this.wheelTouchId = null;
    this.state.steer = 0;
    this.wheel?.classList.remove('is-active');
    this.wheelRim?.style.removeProperty('transform');
  }

  private releaseLookStick(): void {
    this.lookStickTouchId = null;
    this.lookStick?.classList.remove('is-active');
    this.lookStickThumb?.style.removeProperty('transform');
  }

  private releaseDriveControls(): void {
    this.releaseWheel();
    this.forwardTouchId = null;
    this.backwardTouchId = null;
    this.state.forward = 0;
    this.state.backward = 0;
    this.forwardPedal?.classList.remove('is-down');
    this.backwardPedal?.classList.remove('is-down');
  }

  private releaseCameraDrag(): void {
    this.cameraDrag = null;
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  // ---------------------------------------------------------------------------
  // Overlay
  // ---------------------------------------------------------------------------

  private activate(): void {
    if (this.state.active) return;
    this.state.active = true;
    this.state.steeringActive = this.driving;
    this.buildOverlay();
  }

  private buildOverlay(): void {
    if (this.overlay) return;
    const overlay = document.createElement('div');
    overlay.className =
      `touch-ui${this.driving ? ' is-driving' : ''}` +
      `${this.driving && this.zoomAvailable ? ' has-zoom' : ''}`;

    const systems = document.createElement('div');
    systems.className = 'touch-system-row';
    const pause = document.createElement('button');
    pause.className = 'touch-system-btn';
    pause.type = 'button';
    pause.textContent = 'MENU';
    pause.setAttribute('aria-label', 'Pause menu');
    this.bindSystemButton(pause, this.hooks.pause);
    systems.appendChild(pause);

    if (
      document.fullscreenEnabled &&
      typeof document.documentElement.requestFullscreen === 'function'
    ) {
      const fullscreen = document.createElement('button');
      fullscreen.className = 'touch-system-btn touch-system-btn--fullscreen';
      fullscreen.type = 'button';
      fullscreen.textContent = '[ ]';
      fullscreen.setAttribute('aria-label', 'Enter fullscreen');
      this.bindSystemButton(fullscreen, this.hooks.fullscreen);
      systems.appendChild(fullscreen);
      this.fullscreenButton = fullscreen;
    }
    overlay.appendChild(systems);

    const leftButtons = document.createElement('div');
    leftButtons.className = 'touch-buttons touch-buttons--left';
    const rightButtons = document.createElement('div');
    rightButtons.className = 'touch-buttons touch-buttons--right';
    for (const spec of BUTTONS) {
      const cluster = spec.side === 'left' ? leftButtons : rightButtons;
      cluster.appendChild(this.makeButton(spec));
    }
    overlay.appendChild(leftButtons);
    overlay.appendChild(rightButtons);

    const wheel = this.makeWheel();
    this.wheel = wheel.control;
    this.wheelRim = wheel.rim;
    overlay.appendChild(wheel.control);

    const lookStick = this.makeLookStick();
    this.lookStick = lookStick.control;
    this.lookStickThumb = lookStick.thumb;
    overlay.appendChild(lookStick.control);

    const pedals = document.createElement('div');
    pedals.className = 'touch-pedals';
    this.backwardPedal = this.makePedal('backward', 'BACK / REV', '▼');
    this.forwardPedal = this.makePedal('forward', 'FORWARD', '▲');
    pedals.append(this.backwardPedal, this.forwardPedal);
    overlay.appendChild(pedals);

    const zoomFader = this.makeZoomFader();
    this.zoomFader = zoomFader.fader;
    this.zoomThumb = zoomFader.thumb;
    overlay.appendChild(zoomFader.fader);

    this.hint = document.createElement('div');
    this.hint.className = 'touch-hint';
    overlay.appendChild(this.hint);
    this.updateHint();
    window.setTimeout(() => this.hint?.classList.add('is-faded'), 5000);

    this.root.appendChild(overlay);
    this.overlay = overlay;
  }

  private makeWheel(): { control: HTMLElement; rim: HTMLElement } {
    const control = document.createElement('div');
    control.className = 'touch-wheel';
    control.setAttribute('aria-label', 'Steering wheel');
    const rim = document.createElement('div');
    rim.className = 'touch-wheel-rim';
    rim.innerHTML =
      '<span class="touch-wheel-spoke touch-wheel-spoke--left"></span>' +
      '<span class="touch-wheel-spoke touch-wheel-spoke--right"></span>' +
      '<span class="touch-wheel-spoke touch-wheel-spoke--bottom"></span>' +
      '<span class="touch-wheel-hub"></span>';
    control.appendChild(rim);
    this.bindWheel(control, rim);
    return { control, rim };
  }

  private makeLookStick(): { control: HTMLElement; thumb: HTMLElement } {
    const control = document.createElement('div');
    control.className = 'touch-look-stick';
    control.setAttribute('aria-label', 'Camera look joystick');
    const thumb = document.createElement('div');
    thumb.className = 'touch-look-stick-thumb';
    control.appendChild(thumb);
    this.bindLookStick(control, thumb);
    return { control, thumb };
  }

  private makePedal(pedal: DrivePedal, label: string, glyph: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `touch-pedal touch-pedal--${pedal}`;
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.innerHTML = `<span class="touch-pedal-glyph">${glyph}</span><span>${label}</span>`;
    this.bindPedal(button, pedal);
    return button;
  }

  private makeZoomFader(): { fader: HTMLElement; thumb: HTMLElement } {
    const fader = document.createElement('div');
    fader.className = 'touch-zoom-fader';
    fader.setAttribute('aria-label', 'Chase camera zoom');
    const thumb = document.createElement('div');
    thumb.className = 'touch-zoom-thumb';
    fader.appendChild(thumb);

    fader.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.zoomTouchId !== null) return;
        const touch = e.changedTouches.item(0);
        if (!touch) return;
        this.zoomTouchId = touch.identifier;
        fader.classList.add('is-active');
        this.updateZoomFader(touch);
      },
      { passive: false },
    );
    fader.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const touch = this.zoomTouch(e.changedTouches);
        if (touch) this.updateZoomFader(touch);
      },
      { passive: false },
    );
    const release = (e: TouchEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (this.zoomTouch(e.changedTouches)) this.releaseZoomFader();
    };
    fader.addEventListener('touchend', release, { passive: false });
    fader.addEventListener('touchcancel', release, { passive: false });
    return { fader, thumb };
  }

  private zoomTouch(touches: TouchList): Touch | null {
    const id = this.zoomTouchId;
    if (id === null) return null;
    for (const touch of Array.from(touches)) {
      if (touch.identifier === id) return touch;
    }
    return null;
  }

  private updateZoomFader(touch: Touch): void {
    const fader = this.zoomFader;
    const thumb = this.zoomThumb;
    if (!fader || !thumb) return;
    const rect = fader.getBoundingClientRect();
    const travel = Math.max(1, (rect.height - thumb.getBoundingClientRect().height) / 2);
    const raw = (rect.top + rect.height / 2 - touch.clientY) / travel;
    this.zoomAxis = Math.max(-1, Math.min(1, raw));
    thumb.style.transform =
      `translate(-50%, -50%) translateY(${-this.zoomAxis * travel}px)`;
  }

  private releaseZoomFader(): void {
    this.zoomTouchId = null;
    this.zoomAxis = 0;
    this.zoomThumb?.style.removeProperty('transform');
    this.zoomFader?.classList.remove('is-active');
  }

  private makeButton(spec: ButtonSpec): HTMLButtonElement {
    const button = document.createElement('button');
    button.className =
      `touch-btn touch-btn--${spec.position} touch-btn--${spec.mode}` +
      `${spec.id === 'interact' ? ' touch-btn--primary' : ''}` +
      `${spec.key.length > 1 ? ' touch-btn--wide-label' : ''}`;
    button.textContent = spec.key;
    button.type = 'button';
    button.setAttribute('aria-label', spec.label);
    button.title = spec.label;
    button.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.press(spec.id);
        button.classList.add('is-down');
      },
      { passive: false },
    );
    const release = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      button.classList.remove('is-down');
    };
    button.addEventListener('touchend', release, { passive: false });
    button.addEventListener('touchcancel', release, { passive: false });
    return button;
  }

  private bindSystemButton(button: HTMLButtonElement, action: () => void): void {
    button.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        button.classList.add('is-down');
        action();
      },
      { passive: false },
    );
    const release = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      button.classList.remove('is-down');
    };
    button.addEventListener('touchend', release, { passive: false });
    button.addEventListener('touchcancel', release, { passive: false });
  }

  private press(id: TouchButton): void {
    if (id === 'cinema') {
      this.hooks.cinema();
      return;
    }
    this.state[id] = true;
    // Keyboard F owns both physical interaction paths. Mirroring both preserves its
    // context-sensitive enter/exit versus pick-up/mount behavior on touch.
    if (id === 'interact') this.state.mount = true;
  }

  private updateHint(): void {
    if (!this.hint) return;
    this.hint.textContent = this.driving
      ? 'wheel: steer · pedals: forward / back · drag screen: look'
      : 'joystick / drag screen: look · pedals: forward / back';
  }


  private onFullscreenChange = (): void => {
    const button = this.fullscreenButton;
    if (!button) return;
    const fullscreen = document.fullscreenElement !== null;
    button.textContent = '[ ]';
    button.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
    button.classList.toggle('is-fullscreen', fullscreen);
  };
}
