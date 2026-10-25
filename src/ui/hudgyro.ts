import { RIDE_EASY_MPS2, RIDE_HARSH_MPS2 } from '../trip/ride';

/**
 * THE GYRO ORB: the HUD's top right corner, the mana orb to the navigator's health orb.
 * A glass bowl with a steel ball in it: the ball is the push on whatever the car
 * carries, thrown up the glass when braking and to the right in a left bend, and the
 * rings on the glass are the ride's thresholds (trip/ride.ts) — calm inside,
 * uncomfortable between, harsh outside, where a harsh moment flashes the rim.
 *
 * Round the bowl's lower rim, the PEDALS as two thick arcs: the throttle up the right
 * side in the backlight's colour, its four lever notches ticked on it (core/pedallever.ts;
 * the notch the lever sits on marked outside it), and the brake up the left side in red,
 * full at the car's threshold pedal. They read what the car is given, whoever gives it:
 * keys, a pad, a touch screen or the autopilot.
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
const VIEW = 64;
/** The edge of the bowl is this push. */
const FULL_MPS2 = 5;
const BALL_R = 7.5;
/** The pedal arcs: their radius and width, and where they run (degrees, 0 = right, 90 = down). */
const ARC_R = 56;
const ARC_W = 8;
const THROTTLE_FROM = 80;
const THROTTLE_TO = -40;
const BRAKE_FROM = 100;
const BRAKE_TO = 165;
/** The throttle the arc is full at: the lever's top notch (four notches of 20 %). */
const THROTTLE_FULL = 0.8;
const LEVER_NOTCHES = 4;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

function polar(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** An arc path from `from` to `to` degrees at radius `r`, drawn in that direction. */
function arcPath(from: number, to: number, r: number): string {
  const [x0, y0] = polar(from, r);
  const [x1, y1] = polar(to, r);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export class GyroOrb {
  readonly el: HTMLElement;
  private readonly root: SVGSVGElement;
  private readonly ball: SVGGElement;
  private readonly pulse: SVGCircleElement;
  private readonly throttleFill: SVGPathElement;
  private readonly brakeFill: SVGPathElement;
  private readonly notchMark: SVGPathElement;
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
    const root = svg('svg', { viewBox: `${-VIEW} ${-VIEW} ${2 * VIEW} ${2 * VIEW}`, class: 'hud-gyro', role: 'img', 'aria-label': 'Ride and pedals' });
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

    // The pedal tracks and fills.
    root.append(svg('path', { d: arcPath(THROTTLE_FROM, THROTTLE_TO, ARC_R), class: 'hud-gyro-track', 'stroke-width': ARC_W }));
    root.append(svg('path', { d: arcPath(BRAKE_FROM, BRAKE_TO, ARC_R), class: 'hud-gyro-track', 'stroke-width': ARC_W }));
    this.throttleFill = svg('path', { d: arcPath(THROTTLE_FROM, THROTTLE_TO, ARC_R), class: 'hud-gyro-throttle', 'stroke-width': ARC_W, pathLength: 1, 'stroke-dasharray': '0 1' });
    this.brakeFill = svg('path', { d: arcPath(BRAKE_FROM, BRAKE_TO, ARC_R), class: 'hud-gyro-brake', 'stroke-width': ARC_W, pathLength: 1, 'stroke-dasharray': '0 1' });
    root.append(this.throttleFill, this.brakeFill);
    for (let i = 1; i < LEVER_NOTCHES; i++) {
      const deg = THROTTLE_FROM + ((THROTTLE_TO - THROTTLE_FROM) * i) / LEVER_NOTCHES;
      const [x0, y0] = polar(deg, ARC_R - ARC_W / 2);
      const [x1, y1] = polar(deg, ARC_R + ARC_W / 2);
      root.append(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'hud-gyro-tick' }));
    }
    this.notchMark = svg('path', { d: 'M 0 0 L 5 -3.5 L 5 3.5 Z', class: 'hud-gyro-notch' });
    root.append(this.notchMark);

    // The bowl: glass, zones, cross, the nose mark.
    root.append(svg('circle', { r: BOWL_R + 2.5, class: 'hud-gyro-bezel' }));
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
    this.el.append(root);
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

  /** The pedals as they are now, or null with nobody driving (both arcs empty). */
  setPedals(pedals: PedalReadout | null): void {
    const throttle = pedals === null ? 0 : Math.round(Math.min(1, Math.max(0, pedals.throttle / THROTTLE_FULL)) * 100) / 100;
    if (throttle !== this.throttleShown) {
      this.throttleShown = throttle;
      this.throttleFill.setAttribute('stroke-dasharray', `${throttle} 1`);
    }
    this.root.classList.toggle('is-kickdown', pedals !== null && pedals.throttle > 0.81);
    const brakeRaw = pedals === null ? 0 : pedals.knee > 0 ? pedals.brake / pedals.knee : 0;
    const brake = Math.round(Math.min(1, Math.max(0, brakeRaw)) * 100) / 100;
    if (brake !== this.brakeShown) {
      this.brakeShown = brake;
      this.brakeFill.setAttribute('stroke-dasharray', `${brake} 1`);
    }
    // Past the threshold pedal the wheels lock: the brake arc glows.
    this.root.classList.toggle('is-locking', brakeRaw > 1.02);
    const notch = pedals?.notch ?? null;
    if (notch !== this.notchShown) {
      this.notchShown = notch;
      this.notchMark.classList.toggle('is-hidden', notch === null);
      if (notch !== null) {
        const deg = THROTTLE_FROM + ((THROTTLE_TO - THROTTLE_FROM) * Math.max(0, notch)) / LEVER_NOTCHES;
        const [x, y] = polar(deg, ARC_R + ARC_W / 2 + 1.5);
        this.notchMark.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${deg.toFixed(1)})`);
      }
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
