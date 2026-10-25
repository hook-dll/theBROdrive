import { RIDE_EASY_MPS2, RIDE_HARSH_MPS2 } from '../trip/ride';
import { LEVER_MAX, THROTTLE_NOTCHES } from '../core/pedallever';

/**
 * THE GYRO ORB: the HUD's top right corner, the mana orb to the navigator's health orb.
 * A glass bowl with a steel ball in it: the ball is the push on whatever the car
 * carries, thrown up the glass when braking and to the right in a left bend, and the
 * rings on the glass are the ride's thresholds (trip/ride.ts) — calm inside,
 * uncomfortable between, harsh outside, where a harsh moment flashes the rim. Faint
 * glass over the world, not a thing in front of it (hud.css `.hud-orb--gyro`).
 *
 * Beside the bowl, the PEDAL LEVER SCALE: six sections stacked, the four throttle
 * notches over neutral over the brake (core/pedallever.ts). A frame marks the notch the
 * lever is on while the keys drive; the throttle fills up from neutral and the brake
 * down from it, as the car is given them by whoever drives — keys, a pad, a touch
 * screen or the autopilot.
 */

/** A pedal readout: the car's demands now and its threshold brake pedal; the lever's notch when it drives. */
export interface PedalReadout {
  readonly throttle: number;
  readonly brake: number;
  readonly knee: number;
  readonly notch: number | null;
}

/** The ride: smoothed acceleration in the car's frame, m/s², and the harsh moments counted so far. */
export interface RideReadout {
  /** Along the nose: positive speeding up, negative braking. */
  readonly longitudinal: number;
  /** Across the car: positive towards its left. */
  readonly lateral: number;
  readonly harshMoments: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The bowl's radius in the orb's own units (the viewBox is ±`VIEW`). */
const BOWL_R = 48;
const VIEW = 51;
/** The edge of the bowl is this push. */
const FULL_MPS2 = 5;
const BALL_R = 7.5;

/** The lever scale: `LEVER_CELL` per section, the throttle notches over neutral over the brake. */
const LEVER_W = 12;
const LEVER_CELL = 9;
const LEVER_H = (LEVER_MAX + 2) * LEVER_CELL;
/** The top of the neutral cell and its foot: the throttle fills up, the brake down. */
const LEVER_NEUTRAL_TOP = LEVER_MAX * LEVER_CELL;
const LEVER_NEUTRAL_FOOT = LEVER_NEUTRAL_TOP + LEVER_CELL;
/** The throttle one notch is worth. */
const NOTCH_STEP = THROTTLE_NOTCHES[0];

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

export class GyroOrb {
  readonly el: HTMLElement;
  private readonly root: SVGSVGElement;
  private readonly ball: SVGGElement;
  private readonly pulse: SVGCircleElement;
  /** The pedal lever scale: the svg, the notch frame, the fills. */
  private readonly lever: SVGSVGElement;
  private readonly leverNotch: SVGRectElement;
  private readonly leverThrottle: SVGRectElement;
  private readonly leverBrake: SVGRectElement;
  private rideShown = false;
  private ballX = Number.NaN;
  private ballY = Number.NaN;
  private zone = -1;
  private harshSeen = 0;
  private throttleShown = -1;
  private brakeShown = -1;
  private notchShown: number | null | undefined = undefined;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hud-orb hud-orb--gyro';
    const root = svg('svg', { viewBox: `${-VIEW} ${-VIEW} ${2 * VIEW} ${2 * VIEW}`, class: 'hud-gyro', role: 'img', 'aria-label': 'Ride' });
    this.root = root;

    // Glass, ball shading and the highlight, as gradients.
    const defs = svg('defs');
    const glass = svg('radialGradient', { id: 'hud-gyro-glass', cx: '50%', cy: '42%', r: '60%' });
    glass.append(svg('stop', { offset: '0', class: 'hud-gyro-glass-in' }), svg('stop', { offset: '1', class: 'hud-gyro-glass-out' }));
    const steel = svg('radialGradient', { id: 'hud-gyro-steel', cx: '35%', cy: '30%', r: '75%' });
    steel.append(
      svg('stop', { offset: '0', 'stop-color': '#ffffff' }),
      svg('stop', { offset: '0.35', 'stop-color': '#d9dde0' }),
      svg('stop', { offset: '0.8', 'stop-color': '#6f777c' }),
      svg('stop', { offset: '1', 'stop-color': '#30363a' }),
    );
    const shine = svg('radialGradient', { id: 'hud-gyro-shine', cx: '38%', cy: '22%', r: '55%' });
    shine.append(svg('stop', { offset: '0', 'stop-color': '#ffffff', 'stop-opacity': '0.32' }), svg('stop', { offset: '1', 'stop-color': '#ffffff', 'stop-opacity': '0' }));
    defs.append(glass, steel, shine);
    root.append(defs);

    // The bowl: glass, zones, cross, the nose mark.
    root.append(svg('circle', { r: BOWL_R + 1, class: 'hud-gyro-bezel' }));
    root.append(svg('circle', { r: BOWL_R, fill: 'url(#hud-gyro-glass)' }));
    root.append(svg('circle', { r: BOWL_R, class: 'hud-gyro-zone is-harsh' }));
    root.append(svg('circle', { r: (RIDE_HARSH_MPS2 / FULL_MPS2) * BOWL_R, class: 'hud-gyro-zone is-uncomfortable' }));
    root.append(svg('circle', { r: (RIDE_EASY_MPS2 / FULL_MPS2) * BOWL_R, class: 'hud-gyro-zone is-calm' }));
    root.append(svg('line', { x1: -BOWL_R, y1: 0, x2: BOWL_R, y2: 0, class: 'hud-gyro-cross' }));
    root.append(svg('line', { x1: 0, y1: -BOWL_R, x2: 0, y2: BOWL_R, class: 'hud-gyro-cross' }));
    root.append(svg('path', { d: `M 0 ${-BOWL_R + 1} L 4 ${-BOWL_R + 8} H -4 Z`, class: 'hud-gyro-nose' }));
    this.pulse = svg('circle', { r: BOWL_R, class: 'hud-gyro-pulse' });
    root.append(this.pulse);

    // The ball, its shadow on the glass under it, and the glass's shine over everything.
    this.ball = svg('g', { class: 'hud-gyro-ball' });
    this.ball.append(svg('ellipse', { cx: 1.5, cy: 3, rx: BALL_R, ry: BALL_R * 0.8, class: 'hud-gyro-ball-shadow' }));
    this.ball.append(svg('circle', { r: BALL_R, fill: 'url(#hud-gyro-steel)', class: 'hud-gyro-ball-steel' }));
    root.append(this.ball);
    root.append(svg('ellipse', { cx: -6, cy: -22, rx: 34, ry: 22, fill: 'url(#hud-gyro-shine)', 'pointer-events': 'none' }));

    // The lever scale: fills under the cell ticks, the notch frame over them.
    const lever = svg('svg', { viewBox: `0 0 ${LEVER_W} ${LEVER_H}`, class: 'hud-lever', role: 'img', 'aria-label': 'Pedals' });
    this.lever = lever;
    const rect = (cls: string, y: number, h: number): SVGRectElement => {
      const r = svg('rect', { class: cls, x: 2, y, width: LEVER_W - 4, height: h });
      lever.append(r);
      return r;
    };
    this.leverThrottle = rect('hud-lever-throttle', LEVER_NEUTRAL_TOP, 0);
    this.leverBrake = rect('hud-lever-brake', LEVER_NEUTRAL_FOOT, 0);
    for (let i = 1; i < LEVER_H / LEVER_CELL; i++) {
      const neutral = i === LEVER_MAX || i === LEVER_MAX + 1;
      lever.append(svg('line', { class: neutral ? 'hud-lever-tick is-neutral' : 'hud-lever-tick', x1: 0, x2: LEVER_W, y1: i * LEVER_CELL, y2: i * LEVER_CELL }));
    }
    this.leverNotch = rect('hud-lever-notch', LEVER_NEUTRAL_TOP, LEVER_CELL);
    this.leverNotch.setAttribute('x', '0.75');
    this.leverNotch.setAttribute('width', String(LEVER_W - 1.5));

    this.el.append(root, lever);
    this.placeBall(0, 0);
  }

  /** The ride of the car the player drives, or null for a still bowl (the ball at the bottom). */
  setRide(ride: RideReadout | null): void {
    if (ride === null) {
      this.rideShown = false;
      this.placeBall(0, 0);
      this.setZone(0);
      return;
    }
    if (!this.rideShown) {
      this.rideShown = true;
      // What happened before the readings started is not news.
      this.harshSeen = ride.harshMoments;
    }
    // The push is opposite the acceleration: braking throws the load forward (up the
    // glass), a left bend throws it right.
    const scale = BOWL_R / FULL_MPS2;
    let x = ride.lateral * scale;
    let y = ride.longitudinal * scale;
    const reach = Math.hypot(x, y);
    const max = BOWL_R - BALL_R;
    if (reach > max) {
      x *= max / reach;
      y *= max / reach;
    }
    this.placeBall(Math.round(x * 4) / 4, Math.round(y * 4) / 4);
    const magnitude = Math.hypot(ride.longitudinal, ride.lateral);
    this.setZone(magnitude > RIDE_HARSH_MPS2 ? 2 : magnitude > RIDE_EASY_MPS2 ? 1 : 0);
    if (ride.harshMoments > this.harshSeen) {
      this.harshSeen = ride.harshMoments;
      this.pulse.animate(
        [
          { opacity: 0.95, transform: 'scale(0.8)' },
          { opacity: 0, transform: 'scale(1.12)' },
        ],
        { duration: 650, easing: 'ease-out' },
      );
    }
  }

  /** The pedals as they are now, or null with nobody driving (both fills empty). */
  setPedals(pedals: PedalReadout | null): void {
    // The throttle notches are a cell each; past the top one the fill is full and lit
    // as a kickdown.
    const up = pedals === null ? 0 : Math.round(Math.min(LEVER_NEUTRAL_TOP, (pedals.throttle / NOTCH_STEP) * LEVER_CELL) * 10) / 10;
    if (up !== this.throttleShown) {
      this.throttleShown = up;
      this.leverThrottle.setAttribute('y', String(LEVER_NEUTRAL_TOP - up));
      this.leverThrottle.setAttribute('height', String(up));
    }
    this.lever.classList.toggle('is-kickdown', pedals !== null && pedals.throttle > THROTTLE_NOTCHES[LEVER_MAX - 1] + 0.01);
    // The brake at the car's threshold pedal fills its cell; past it the wheels lock.
    const brakeRaw = pedals === null ? 0 : pedals.knee > 0 ? pedals.brake / pedals.knee : 0;
    const down = Math.round(Math.min(1, Math.max(0, brakeRaw)) * LEVER_CELL * 10) / 10;
    if (down !== this.brakeShown) {
      this.brakeShown = down;
      this.leverBrake.setAttribute('height', String(down));
    }
    this.lever.classList.toggle('is-locking', brakeRaw > 1.02);
    // Notch n sits n cells above neutral, the brake (−1) below it.
    const notch = pedals?.notch ?? null;
    if (notch !== this.notchShown) {
      this.notchShown = notch;
      this.leverNotch.classList.toggle('is-hidden', notch === null);
      if (notch !== null) this.leverNotch.setAttribute('y', String(LEVER_NEUTRAL_TOP - notch * LEVER_CELL));
    }
  }

  private placeBall(x: number, y: number): void {
    if (x === this.ballX && y === this.ballY) return;
    this.ballX = x;
    this.ballY = y;
    this.ball.setAttribute('transform', `translate(${x} ${y})`);
  }

  private setZone(zone: number): void {
    if (zone === this.zone) return;
    this.zone = zone;
    this.root.classList.toggle('is-uncomfortable', zone === 1);
    this.root.classList.toggle('is-harsh', zone === 2);
  }
}
