import { balls } from '../economy/money';
import { ballSprite, shimmer, type BallKind } from './balls';

/**
 * THE MONEY JAR: the player's calcite balls (economy/money.ts) in a round glass jar
 * drawn in section, as the purse in Kingdom Two Crowns. It stands in the bottom right
 * corner, and only while the player is on foot on a lay-by — where money is made and
 * spent (main.ts); elsewhere it is put away. The light plays on the balls while the jar
 * is out: their film of rainbow turns, each ball its own way; and every couple of
 * seconds the jar is given a little shake, so the balls shift in it.
 *
 *  - Money coming in is POURED through the neck as its own balls, a ball at a time,
 *    and they roll and settle on the rest. Once everything lies still, every ten balls
 *    of a kind MERGE: they run together and are one ball of the next size.
 *  - Money going out LEAPS out of the neck and falls away, the biggest balls that fit
 *    the amount first; short of small change, a bigger ball SPLITS into ten of the next
 *    size down, and what is left of them merges back later.
 *
 * The balls are a small 2D simulation — gravity, the jar's walls, the balls on each
 * other — stepped at `STEP_S` while anything moves. Put away, nothing runs: a change
 * of money is laid in settled, and shown when the jar comes out.
 */

/** Ball diameters in the jar, em (hud.css `.hud-jar` sets the em). */
const DIAMETER: Readonly<Record<BallKind, number>> = { big: 1.5, middle: 1.06, small: 0.68 };
/** Big balls past this many are a "+N" on the glass rather than balls. */
const MAX_BIG = 15;

/** The jar, em: its outside size, and the canvas margin round it the balls leap into. */
const JAR_W = 10.4;
const JAR_H = 10;
const MARGIN_X = 2.6;
const MARGIN_TOP = 2.4;
const MARGIN_BOTTOM = 0.4;
const CANVAS_W = JAR_W + 2 * MARGIN_X;
const CANVAS_H = JAR_H + MARGIN_TOP + MARGIN_BOTTOM;
/** The glass's thickness, em: the balls roll on its inner face. */
const WALL = 0.16;
/** The mouth's half width and the neck's depth, under the rolled lip. */
const MOUTH_HALF = 2.3;
const NECK_H = 1.1;
/** The belly: a superellipse this round (2 an ellipse, higher squarer), a little flat at the foot. */
const BELLY_ROUND = 2.7;
const FOOT_H = 0.35;

const STEP_S = 1 / 120;
const GRAVITY = 42;
const WALL_BOUNCE = 0.25;
const BALL_BOUNCE = 0.15;
const FRICTION = 0.9;
/** At rest once every ball has been slower than this, em/s, for `REST_S`: above the one step of gravity a lying ball gains and loses. */
const REST_SPEED = 1.2;
const REST_S = 0.4;
/** Pouring: one ball per `POUR_MS`; a ball out per `SPEND_MS`; after a split or a turn from spending to pouring, `SWAP_MS`. */
const POUR_MS = 70;
const SPEND_MS = 35;
const SWAP_MS = 260;
/**
 * Merging: the balls run together in `MERGE_S`, once all has lain still `MERGE_REST_S`
 * — or at the latest `MERGE_WAIT_MS` after the last op, a pile never being quite still
 * — and `MERGE_GAP_MS` apart.
 */
const MERGE_S = 0.35;
const MERGE_REST_S = 0.25;
const MERGE_WAIT_MS = 1200;
const MERGE_GAP_MS = 160;
/** The shake: every `SHAKE_MIN_MS`..`SHAKE_MAX_MS` while the jar is out and nothing else goes on; the jar rocks this far, degrees, and the balls are kicked up to this fast, em/s. */
const SHAKE_MIN_MS = 2000;
const SHAKE_MAX_MS = 3500;
const SHAKE_DEG = 2;
const SHAKE_KICK = 2.6;
/** A ball born of a merge or a split swells to its size in this long. */
const POP_S = 0.22;
/** A ball leaving: the height over the mouth its leap tops out at, em; its throw aside, em/s; how long it fades. */
const LEAP_OVER = 1.6;
const LEAP_SIDE = 5;
const FADE_S = 0.4;
/** The shimmer: how fast the light turns on a ball, turns per second, and how strong it lies. */
const SHIMMER_TURNS = 0.12;
const SHIMMER_ALPHA = 0.32;
/** Drawn at most this often while only the shimmer moves. */
const SHIMMER_FRAME_MS = 40;

interface Ball {
  readonly kind: BallKind;
  readonly r: number;
  readonly mass: number;
  /** Where its shimmer starts and which way it turns. */
  readonly phase: number;
  readonly spin: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since it left the jar, or -1 while it is in; then seconds since its leap topped out, or -1 before. */
  leftS: number;
  fallS: number;
  /** Merging: where it runs from and to, and seconds since it started, or -1. */
  mergeS: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Seconds since it was born of a merge or a split, for its swelling, or -1. */
  popS: number;
}

const VALUE: Readonly<Record<BallKind, number>> = { big: 100, middle: 10, small: 1 };
const NEXT_UP: Readonly<Record<BallKind, BallKind | null>> = { small: 'middle', middle: 'big', big: null };
const NEXT_DOWN: Readonly<Record<BallKind, BallKind | null>> = { big: 'middle', middle: 'small', small: null };
const KINDS_DOWN = ['big', 'middle', 'small'] as const;

/** What the jar is to do next: a ball poured in, a ball out, a ball split into ten. */
interface JarOp {
  readonly t: 'pour' | 'spend' | 'split';
  readonly kind: BallKind;
}

/** Ten balls running together into one. */
interface Merge {
  readonly balls: Ball[];
  readonly into: BallKind;
  readonly x: number;
  readonly y: number;
}

const CX = MARGIN_X + JAR_W / 2;
const LIP_Y = MARGIN_TOP;
const BELLY_TOP = LIP_Y + NECK_H;
const BELLY_A = JAR_W / 2 - WALL / 2;
const BELLY_B = (JAR_H - NECK_H) / 2 - WALL / 2;
const BELLY_CY = BELLY_TOP + BELLY_B;
/** The inner face of the foot. */
const FLOOR_Y = BELLY_CY + BELLY_B - FOOT_H * 0.5;

/** The belly's outline at angle `t` (0 = right, π/2 = down), in canvas em, its foot cut level. */
function bellyPoint(t: number): [number, number] {
  const p = 2 / BELLY_ROUND;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const x = CX + BELLY_A * Math.sign(c) * Math.abs(c) ** p;
  const y = Math.min(BELLY_CY + BELLY_B * Math.sign(s) * Math.abs(s) ** p, FLOOR_Y);
  return [x, y];
}

/** The jar's inner face as a polyline, em in canvas space: the left neck down, round the belly, the right neck up. */
function jarWall(): number[] {
  // The neck joins the belly where the belly is the mouth's width.
  const p = 2 / BELLY_ROUND;
  const join = Math.acos(((MOUTH_HALF + WALL / 2) / BELLY_A) ** (1 / p));
  const out: number[] = [CX - MOUTH_HALF - WALL / 2, LIP_Y];
  const steps = 48;
  // From the left join (upper left), down round the foot, up to the right join.
  for (let i = 0; i <= steps; i++) out.push(...bellyPoint(Math.PI + join - (i / steps) * (Math.PI + 2 * join)));
  out.push(CX + MOUTH_HALF + WALL / 2, LIP_Y);
  return out;
}

const WALL_LINE = jarWall();

/** Half the belly's inside width at height `y`, for a ball of radius `r` (0 where none fits). */
function bellyHalfAt(y: number, r: number): number {
  const a = BELLY_A - WALL / 2 - r;
  const b = BELLY_B - WALL / 2 - r;
  const k = Math.abs(y - BELLY_CY) / b;
  return k >= 1 ? 0 : a * (1 - k ** BELLY_ROUND) ** (1 / BELLY_ROUND);
}

/**
 * Puts a ball found outside the belly (a contact pass can push one through the glass
 * where the wall turns sharply) back in, on the line to the belly's middle.
 */
function keepInBelly(b: Ball): void {
  if (b.y < BELLY_TOP) return;
  const a = BELLY_A - WALL / 2 - b.r;
  const h = BELLY_B - WALL / 2 - b.r;
  const dx = b.x - CX;
  const dy = b.y - BELLY_CY;
  const reach = Math.abs(dx / a) ** BELLY_ROUND + Math.abs(dy / h) ** BELLY_ROUND;
  if (reach <= 1) return;
  const k = reach ** (-1 / BELLY_ROUND) * 0.995;
  b.x = CX + dx * k;
  b.y = BELLY_CY + dy * k;
  // What was carrying it out is gone.
  const n = Math.hypot(dx, dy) || 1;
  const out = (b.vx * dx + b.vy * dy) / n;
  if (out > 0) {
    b.vx -= (out * dx) / n;
    b.vy -= (out * dy) / n;
  }
}

export class MoneyJar {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly observer: ResizeObserver | null = null;
  /** Canvas pixels per em. */
  private unit = 0;
  private readonly balls: Ball[] = [];
  /** What is still to be done, in order. */
  private readonly ops: JarOp[] = [];
  /** The balls the jar will hold once `ops` and the merge in hand are done: big ones beyond the glass included. */
  private readonly ledger: Record<BallKind, number> = { big: 0, middle: 0, small: 0 };
  private merge: Merge | null = null;
  private nextActionMs = 0;
  private lastOpMs = 0;
  private nextShakeMs = 0;
  private restS = 0;
  private frame = 0;
  private lastMs = 0;
  private drawnMs = 0;
  private accS = 0;
  private overflow = 0;
  private rubles = -1;
  private shown = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hud-jar';
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
        this.draw(performance.now());
      });
      this.observer.observe(this.canvas);
    }
  }

  /** Out on the screen, or put away. */
  setShown(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.el.classList.toggle('is-shown', shown);
    // Put away, whatever was still falling settles at once: the jar comes out as it is.
    if (shown) {
      this.nextShakeMs = performance.now() + SHAKE_MIN_MS;
      this.wake();
    } else {
      this.settle();
    }
  }

  /** The money now: poured or spent while the jar is out, laid in settled while it is away. */
  set(rubles: number): void {
    if (rubles === this.rubles) return;
    const before = this.rubles;
    this.rubles = rubles;
    this.el.setAttribute('aria-label', `${rubles} rubles`);
    if (!this.shown || before < 0) {
      this.layIn();
      return;
    }
    if (rubles > before) {
      // The income as its own balls, the big ones first so they go under.
      const amount = balls(rubles - before);
      for (const kind of KINDS_DOWN) {
        for (let i = 0; i < amount[kind]; i++) this.ops.push({ t: 'pour', kind });
        this.ledger[kind] += amount[kind];
      }
    } else {
      // The biggest ball that fits what is left to pay; none fits, the smallest bigger one splits.
      let left = before - rubles;
      while (left > 0) {
        const fit = KINDS_DOWN.find((k) => this.ledger[k] > 0 && VALUE[k] <= left);
        if (fit !== undefined) {
          this.ops.push({ t: 'spend', kind: fit });
          this.ledger[fit]--;
          left -= VALUE[fit];
          continue;
        }
        const split = (['middle', 'big'] as const).find((k) => this.ledger[k] > 0);
        if (split === undefined) break;
        this.ops.push({ t: 'split', kind: split });
        this.ledger[split]--;
        this.ledger[NEXT_DOWN[split]!] += 10;
      }
      if (left > 0) {
        // Out of step with the money somehow: start again from it.
        this.layIn();
        return;
      }
    }
    this.wake();
  }

  dispose(): void {
    this.observer?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** The queues run out at once and the balls settle, unseen. */
  private settle(): void {
    const still = this.ops.length === 0 && this.merge === null && this.balls.every((b) => b.leftS < 0) && this.restS >= REST_S && !this.canMerge();
    if (!still && this.rubles >= 0) this.layIn();
  }

  /** The jar filled at once with the money as it stands, settled: dropped in rows and the simulation run till they lie still. */
  private layIn(): void {
    const amount = balls(Math.max(0, this.rubles));
    this.ledger.big = amount.big;
    this.ledger.middle = amount.middle;
    this.ledger.small = amount.small;
    this.overflow = Math.max(0, amount.big - MAX_BIG);
    this.balls.length = 0;
    this.ops.length = 0;
    this.merge = null;
    // In rows from the foot up, each as wide as the belly is at its height.
    let y = FLOOR_Y - WALL / 2 - DIAMETER.big / 2;
    let half = bellyHalfAt(y, DIAMETER.big / 2);
    let x = CX - half;
    for (const kind of KINDS_DOWN) {
      const count = kind === 'big' ? amount.big - this.overflow : amount[kind];
      const d = DIAMETER[kind];
      for (let i = 0; i < count; i++) {
        if (x + d > CX + half) {
          y -= DIAMETER.big;
          half = Math.max(0, bellyHalfAt(y, DIAMETER.big / 2));
          x = CX - half;
        }
        this.balls.push(this.newBall(kind, x + d / 2, y));
        x += d * 1.02;
      }
    }
    for (let i = 0; i < 700; i++) this.step();
    for (const b of this.balls) b.vx = b.vy = 0;
    this.restS = REST_S;
    this.draw(performance.now());
  }

  /** Balls of `kind` lying in the jar (not leaving, not merging). */
  private lying(kind: BallKind): Ball[] {
    return this.balls.filter((b) => b.kind === kind && b.leftS < 0 && b.mergeS < 0);
  }

  private canMerge(): boolean {
    return this.lying('small').length >= 10 || this.lying('middle').length >= 10;
  }

  private topmost(kind: BallKind): Ball | null {
    let top: Ball | null = null;
    for (const b of this.lying(kind)) if (top === null || b.y < top.y) top = b;
    return top;
  }

  private newBall(kind: BallKind, x: number, y: number): Ball {
    const r = DIAMETER[kind] / 2;
    return {
      kind, r, mass: r * r, phase: Math.random(), spin: Math.random() < 0.5 ? -1 : 1,
      x, y, vx: 0, vy: 0, leftS: -1, fallS: -1, mergeS: -1, fromX: 0, fromY: 0, toX: 0, toY: 0, popS: -1,
    };
  }

  private wake(): void {
    if (this.frame || !this.shown || typeof requestAnimationFrame === 'undefined') return;
    this.lastMs = performance.now();
    this.accS = 0;
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    if (!this.shown) return;
    this.act(now);
    this.accS += Math.min(0.1, (now - this.lastMs) / 1000);
    this.lastMs = now;
    const moving = this.ops.length > 0 || this.merge !== null || this.restS < REST_S || this.canMerge() || this.balls.some((b) => b.leftS >= 0 || b.popS >= 0);
    if (moving) {
      while (this.accS >= STEP_S) {
        this.accS -= STEP_S;
        this.step();
      }
    } else {
      this.accS = 0;
    }
    // The shimmer goes on while the jar is out, drawn less often than the balls move.
    if (moving || now - this.drawnMs >= SHIMMER_FRAME_MS) this.draw(now);
    this.frame = requestAnimationFrame(this.tick);
  };

  /** The next thing to do, when one is due: an op off the queue, or with none left and all still, a merge. */
  private act(now: number): void {
    if (this.merge !== null) {
      this.finishMerge(now);
      return;
    }
    if (now < this.nextActionMs) return;
    const op = this.ops.shift();
    if (op === undefined) {
      const still = this.restS >= MERGE_REST_S || now - this.lastOpMs >= MERGE_WAIT_MS;
      if (!still || this.balls.some((b) => b.leftS >= 0)) return;
      if (this.canMerge()) this.startMerge();
      else if (now >= this.nextShakeMs) this.shake(now);
      return;
    }
    this.restS = 0;
    this.lastOpMs = now;
    const next = this.ops[0];
    if (op.t === 'pour') {
      this.nextActionMs = now + (next === undefined || next.t === 'pour' ? POUR_MS : SWAP_MS);
      if (op.kind === 'big' && this.lying('big').length >= MAX_BIG) {
        this.overflow++;
        return;
      }
      const ball = this.newBall(op.kind, CX + (Math.random() - 0.5) * (MOUTH_HALF - DIAMETER[op.kind] / 2), LIP_Y - DIAMETER[op.kind]);
      ball.vy = 4;
      ball.vx = (Math.random() - 0.5) * 1.5;
      this.balls.push(ball);
    } else if (op.t === 'spend') {
      this.nextActionMs = now + (next?.t === 'spend' ? SPEND_MS : SWAP_MS);
      if (op.kind === 'big' && this.overflow > 0) {
        this.overflow--;
        return;
      }
      const top = this.topmost(op.kind);
      if (top !== null) {
        // Up through the mouth: the leap tops out over its middle, then the ball is
        // thrown aside and falls past the jar.
        const rise = top.y - (LIP_Y - LEAP_OVER * (0.8 + Math.random() * 0.4));
        top.leftS = 0;
        top.vy = -Math.sqrt(2 * GRAVITY * Math.max(0.5, rise));
        top.vx = (CX - top.x) / (-top.vy / GRAVITY);
      }
    } else {
      this.nextActionMs = now + SWAP_MS;
      const down = NEXT_DOWN[op.kind]!;
      let x = CX;
      let y = LIP_Y + NECK_H + 0.5;
      if (op.kind === 'big' && this.overflow > 0) {
        this.overflow--;
      } else {
        const top = this.topmost(op.kind);
        if (top !== null) {
          x = top.x;
          y = top.y;
          this.balls.splice(this.balls.indexOf(top), 1);
        }
      }
      // Ten of the next size burst out where it lay.
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const ball = this.newBall(down, x + Math.cos(a) * 0.35, y + Math.sin(a) * 0.35);
        ball.vx = Math.cos(a) * 3;
        ball.vy = Math.sin(a) * 3 - 2;
        ball.popS = 0;
        this.balls.push(ball);
      }
    }
  }

  /** A little shake: the jar rocks on its foot and the balls are kicked, all a little the same way. */
  private shake(now: number): void {
    this.nextShakeMs = now + SHAKE_MIN_MS + Math.random() * (SHAKE_MAX_MS - SHAKE_MIN_MS);
    const way = Math.random() < 0.5 ? -1 : 1;
    for (const b of this.balls) {
      if (b.leftS >= 0 || b.mergeS >= 0) continue;
      b.vx += way * SHAKE_KICK * (0.4 + Math.random() * 0.6);
      b.vy -= SHAKE_KICK * Math.random();
    }
    this.restS = 0;
    this.canvas.animate?.(
      [
        { transform: 'rotate(0deg)' },
        { transform: `rotate(${way * SHAKE_DEG}deg)`, offset: 0.25 },
        { transform: `rotate(${-way * SHAKE_DEG * 0.5}deg)`, offset: 0.6 },
        { transform: 'rotate(0deg)' },
      ],
      { duration: 420, easing: 'ease-out' },
    );
  }

  /** Ten lying balls of a kind run together: the topmost and the nine nearest it, into their middle. */
  private startMerge(): void {
    for (const kind of ['small', 'middle'] as const) {
      const lying = this.lying(kind);
      if (lying.length < 10) continue;
      const seed = this.topmost(kind)!;
      lying.sort((a, b) => Math.hypot(a.x - seed.x, a.y - seed.y) - Math.hypot(b.x - seed.x, b.y - seed.y));
      const group = lying.slice(0, 10);
      let x = 0;
      let y = 0;
      for (const b of group) {
        x += b.x / 10;
        y += b.y / 10;
      }
      for (const b of group) {
        b.mergeS = 0;
        b.fromX = b.x;
        b.fromY = b.y;
        b.toX = x;
        b.toY = y;
        b.vx = b.vy = 0;
      }
      this.merge = { balls: group, into: NEXT_UP[kind]!, x, y };
      this.ledger[kind] -= 10;
      this.ledger[NEXT_UP[kind]!] += 1;
      this.restS = 0;
      return;
    }
  }

  private finishMerge(now: number): void {
    const m = this.merge!;
    if (m.balls[0]!.mergeS < MERGE_S) return;
    for (const b of m.balls) this.balls.splice(this.balls.indexOf(b), 1);
    this.merge = null;
    this.nextActionMs = now + MERGE_GAP_MS;
    this.lastOpMs = now - MERGE_WAIT_MS;
    this.restS = 0;
    if (m.into === 'big' && this.lying('big').length >= MAX_BIG) {
      this.overflow++;
      return;
    }
    const ball = this.newBall(m.into, m.x, m.y);
    ball.popS = 0;
    this.balls.push(ball);
  }

  private step(): void {
    const list = this.balls;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i]!;
      if (b.popS >= 0) {
        b.popS += STEP_S;
        if (b.popS > POP_S) b.popS = -1;
      }
      if (b.mergeS >= 0) {
        // Running together, eased in and out, over everything.
        b.mergeS += STEP_S;
        const k = Math.min(1, b.mergeS / MERGE_S);
        const e = k * k * (3 - 2 * k);
        b.x = b.fromX + (b.toX - b.fromX) * e;
        b.y = b.fromY + (b.toY - b.fromY) * e;
        continue;
      }
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
        if (a.leftS >= 0 || a.mergeS >= 0) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j]!;
          if (b.leftS >= 0 || b.mergeS >= 0) continue;
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
      for (const b of list) if (b.leftS < 0 && b.mergeS < 0) this.collideWall(b);
    }
    let fastest = 0;
    for (const b of list) if (b.leftS < 0 && b.mergeS < 0) fastest = Math.max(fastest, Math.hypot(b.vx, b.vy));
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
    keepInBelly(b);
    // Never through the foot.
    const floor = FLOOR_Y - WALL / 2 - b.r;
    if (b.y > floor) {
      b.y = floor;
      if (b.vy > 0) b.vy = -b.vy * WALL_BOUNCE;
    }
  }

  private draw(now: number): void {
    const g = this.g;
    const u = this.unit;
    if (g === null || u <= 0) return;
    this.drawnMs = now;
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

    // Its shadow on whatever it stands on, then the glass behind the balls: a faint
    // tint, the far wall darker toward the sides.
    g.fillStyle = 'rgba(0, 0, 0, 0.28)';
    g.beginPath();
    g.ellipse(CX, FLOOR_Y + WALL / 2 + 0.12, BELLY_A * 0.85, 0.28, 0, 0, Math.PI * 2);
    g.fill();
    outline();
    g.closePath();
    const back = g.createRadialGradient(CX - 1, BELLY_CY - 1, 0.5, CX, BELLY_CY, BELLY_A * 1.1);
    back.addColorStop(0, 'rgba(225, 245, 250, 0.1)');
    back.addColorStop(0.75, 'rgba(190, 225, 235, 0.16)');
    back.addColorStop(1, 'rgba(110, 150, 165, 0.34)');
    g.fillStyle = back;
    g.fill();

    // The balls, each with the light turning on it; those leaving fade as they fall.
    const t = now / 1000;
    for (const b of this.balls) {
      const fade = b.fallS < 0 ? 1 : Math.max(0, 1 - b.fallS / FADE_S);
      if (fade <= 0) continue;
      // Born of a merge or a split it swells past its size and back; merging it shrinks into the rest.
      let r = b.r;
      if (b.popS >= 0) {
        const k = b.popS / POP_S;
        r *= k < 0.7 ? 0.3 + (k / 0.7) * 0.85 : 1.15 - ((k - 0.7) / 0.3) * 0.15;
      } else if (b.mergeS >= 0) {
        r *= 1 - 0.45 * Math.min(1, b.mergeS / MERGE_S);
      }
      g.globalAlpha = fade;
      g.drawImage(ballSprite(b.kind), b.x - r, b.y - r, 2 * r, 2 * r);
      g.save();
      g.beginPath();
      g.arc(b.x, b.y, r * 0.92, 0, Math.PI * 2);
      g.clip();
      g.globalCompositeOperation = 'overlay';
      g.globalAlpha = fade * SHIMMER_ALPHA;
      g.fillStyle = shimmer(g, b.x, b.y, r, b.phase + b.spin * t * SHIMMER_TURNS);
      g.fillRect(b.x - r, b.y - r, 2 * r, 2 * r);
      g.restore();
    }
    g.globalAlpha = 1;

    // The glass in front: the wall in section, a window's highlight down the left of
    // the belly and a spot on its right shoulder.
    outline();
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.lineWidth = WALL;
    g.strokeStyle = 'rgba(220, 244, 250, 0.7)';
    g.stroke();
    g.lineWidth = WALL * 1.6;
    g.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    g.beginPath();
    g.ellipse(CX, BELLY_CY, BELLY_A - 0.55, BELLY_B - 0.55, 0, Math.PI * 0.82, Math.PI * 1.22);
    g.stroke();
    g.fillStyle = 'rgba(255, 255, 255, 0.4)';
    g.beginPath();
    g.ellipse(CX + BELLY_A * 0.55, BELLY_TOP + 1.2, 0.45, 0.22, -0.5, 0, Math.PI * 2);
    g.fill();

    // The rolled lip: a glass ring round the mouth, seen in section as two beads.
    for (const side of [-1, 1]) {
      const x = CX + side * (MOUTH_HALF + WALL / 2);
      const lip = g.createRadialGradient(x - 0.08, LIP_Y - 0.1, 0.02, x, LIP_Y, 0.32);
      lip.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      lip.addColorStop(1, 'rgba(170, 215, 228, 0.7)');
      g.fillStyle = lip;
      g.beginPath();
      g.ellipse(x + side * 0.12, LIP_Y, 0.36, 0.26, 0, 0, Math.PI * 2);
      g.fill();
    }
    // A twine tied round the neck, its ends hanging.
    const tie = LIP_Y + NECK_H * 0.55;
    const nx = CX + MOUTH_HALF + WALL;
    g.strokeStyle = '#a0763f';
    g.lineWidth = 0.13;
    g.beginPath();
    g.moveTo(CX - MOUTH_HALF - WALL, tie);
    g.lineTo(nx, tie + 0.06);
    g.moveTo(CX - MOUTH_HALF - WALL, tie + 0.2);
    g.lineTo(nx, tie + 0.26);
    g.moveTo(nx, tie + 0.1);
    g.quadraticCurveTo(nx + 0.55, tie + 0.5, nx + 0.4, tie + 1.1);
    g.moveTo(nx, tie + 0.14);
    g.quadraticCurveTo(nx + 0.2, tie + 0.6, nx, tie + 1.0);
    g.stroke();

    if (this.overflow > 0) {
      // In pixels: a font is not scaled down to an em reliably.
      const text = `+${this.overflow}`;
      const x = (CX + BELLY_A - 0.6) * u;
      const y = (BELLY_TOP + 0.5) * u;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.font = `700 ${Math.round(1.1 * u)}px sans-serif`;
      g.textAlign = 'right';
      g.textBaseline = 'top';
      g.lineWidth = 0.2 * u;
      g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      g.strokeText(text, x, y);
      g.fillStyle = '#f2b84e';
      g.fillText(text, x, y);
    }
  }
}
