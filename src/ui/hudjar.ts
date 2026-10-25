import { balls } from '../economy/money';
import { ballSprite, type BallKind } from './balls';

/**
 * THE MONEY JAR: the player's calcite balls (economy/money.ts) in a glass jar drawn in
 * section beside the segment display, as the purse in Kingdom Two Crowns. Money coming
 * in is poured through the neck a ball at a time and the balls roll and settle on each
 * other; money going out jumps out of the neck and is gone. Ten small balls becoming a
 * middle one is the ten jumping out and the middle one dropping in.
 *
 * The balls are a small 2D simulation — gravity, the jar's walls, the balls on each
 * other — stepped at `STEP_S` while anything moves and asleep (no frames drawn) once
 * everything has settled.
 */

/** Ball diameters in the jar, em (hud.css `#ui` sets the em). */
const DIAMETER: Readonly<Record<BallKind, number>> = { big: 1.3, middle: 1.0, small: 0.72 };
/** Big balls past this many are a "+N" on the glass rather than balls. */
const MAX_BIG = 15;

/** The jar, em: its outside size, and the canvas margin round it the balls jump into. */
const JAR_W = 9.4;
const JAR_H = 8;
const MARGIN_X = 2.4;
const MARGIN_TOP = 1.8;
const MARGIN_BOTTOM = 1.6;
const CANVAS_W = JAR_W + 2 * MARGIN_X;
const CANVAS_H = JAR_H + MARGIN_TOP + MARGIN_BOTTOM;
/** The glass's thickness, em: the balls roll on its inner face. */
const WALL = 0.14;
/** The mouth's half width and the neck's depth; the shoulders; the bottom corners' radius. */
const MOUTH_HALF = 2;
const NECK_H = 0.6;
const SHOULDER_H = 1.7;
const CORNER_R = 0.9;

const STEP_S = 1 / 120;
const GRAVITY = 42;
const WALL_BOUNCE = 0.25;
const BALL_BOUNCE = 0.15;
const FRICTION = 0.9;
/** Asleep once every ball has been slower than this, em/s, for `SLEEP_S`. */
const REST_SPEED = 0.35;
const SLEEP_S = 0.4;
/** Pouring: one ball per `POUR_MS`; a ball out per `SPEND_MS`; a pour waits `SWAP_MS` after balls out. */
const POUR_MS = 70;
const SPEND_MS = 35;
const SWAP_MS = 260;
/** A ball leaving: the height over the mouth its leap tops out at, em; then its throw aside, em/s; how long it fades. */
const LEAP_OVER = 1.2;
const LEAP_SIDE = 5;
const FADE_S = 0.35;

interface Ball {
  readonly kind: BallKind;
  readonly r: number;
  readonly mass: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since it left the jar, or -1 while it is in; then seconds since its leap topped out, or -1 before. */
  leftS: number;
  fallS: number;
}

/** The jar's inner face as a polyline, em in canvas space: the left wall down, the floor, the right wall up. */
function jarWall(): number[] {
  const out: number[] = [];
  const x0 = MARGIN_X;
  const y0 = MARGIN_TOP;
  const cx = x0 + JAR_W / 2;
  const left = x0 + WALL / 2;
  const floor = y0 + JAR_H - WALL / 2;
  const side: number[] = [];
  // The neck, the shoulder as a quadratic curve, the wall, the bottom corner as an arc.
  side.push(cx - MOUTH_HALF, y0, cx - MOUTH_HALF, y0 + NECK_H);
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    const ax = cx - MOUTH_HALF;
    const ay = y0 + NECK_H;
    const bx = left;
    const by = y0 + NECK_H;
    const ex = left;
    const ey = y0 + SHOULDER_H;
    side.push((1 - t) * (1 - t) * ax + 2 * (1 - t) * t * bx + t * t * ex, (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * by + t * t * ey);
  }
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI - (i / 8) * (Math.PI / 2);
    side.push(left + CORNER_R + Math.cos(a) * CORNER_R, floor - CORNER_R + Math.sin(a) * CORNER_R);
  }
  out.push(...side);
  // The right side is the left mirrored, walked back up.
  for (let i = side.length - 2; i >= 0; i -= 2) out.push(2 * cx - side[i]!, side[i + 1]!);
  return out;
}

const WALL_LINE = jarWall();

function el(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

export class MoneyJar {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly observer: ResizeObserver | null = null;
  /** Canvas pixels per em. */
  private unit = 0;
  private readonly balls: Ball[] = [];
  /** Balls waiting to be poured in, and balls of a kind to take out, in order. */
  private readonly pours: BallKind[] = [];
  private readonly spends: BallKind[] = [];
  private nextActionMs = 0;
  private restS = 0;
  private frame = 0;
  private lastMs = 0;
  private accS = 0;
  private overflow = 0;
  private rubles = -1;

  constructor() {
    this.el = el('div', 'hud-jar');
    this.el.style.width = `${CANVAS_W}em`;
    this.el.style.height = `${CANVAS_H}em`;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-jar-canvas';
    this.g = this.canvas.getContext('2d');
    this.el.append(this.canvas);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver((entries) => {
        const rect = entries[entries.length - 1]!.contentRect;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        this.canvas.width = Math.round(rect.width * dpr);
        this.canvas.height = Math.round(rect.height * dpr);
        this.unit = this.canvas.width / CANVAS_W;
        this.draw();
      });
      this.observer.observe(this.canvas);
    }
  }

  /** The money now. The first amount is laid in settled; every change after is poured or spent. */
  set(rubles: number): void {
    if (rubles === this.rubles) return;
    const first = this.rubles < 0;
    this.rubles = rubles;
    this.el.setAttribute('aria-label', `${rubles} rubles`);
    const amount = balls(Math.max(0, rubles));
    this.overflow = Math.max(0, amount.big - MAX_BIG);
    const want = { ...amount, big: Math.min(MAX_BIG, amount.big) };
    if (first) {
      this.layIn(want);
      return;
    }
    // What the jar will hold once the queues have run: balls in, minus spends, plus pours.
    const coming: Record<BallKind, number> = { big: 0, middle: 0, small: 0 };
    for (const b of this.balls) if (b.leftS < 0) coming[b.kind]++;
    for (const k of this.spends) coming[k]--;
    for (const k of this.pours) coming[k]++;
    const hadSpends = this.spends.length > 0;
    for (const kind of ['small', 'middle', 'big'] as const) {
      let d = want[kind] - coming[kind];
      // Take back pours not yet made before spending balls already in.
      while (d < 0 && this.pours.lastIndexOf(kind) >= 0) {
        this.pours.splice(this.pours.lastIndexOf(kind), 1);
        d++;
      }
      while (d < 0 && this.spends.length < 64) {
        this.spends.push(kind);
        d++;
      }
      // A spend still queued of this kind is cancelled before a pour is added.
      while (d > 0 && this.spends.lastIndexOf(kind) >= 0) {
        this.spends.splice(this.spends.lastIndexOf(kind), 1);
        d--;
      }
      for (; d > 0; d--) this.pours.push(kind);
    }
    // Big balls first into the jar, so they lie under the small ones.
    this.pours.sort((a, b) => DIAMETER[b] - DIAMETER[a]);
    if (!hadSpends && this.spends.length > 0) this.nextActionMs = Math.max(this.nextActionMs, performance.now());
    this.wake();
  }

  dispose(): void {
    this.observer?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** The jar filled at once: the balls dropped in rows and the simulation run until they settle. */
  private layIn(want: Record<BallKind, number>): void {
    this.balls.length = 0;
    this.pours.length = 0;
    this.spends.length = 0;
    let row = 0;
    let x = MARGIN_X + 0.6;
    for (const kind of ['big', 'middle', 'small'] as const) {
      for (let i = 0; i < want[kind]; i++) {
        const ball = this.newBall(kind, x, MARGIN_TOP + SHOULDER_H + 0.5 - row * 1.2);
        ball.x += (i % 2) * 0.05;
        this.balls.push(ball);
        x += DIAMETER[kind] * 1.05;
        if (x > MARGIN_X + JAR_W - 1) {
          x = MARGIN_X + 0.6 + (row % 2) * 0.3;
          row++;
        }
      }
    }
    for (let i = 0; i < 600; i++) this.step();
    for (const b of this.balls) b.vx = b.vy = 0;
    this.draw();
  }

  private newBall(kind: BallKind, x: number, y: number): Ball {
    const r = DIAMETER[kind] / 2;
    return { kind, r, mass: r * r, x, y, vx: 0, vy: 0, leftS: -1, fallS: -1 };
  }

  private wake(): void {
    this.restS = 0;
    if (this.frame || typeof requestAnimationFrame === 'undefined') return;
    this.lastMs = performance.now();
    this.accS = 0;
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    this.act(now);
    this.accS += Math.min(0.1, (now - this.lastMs) / 1000);
    this.lastMs = now;
    while (this.accS >= STEP_S) {
      this.accS -= STEP_S;
      this.step();
    }
    this.draw();
    const busy = this.pours.length > 0 || this.spends.length > 0 || this.balls.some((b) => b.leftS >= 0);
    if (busy || this.restS < SLEEP_S) this.frame = requestAnimationFrame(this.tick);
  };

  /** The queues: a ball out of the neck, or a ball poured into it, when one is due. */
  private act(now: number): void {
    if (now < this.nextActionMs) return;
    const spend = this.spends.shift();
    if (spend !== undefined) {
      // The topmost ball of the kind jumps out.
      let top: Ball | null = null;
      for (const b of this.balls) if (b.leftS < 0 && b.kind === spend && (top === null || b.y < top.y)) top = b;
      if (top !== null) {
        // Up through the mouth: the leap tops out over its middle, then the ball is
        // thrown aside and falls past the jar.
        const rise = top.y - (MARGIN_TOP - LEAP_OVER * (0.8 + Math.random() * 0.4));
        top.leftS = 0;
        top.vy = -Math.sqrt(2 * GRAVITY * Math.max(0.5, rise));
        top.vx = (MARGIN_X + JAR_W / 2 - top.x) / (-top.vy / GRAVITY);
      }
      this.nextActionMs = now + (this.spends.length > 0 ? SPEND_MS : SWAP_MS);
      this.restS = 0;
      return;
    }
    const pour = this.pours.shift();
    if (pour !== undefined) {
      const cx = MARGIN_X + JAR_W / 2;
      const ball = this.newBall(pour, cx + (Math.random() - 0.5) * (MOUTH_HALF - DIAMETER[pour] / 2), MARGIN_TOP - DIAMETER[pour]);
      ball.vy = 4;
      ball.vx = (Math.random() - 0.5) * 1.5;
      this.balls.push(ball);
      this.nextActionMs = now + POUR_MS;
      this.restS = 0;
    }
  }

  private step(): void {
    const list = this.balls;
    let fastest = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i]!;
      b.vy += GRAVITY * STEP_S;
      b.vx *= 0.996;
      b.vy *= 0.996;
      b.x += b.vx * STEP_S;
      b.y += b.vy * STEP_S;
      if (b.leftS >= 0) {
        b.leftS += STEP_S;
        if (b.fallS < 0 && b.vy >= 0) {
          b.fallS = 0;
          b.vx = (Math.random() < 0.5 ? -1 : 1) * LEAP_SIDE * (0.7 + Math.random() * 0.6);
        } else if (b.fallS >= 0) {
          b.fallS += STEP_S;
          if (b.fallS > FADE_S) list.splice(i, 1);
        }
      }
    }
    // A few passes of contacts: ball on ball, then ball on glass.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i]!;
        if (a.leftS >= 0) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j]!;
          if (b.leftS >= 0) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const min = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const share = b.mass / (a.mass + b.mass);
          const overlap = min - d;
          a.x -= nx * overlap * share;
          a.y -= ny * overlap * share;
          b.x += nx * overlap * (1 - share);
          b.y += ny * overlap * (1 - share);
          const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (closing < 0) {
            const impulse = (-(1 + BALL_BOUNCE) * closing) / (1 / a.mass + 1 / b.mass);
            a.vx -= (impulse / a.mass) * nx;
            a.vy -= (impulse / a.mass) * ny;
            b.vx += (impulse / b.mass) * nx;
            b.vy += (impulse / b.mass) * ny;
          }
        }
      }
      for (const b of list) if (b.leftS < 0) this.collideWall(b);
    }
    for (const b of list) if (b.leftS < 0) fastest = Math.max(fastest, Math.hypot(b.vx, b.vy));
    this.restS = fastest < REST_SPEED ? this.restS + STEP_S : 0;
  }

  private collideWall(b: Ball): void {
    const w = WALL_LINE;
    const reach = b.r + WALL / 2;
    for (let k = 0; k + 3 < w.length; k += 2) {
      const ax = w[k]!;
      const ay = w[k + 1]!;
      const ex = w[k + 2]! - ax;
      const ey = w[k + 3]! - ay;
      const len2 = ex * ex + ey * ey;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((b.x - ax) * ex + (b.y - ay) * ey) / len2)) : 0;
      const px = ax + ex * t;
      const py = ay + ey * t;
      let nx = b.x - px;
      let ny = b.y - py;
      const d = Math.hypot(nx, ny);
      if (d >= reach) continue;
      if (d < 1e-6) {
        // On the line: out the segment's inward side (the polyline runs anticlockwise on screen).
        nx = ey;
        ny = -ex;
      }
      const n = Math.hypot(nx, ny) || 1;
      nx /= n;
      ny /= n;
      b.x = px + nx * reach;
      b.y = py + ny * reach;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + WALL_BOUNCE) * vn * nx;
        b.vy -= (1 + WALL_BOUNCE) * vn * ny;
        // Rolling on the glass loses a little of the slide along it.
        const tx = -ny;
        const ty = nx;
        const vt = b.vx * tx + b.vy * ty;
        b.vx -= vt * (1 - FRICTION) * tx;
        b.vy -= vt * (1 - FRICTION) * ty;
      }
    }
    // Never through the floor.
    const floor = MARGIN_TOP + JAR_H - WALL - b.r;
    if (b.y > floor) {
      b.y = floor;
      if (b.vy > 0) b.vy = -b.vy * WALL_BOUNCE;
    }
  }

  private draw(): void {
    const g = this.g;
    const u = this.unit;
    if (g === null || u <= 0) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(u, 0, 0, u, 0, 0);
    const outline = (): void => {
      g.beginPath();
      for (let k = 0; k < WALL_LINE.length; k += 2) {
        if (k === 0) g.moveTo(WALL_LINE[k]!, WALL_LINE[k + 1]!);
        else g.lineTo(WALL_LINE[k]!, WALL_LINE[k + 1]!);
      }
    };
    // The glass behind the balls: a faint tint and the far wall's shade.
    outline();
    g.closePath();
    const back = g.createLinearGradient(MARGIN_X, 0, MARGIN_X + JAR_W, 0);
    back.addColorStop(0, 'rgba(190, 225, 235, 0.16)');
    back.addColorStop(0.5, 'rgba(190, 225, 235, 0.05)');
    back.addColorStop(1, 'rgba(120, 160, 175, 0.2)');
    g.fillStyle = back;
    g.fill();

    // The balls, those leaving fading as they go.
    for (const b of this.balls) {
      const fade = b.fallS < 0 ? 1 : Math.max(0, 1 - b.fallS / FADE_S);
      if (fade <= 0) continue;
      g.globalAlpha = fade;
      const r = b.r;
      g.drawImage(ballSprite(b.kind), b.x - r, b.y - r, 2 * r, 2 * r);
    }
    g.globalAlpha = 1;

    // The glass in front: the wall in section, the lip, a window's highlight down the left.
    outline();
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.lineWidth = WALL;
    g.strokeStyle = 'rgba(214, 240, 248, 0.62)';
    g.stroke();
    const cx = MARGIN_X + JAR_W / 2;
    g.lineWidth = WALL * 1.6;
    g.strokeStyle = 'rgba(230, 248, 252, 0.75)';
    g.beginPath();
    g.moveTo(cx - MOUTH_HALF - WALL * 1.4, MARGIN_TOP + 0.05);
    g.lineTo(cx - MOUTH_HALF + WALL * 0.4, MARGIN_TOP + 0.05);
    g.moveTo(cx + MOUTH_HALF - WALL * 0.4, MARGIN_TOP + 0.05);
    g.lineTo(cx + MOUTH_HALF + WALL * 1.4, MARGIN_TOP + 0.05);
    g.stroke();
    g.lineWidth = WALL * 1.3;
    g.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    g.beginPath();
    g.moveTo(MARGIN_X + 0.42, MARGIN_TOP + SHOULDER_H + 0.25);
    g.lineTo(MARGIN_X + 0.42, MARGIN_TOP + JAR_H - CORNER_R - 0.2);
    g.stroke();

    if (this.overflow > 0) {
      // In pixels: a font is not scaled down to an em reliably.
      const text = `+${this.overflow}`;
      const x = (MARGIN_X + JAR_W - 0.35) * u;
      const y = (MARGIN_TOP + SHOULDER_H - 0.1) * u;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.font = `700 ${Math.round(0.95 * u)}px sans-serif`;
      g.textAlign = 'right';
      g.textBaseline = 'top';
      g.lineWidth = 0.18 * u;
      g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      g.strokeText(text, x, y);
      g.fillStyle = '#f1d9a6';
      g.fillText(text, x, y);
    }
  }
}
