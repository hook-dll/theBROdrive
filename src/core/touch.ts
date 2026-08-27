/**
 * Two-stick touch controls for phones and tablets.
 *
 * The left stick supplies movement on foot and throttle, brake and steering in a
 * vehicle. The right stick supplies a continuous look axis. Both are plain touch
 * controls, so they work without motion-sensor permission or HTTPS.
 */

/** Ignore small thumb motion around a stick's centre. */
const STICK_DEAD_ZONE = 0.12;
/** Camera rotation at full right-stick deflection, in radians per second. */
const LOOK_SPEED = 1.4;
/** Wheel-notch equivalent emitted per second at full zoom-fader deflection. */
const ZOOM_SPEED = 1.2;

/** Face buttons mirror the keyboard letters printed on them. */
type TouchButton =
  | 'interact'
  | 'mount'
  | 'camera'
  | 'recenter'
  | 'drop'
  | 'lights'
  | 'radioNext';

export interface TouchState {
  /** True once a touch has been seen and the overlay is live. */
  readonly active: boolean;
  /** Analogue forward command, 0..1. */
  readonly forward: number;
  /** Analogue brake/reverse command, 0..1. */
  readonly backward: number;
  /** Left-stick horizontal axis, -1..1. */
  readonly steer: number;
  /** True once touch controls own the steering axis. */
  readonly steeringActive: boolean;
  /** One-shot taps, cleared by `consumeTaps`. */
  interact: boolean;
  mount: boolean;
  camera: boolean;
  recenter: boolean;
  drop: boolean;
  lights: boolean;
  radioNext: boolean;
}

interface TouchHooks {
  /** Pause button: same overlay the Escape key opens. */
  readonly pause: () => void;
}

type StickKind = 'move' | 'look';

interface StickZone {
  readonly kind: StickKind;
  readonly knob: HTMLElement;
  readonly centreX: number;
  readonly centreY: number;
  readonly travel: number;
  x: number;
  y: number;
}

interface ButtonSpec {
  readonly id: TouchButton;
  readonly key: string;
  readonly label: string;
  readonly side: 'left' | 'right';
  readonly position: 'top' | 'lower-left' | 'lower-right' | 'bottom';
}

const BUTTONS: readonly ButtonSpec[] = [
  { id: 'drop', key: 'Q', label: 'Drop item', side: 'left', position: 'top' },
  { id: 'radioNext', key: 'T', label: 'Next radio station', side: 'left', position: 'lower-left' },
  { id: 'lights', key: 'L', label: 'Cycle headlights', side: 'left', position: 'lower-right' },
  { id: 'interact', key: 'E', label: 'Interact / enter / exit', side: 'right', position: 'top' },
  { id: 'mount', key: 'F', label: 'Pick up / mount', side: 'right', position: 'lower-left' },
  { id: 'camera', key: 'C', label: 'Cycle camera', side: 'right', position: 'lower-right' },
  { id: 'recenter', key: 'V', label: 'Recenter view', side: 'right', position: 'bottom' },
];

export class TouchControls {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly hooks: TouchHooks;

  private overlay: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private movePad: HTMLElement | null = null;
  private moveKnob: HTMLElement | null = null;
  private lookPad: HTMLElement | null = null;
  private lookKnob: HTMLElement | null = null;
  private fullscreenButton: HTMLButtonElement | null = null;
  private zoomFader: HTMLElement | null = null;
  private zoomThumb: HTMLElement | null = null;
  private zoomTouchId: number | null = null;
  private readonly zones = new Map<number, StickZone>();
  private lookX = 0;
  private lookY = 0;
  private zoomAxis = 0;

  private readonly state: TouchState & {
    active: boolean;
    forward: number;
    backward: number;
    steer: number;
    steeringActive: boolean;
    interact: boolean;
    mount: boolean;
    camera: boolean;
    recenter: boolean;
    drop: boolean;
    lights: boolean;
    radioNext: boolean;
  } = {
    active: false,
    forward: 0,
    backward: 0,
    steer: 0,
    steeringActive: false,
    interact: false,
    mount: false,
    camera: false,
    recenter: false,
    drop: false,
    lights: false,
    radioNext: false,
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

  /** Release all analogue touch axes when the tab returns. */
  private onVisibility = (): void => {
    if (document.visibilityState !== 'visible') return;
    this.releaseSticks();
    this.releaseZoomFader();
  };

  /** Converts the held right-stick direction into this simulation step's look delta. */
  consumeLook(dt: number): { yaw: number; pitch: number } {
    return {
      yaw: this.lookX * LOOK_SPEED * dt,
      pitch: -this.lookY * LOOK_SPEED * dt,
    };
  }

  /** Converts the held fader displacement into wheel-notch-equivalent zoom. */
  consumeZoom(dt: number): number {
    return this.zoomAxis * ZOOM_SPEED * dt;
  }

  /** Reads and clears the one-shot face-button taps. */
  consumeTaps(): {
    interact: boolean;
    mount: boolean;
    camera: boolean;
    recenter: boolean;
    drop: boolean;
    lights: boolean;
    radioNext: boolean;
  } {
    const taps = {
      interact: this.state.interact,
      mount: this.state.mount,
      camera: this.state.camera,
      recenter: this.state.recenter,
      drop: this.state.drop,
      lights: this.state.lights,
      radioNext: this.state.radioNext,
    };
    this.state.interact = false;
    this.state.mount = false;
    this.state.camera = false;
    this.state.recenter = false;
    this.state.drop = false;
    this.state.lights = false;
    this.state.radioNext = false;
    return taps;
  }

  // ---------------------------------------------------------------------------
  // Sticks
  // ---------------------------------------------------------------------------

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.activate();
    for (const touch of Array.from(e.changedTouches)) {
      const zone = this.zoneFor(touch);
      if (!zone) continue;
      this.zones.set(touch.identifier, zone);
      this.updateZone(zone, touch);
    }
    this.syncAxes();
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      const zone = this.zones.get(touch.identifier);
      if (zone) this.updateZone(zone, touch);
    }
    this.syncAxes();
  };

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      const zone = this.zones.get(touch.identifier);
      if (!zone) continue;
      this.resetKnob(zone);
      this.zones.delete(touch.identifier);
    }
    this.syncAxes();
  };

  /** Claims a stick only when the touch starts inside its visible circular base. */
  private zoneFor(touch: Touch): StickZone | null {
    const pads: readonly [StickKind, HTMLElement | null, HTMLElement | null][] = [
      ['move', this.movePad, this.moveKnob],
      ['look', this.lookPad, this.lookKnob],
    ];
    for (const [kind, pad, knob] of pads) {
      if (!pad || !knob || this.hasZone(kind)) continue;
      const rect = pad.getBoundingClientRect();
      const centreX = rect.left + rect.width / 2;
      const centreY = rect.top + rect.height / 2;
      const dx = touch.clientX - centreX;
      const dy = touch.clientY - centreY;
      const radius = Math.min(rect.width, rect.height) / 2;
      if (dx * dx + dy * dy > radius * radius) continue;
      return {
        kind,
        knob,
        centreX,
        centreY,
        travel: radius * 0.48,
        x: 0,
        y: 0,
      };
    }
    return null;
  }

  private hasZone(kind: StickKind): boolean {
    for (const zone of this.zones.values()) {
      if (zone.kind === kind) return true;
    }
    return false;
  }

  private updateZone(zone: StickZone, touch: Touch): void {
    const rawX = (touch.clientX - zone.centreX) / zone.travel;
    const rawY = (zone.centreY - touch.clientY) / zone.travel;
    const magnitude = Math.hypot(rawX, rawY);
    if (magnitude <= STICK_DEAD_ZONE) {
      zone.x = 0;
      zone.y = 0;
    } else {
      const clamped = Math.min(1, magnitude);
      const shaped = (clamped - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE);
      zone.x = (rawX / magnitude) * shaped;
      zone.y = (rawY / magnitude) * shaped;
    }
    zone.knob.style.transform =
      `translate(-50%, -50%) translate(${zone.x * zone.travel}px, ${-zone.y * zone.travel}px)`;
    zone.knob.parentElement?.classList.add('is-active');
  }

  private resetKnob(zone: StickZone): void {
    zone.knob.style.transform = '';
    zone.knob.parentElement?.classList.remove('is-active');
  }

  private releaseSticks(): void {
    for (const zone of this.zones.values()) this.resetKnob(zone);
    this.zones.clear();
    this.syncAxes();
  }

  private syncAxes(): void {
    let moveX = 0;
    let moveY = 0;
    let lookX = 0;
    let lookY = 0;
    for (const zone of this.zones.values()) {
      if (zone.kind === 'move') {
        moveX = zone.x;
        moveY = zone.y;
      } else {
        lookX = zone.x;
        lookY = zone.y;
      }
    }
    this.state.steer = moveX;
    this.state.forward = Math.max(0, moveY);
    this.state.backward = Math.max(0, -moveY);
    this.lookX = lookX;
    this.lookY = lookY;
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
      this.bindSystemButton(fullscreen, this.toggleFullscreen);
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

    const move = this.makeStick('move', 'MOVE / DRIVE');
    this.movePad = move.pad;
    this.moveKnob = move.knob;
    overlay.appendChild(move.pad);

    const look = this.makeStick('look', 'LOOK');
    this.lookPad = look.pad;
    this.lookKnob = look.knob;
    overlay.appendChild(look.pad);

    const zoomFader = this.makeZoomFader();
    this.zoomFader = zoomFader.fader;
    this.zoomThumb = zoomFader.thumb;
    overlay.appendChild(zoomFader.fader);

    this.hint = document.createElement('div');
    this.hint.className = 'touch-hint';
    this.hint.textContent = 'left stick: move / drive · right stick: look';
    overlay.appendChild(this.hint);
    window.setTimeout(() => this.hint?.classList.add('is-faded'), 5000);

    this.root.appendChild(overlay);
    this.overlay = overlay;
  }

  private makeStick(kind: StickKind, label: string): { pad: HTMLElement; knob: HTMLElement } {
    const pad = document.createElement('div');
    pad.className = `touch-stick touch-stick--${kind}`;
    pad.dataset.label = label;
    pad.setAttribute('aria-hidden', 'true');
    const knob = document.createElement('div');
    knob.className = 'touch-stick-knob';
    pad.appendChild(knob);
    return { pad, knob };
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
      `touch-btn touch-btn--${spec.position}${spec.id === 'interact' ? ' touch-btn--primary' : ''}`;
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
    this.state[id] = true;
  }

  private toggleFullscreen = (): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  };

  private onFullscreenChange = (): void => {
    const button = this.fullscreenButton;
    if (!button) return;
    const fullscreen = document.fullscreenElement !== null;
    button.textContent = '[ ]';
    button.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
    button.classList.toggle('is-fullscreen', fullscreen);
  };
}
