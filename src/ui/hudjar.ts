import { JAR_CAPACITY, purseTotal, SHELL_KINDS, type ShellKind, type ShellPurse } from '../economy/shells';
import { shellSprite } from './shellsprites';

/**
 * THE SHELL JAR: the player's shells (economy/shells.ts) in a round glass jar drawn in
 * section, as the purse in Kingdom Two Crowns. It stands in the corner of the screen
 * (hud.css `.hud-jar`), out while the player is on foot on a lay-by — where shells are
 * paid and spent (main.ts `setShellsShown`) — and put away elsewhere. There is no figure
 * on it anywhere: what the jar holds is read by looking at it.
 *
 *  - Shells coming in are POURED through the neck, a shell at a time, and roll and
 *    settle on the rest.
 *  - Shells going out are LIFTED out of the neck, the topmost of the kind first, and
 *    fade as they rise.
 *  - The jar holds `JAR_CAPACITY` and not one more: a shell pushed out by a new one in a
 *    full jar (`spill`) POPS up out over the rim and falls away past the jar.
 *  - Shells a FINE takes (`fine`, economy/economy.ts) LEAP out of the jar on their own,
 *    higher and slower than a pop, greyed and dimmed, turning over slowly, and drop away
 *    on its sides: lost, not spent. The jar sags on its foot with each.
 *
 * Put away, the jar still shows itself for a moment whenever the shells change — it
 * FLASHES: fades in, does its pouring or lifting where it can be seen, holds a couple of
 * seconds after the last of it and fades away (hud.css `.hud-jar.is-flash`).
 *
 * The shells are a small 2D simulation — gravity, the jar's walls, the shells on each
 * other, each a disc of one size — stepped at `STEP_S` while anything moves; and every
 * couple of seconds, while the jar is out and still, it is given a little shake so the
 * shells shift in it. Out of sight nothing runs: the first purse is laid in settled, and
 * whatever was still moving when the jar went away is laid in settled too.
 */

/** A shell's size in the jar, em (hud.css `.hud-jar` sets the em): `JAR_CAPACITY` of them lie in the belly with room to tumble. */
const DIAMETER = 1.05;
/** The sprite is drawn a little past the disc the shell is simulated as: its shape does not fill the disc. */
const SPRITE_OVER = 1.12;

/** The jar, em: its outside size, and the canvas margin round it the shells leave into. */
const JAR_W = 10.4;
const JAR_H = 10;
const MARGIN_X = 2.6;
const MARGIN_TOP = 2.4;
const MARGIN_BOTTOM = 0.4;
const CANVAS_W = JAR_W + 2 * MARGIN_X;
const CANVAS_H = JAR_H + MARGIN_TOP + MARGIN_BOTTOM;
/** The glass's thickness, em: the shells roll on its inner face. */
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
const SHELL_BOUNCE = 0.15;
const FRICTION = 0.9;
/** At rest once every shell has been slower than this, em/s, for `REST_S`: above the one step of gravity a lying shell gains and loses. */
const REST_SPEED = 1.2;
const REST_S = 0.4;
/** One shell poured per `POUR_MS`; one lifted out per `TAKE_MS`; one popped over the rim per `POP_MS`; one leaping out to a fine per `FINE_MS`; a turn from one to another waits `SWAP_MS`. */
const POUR_MS = 70;
const TAKE_MS = 90;
const POP_MS = 220;
const FINE_MS = 380;
const SWAP_MS = 260;
/** The shake: every `SHAKE_MIN_MS`..`SHAKE_MAX_MS` while the jar is out and still; the jar rocks this far, degrees, and the shells are kicked up to this fast, em/s. */
const SHAKE_MIN_MS = 2000;
const SHAKE_MAX_MS = 3500;
const SHAKE_DEG = 2;
const SHAKE_KICK = 2.6;
/** A shell lifted out: how long it takes to rise from where it lay to over the mouth, and how far over, em. */
const LIFT_S = 0.5;
const LIFT_OVER = 1.4;
/** A shell popped over the rim: the height over the mouth its leap tops out at, em; its throw aside, em/s; how long it falls before it is gone. */
const POP_OVER = 2;
const POP_SIDE = 4.5;
const POP_FALL_S = 0.9;
/**
 * A shell leaping out to a fine: the height over the mouth its leap tops out at, em; its
 * drift aside, em/s (slow: it is not thrown, it gives up); its fall before it is gone, s;
 * how slowly it turns, rad/s; how dim and how grey it is drawn; how far the jar sags, em.
 */
const FINE_OVER = 3.2;
const FINE_SIDE = 2.2;
const FINE_FALL_S = 1.3;
const FINE_SPIN = 2.5;
const FINE_ALPHA = 0.75;
const FINE_FILTER = 'grayscale(0.85) brightness(0.8)';
const FINE_SAG = 0.25;
/** How a lying shell turns as it rolls: radians per em it moves sideways. */
const ROLL = 0.6;
/** The flash: how long the jar stays in sight after the last change, when it is not out. */
const FLASH_HOLD_MS = 2500;

interface Shell {
  readonly kind: ShellKind;
  readonly r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** How it lies, radians, and how fast it spins while it flies. */
  angle: number;
  spin: number;
  /** Popped over the rim or leapt out to a fine: seconds since, or -1 while it is in; then seconds since its leap topped out, or -1 before. */
  popS: number;
  fallS: number;
  /** Leapt out to a fine (`popS` runs its flight): drawn greyed and dimmed. */
  fined: boolean;
  /** Lifted out: seconds since, from where it lay, or -1. */
  liftS: number;
  fromX: number;
  fromY: number;
}

/** What the jar is to do next: a shell poured in, lifted out, popped over the rim, or leaping out to a fine. */
interface JarOp {
  readonly t: 'pour' | 'take' | 'pop' | 'fine';
  readonly kind: ShellKind;
}

const OP_MS: Readonly<Record<JarOp['t'], number>> = { pour: POUR_MS, take: TAKE_MS, pop: POP_MS, fine: FINE_MS };

/** The purse in words, the jar's label: "12 shells: 4 scallop, 3 spiral, 5 horn". */
function purseWords(purse: Readonly<ShellPurse>): string {
  const total = purseTotal(purse);
  if (total === 0) return 'No shells';
  const kinds = SHELL_KINDS.filter((kind) => purse[kind] > 0).map((kind) => `${purse[kind]} ${kind}`);
  return `${total} shell${total === 1 ? '' : 's'}: ${kinds.join(', ')}`;
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

/** Half the belly's inside width at height `y`, for a shell of radius `r` (0 where none fits). */
function bellyHalfAt(y: number, r: number): number {
  const a = BELLY_A - WALL / 2 - r;
  const b = BELLY_B - WALL / 2 - r;
  const k = Math.abs(y - BELLY_CY) / b;
  return k >= 1 ? 0 : a * (1 - k ** BELLY_ROUND) ** (1 / BELLY_ROUND);
}

/**
 * Puts a shell found outside the belly (a contact pass can push one through the glass
 * where the wall turns sharply) back in, on the line to the belly's middle.
 */
function keepInBelly(b: Shell): void {
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

export class ShellJar {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly observer: ResizeObserver | null = null;
  /** Canvas pixels per em. */
  private unit = 0;
  private readonly shells: Shell[] = [];
  /** What is still to be done, in order. */
  private readonly ops: JarOp[] = [];
  /** The purse last set, or null before the first. */
  private purse: ShellPurse | null = null;
  /** Shells gone over the rim since the last `set`, by kind. */
  private readonly spilled: ShellPurse = { scallop: 0, spiral: 0, horn: 0, cowrie: 0 };
  /** Shells a fine took since the last `set`, by kind: the purse's drop leaps out instead of being lifted. */
  private readonly fined: ShellPurse = { scallop: 0, spiral: 0, horn: 0, cowrie: 0 };
  private nextActionMs = 0;
  private nextShakeMs = 0;
  private flashUntilMs = 0;
  private restS = 0;
  private frame = 0;
  private lastMs = 0;
  private accS = 0;
  private shown = false;
  private flashing = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hud-jar';
    this.el.setAttribute('role', 'img');
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

  /** In sight: out on the screen, or flashing a change. The simulation runs only then. */
  private get visible(): boolean {
    return this.shown || this.flashing;
  }

  /** Out on the screen (on foot on a lay-by, main.ts), or put away. */
  setShown(shown: boolean): void {
    if (shown === this.shown) return;
    const was = this.visible;
    this.shown = shown;
    this.el.classList.toggle('is-shown', shown);
    this.afterVisibility(was);
  }

  /**
   * Shells of these kinds went over the rim of the full jar as new ones came in: called
   * before the `set` that brings the new purse, which pops them out as it pours.
   */
  spill(kinds: readonly ShellKind[]): void {
    if (this.purse === null) return;
    for (const kind of kinds) this.spilled[kind]++;
    if (kinds.length > 0) this.flash();
  }

  /**
   * Shells of these kinds were taken by a fine: called before the `set` that brings the
   * new purse, which has them leap out of the jar rather than be lifted out.
   */
  fine(kinds: readonly ShellKind[]): void {
    if (this.purse === null) return;
    for (const kind of kinds) this.fined[kind]++;
    if (kinds.length > 0) this.flash();
  }

  /** The shells now: the change poured in, lifted out and popped where it can be seen; the first purse laid in settled. */
  set(purse: Readonly<ShellPurse>): void {
    const before = this.purse;
    // Called every frame: nothing changed, nothing to do (and nothing allocated).
    if (before !== null) {
      let same = true;
      for (const kind of SHELL_KINDS) same &&= purse[kind] === before[kind] && this.spilled[kind] === 0 && this.fined[kind] === 0;
      if (same) return;
    }
    this.purse = { ...purse };
    this.el.setAttribute('aria-label', purseWords(purse));
    if (before === null) {
      this.layIn();
      return;
    }
    // Per kind: the spilled ones came in and went out again, so pour them as well as pop
    // them; of what went out, the fined ones leap and the rest (spent) are lifted.
    const pours: ShellKind[] = [];
    const pops: ShellKind[] = [];
    const fines: ShellKind[] = [];
    const takes: ShellKind[] = [];
    for (const kind of SHELL_KINDS) {
      const spilled = this.spilled[kind];
      const net = purse[kind] - before[kind] + spilled;
      const fined = Math.min(this.fined[kind], Math.max(0, -net));
      for (let i = 0; i < Math.max(0, net); i++) pours.push(kind);
      for (let i = 0; i < fined; i++) fines.push(kind);
      for (let i = 0; i < Math.max(0, -net) - fined; i++) takes.push(kind);
      for (let i = 0; i < spilled; i++) pops.push(kind);
      this.spilled[kind] = 0;
      this.fined[kind] = 0;
    }
    if (pours.length + pops.length + fines.length + takes.length === 0) return;
    // The new shells in a mixed handful, as they were paid; then what the full jar loses,
    // then what a fine takes, in the order it took them, then what is spent.
    for (let i = pours.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pours[i], pours[j]] = [pours[j]!, pours[i]!];
    }
    for (const kind of pours) this.ops.push({ t: 'pour', kind });
    for (const kind of pops) this.ops.push({ t: 'pop', kind });
    for (const kind of fines) this.ops.push({ t: 'fine', kind });
    for (const kind of takes) this.ops.push({ t: 'take', kind });
    this.flash();
  }

  dispose(): void {
    this.observer?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** In sight for a change: held `FLASH_HOLD_MS` past the last of it (`tick` lets it go). */
  private flash(): void {
    const was = this.visible;
    this.flashing = true;
    this.flashUntilMs = performance.now() + FLASH_HOLD_MS;
    this.el.classList.add('is-flash');
    this.afterVisibility(was);
  }

  /** Come into sight, the simulation starts; gone out of it, whatever still moved lies down at once. */
  private afterVisibility(was: boolean): void {
    const now = this.visible;
    if (now && !was) {
      this.nextShakeMs = performance.now() + SHAKE_MIN_MS;
      this.wake();
    } else if (!now && was) {
      this.settle();
    }
  }

  private moving(): boolean {
    return this.ops.length > 0 || this.restS < REST_S || this.shells.some((s) => s.popS >= 0 || s.liftS >= 0);
  }

  /** The queue run out at once and the shells settled, unseen. */
  private settle(): void {
    if (this.moving() && this.purse !== null) this.layIn();
  }

  /** The jar filled at once with the purse as it stands, settled: dropped in rows and the simulation run till they lie still. */
  private layIn(): void {
    const purse = this.purse!;
    this.shells.length = 0;
    this.ops.length = 0;
    for (const kind of SHELL_KINDS) this.fined[kind] = 0;
    // Mixed, as they came; in rows from the foot up, each as wide as the belly is at its height.
    const kinds: ShellKind[] = [];
    for (const kind of SHELL_KINDS) for (let i = 0; i < purse[kind]; i++) kinds.push(kind);
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
    }
    let y = FLOOR_Y - WALL / 2 - DIAMETER / 2;
    let half = bellyHalfAt(y, DIAMETER / 2);
    let x = CX - half;
    for (const kind of kinds.slice(0, JAR_CAPACITY)) {
      if (x + DIAMETER > CX + half) {
        y -= DIAMETER;
        half = Math.max(0, bellyHalfAt(y, DIAMETER / 2));
        x = CX - half;
      }
      this.shells.push(this.newShell(kind, x + DIAMETER / 2, y));
      x += DIAMETER * 1.02;
    }
    for (let i = 0; i < 700; i++) this.step();
    for (const s of this.shells) s.vx = s.vy = 0;
    this.restS = REST_S;
    this.draw();
  }

  /** The topmost shell of `kind` lying in the jar, or null. */
  private topmost(kind: ShellKind): Shell | null {
    let top: Shell | null = null;
    for (const s of this.shells) {
      if (s.kind === kind && s.popS < 0 && s.liftS < 0 && (top === null || s.y < top.y)) top = s;
    }
    return top;
  }

  private newShell(kind: ShellKind, x: number, y: number): Shell {
    return {
      kind, r: DIAMETER / 2, x, y, vx: 0, vy: 0, angle: Math.random() * Math.PI * 2, spin: 0,
      popS: -1, fallS: -1, fined: false, liftS: -1, fromX: 0, fromY: 0,
    };
  }

  private wake(): void {
    if (this.frame || !this.visible || typeof requestAnimationFrame === 'undefined') return;
    this.lastMs = performance.now();
    this.accS = 0;
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    if (!this.visible) return;
    this.act(now);
    this.accS += Math.min(0.1, (now - this.lastMs) / 1000);
    this.lastMs = now;
    const moving = this.moving();
    if (moving) {
      while (this.accS >= STEP_S) {
        this.accS -= STEP_S;
        this.step();
      }
      this.draw();
    } else {
      this.accS = 0;
      if (this.flashing && now >= this.flashUntilMs) {
        // All done and held long enough: the flash fades away (hud.css), the jar as it lies.
        this.flashing = false;
        this.el.classList.remove('is-flash');
        if (!this.shown) return;
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  /** The next thing to do, when one is due: an op off the queue, or with none left and all still, a shake. */
  private act(now: number): void {
    if (now < this.nextActionMs) return;
    const op = this.ops.shift();
    if (op === undefined) {
      if (this.shown && !this.moving() && now >= this.nextShakeMs) this.shake(now);
      return;
    }
    this.restS = 0;
    this.flashUntilMs = now + FLASH_HOLD_MS;
    const next = this.ops[0];
    this.nextActionMs = now + (next === undefined || next.t === op.t ? OP_MS[op.t] : SWAP_MS);
    if (op.t === 'pour') {
      const shell = this.newShell(op.kind, CX + (Math.random() - 0.5) * (MOUTH_HALF - DIAMETER / 2), LIP_Y - DIAMETER);
      shell.vy = 4;
      shell.vx = (Math.random() - 0.5) * 1.5;
      this.shells.push(shell);
      return;
    }
    const top = this.topmost(op.kind);
    if (top === null) return;
    if (op.t === 'take') {
      top.liftS = 0;
      top.fromX = top.x;
      top.fromY = top.y;
      top.vx = top.vy = 0;
    } else if (op.t === 'pop') {
      // Up through the mouth: the leap tops out over its middle, then the shell is thrown
      // aside, spinning, and falls past the jar and off it.
      this.leap(top, POP_OVER * (0.8 + Math.random() * 0.4), 6 + Math.random() * 4);
    } else {
      // A fine: the same way out but higher, turning over slowly, greyed; and the jar
      // sags on its foot as it goes.
      top.fined = true;
      this.leap(top, FINE_OVER * (0.9 + Math.random() * 0.2), FINE_SPIN * (0.7 + Math.random() * 0.6));
      this.canvas.animate?.(
        [
          { transform: 'translateY(0)' },
          { transform: `translateY(${FINE_SAG}em) scaleY(0.98)`, offset: 0.3 },
          { transform: 'translateY(0)' },
        ],
        { duration: 360, easing: 'ease-out' },
      );
    }
  }

  /** Sets `top` leaping out of the mouth, its leap topping out `over` em above the lip, spinning at up to `spin` rad/s. */
  private leap(top: Shell, over: number, spin: number): void {
    const rise = top.y - (LIP_Y - over);
    top.popS = 0;
    top.vy = -Math.sqrt(2 * GRAVITY * Math.max(0.5, rise));
    top.vx = (CX - top.x) / (-top.vy / GRAVITY);
    top.spin = (Math.random() < 0.5 ? -1 : 1) * spin;
  }

  /** A little shake: the jar rocks on its foot and the shells are kicked, all a little the same way. */
  private shake(now: number): void {
    this.nextShakeMs = now + SHAKE_MIN_MS + Math.random() * (SHAKE_MAX_MS - SHAKE_MIN_MS);
    const way = Math.random() < 0.5 ? -1 : 1;
    for (const s of this.shells) {
      if (s.popS >= 0 || s.liftS >= 0) continue;
      s.vx += way * SHAKE_KICK * (0.4 + Math.random() * 0.6);
      s.vy -= SHAKE_KICK * Math.random();
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

  private step(): void {
    const list = this.shells;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i]!;
      if (s.liftS >= 0) {
        // Lifted straight up out of the mouth, eased, over everything.
        s.liftS += STEP_S;
        const k = Math.min(1, s.liftS / LIFT_S);
        const e = k * k * (3 - 2 * k);
        s.x = s.fromX + (CX - s.fromX) * e;
        s.y = s.fromY + (LIP_Y - LIFT_OVER - s.fromY) * e;
        if (k >= 1) list.splice(i, 1);
        continue;
      }
      s.vy += GRAVITY * STEP_S;
      s.vx *= 0.996;
      s.vy *= 0.996;
      s.x += s.vx * STEP_S;
      s.y += s.vy * STEP_S;
      if (s.popS >= 0) {
        s.popS += STEP_S;
        s.angle += s.spin * STEP_S;
        if (s.fallS < 0 && s.vy >= 0) {
          s.fallS = 0;
          const side = s.fined ? FINE_SIDE : POP_SIDE;
          s.vx = (Math.random() < 0.5 ? -1 : 1) * side * (0.7 + Math.random() * 0.6);
        } else if (s.fallS >= 0) {
          s.fallS += STEP_S;
          if (s.fallS > (s.fined ? FINE_FALL_S : POP_FALL_S) || s.y - s.r > CANVAS_H) list.splice(i, 1);
        }
      } else {
        s.angle += s.vx * STEP_S * ROLL;
      }
    }
    // A few passes of contacts: shell on shell, then shell on glass.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i]!;
        if (a.popS >= 0 || a.liftS >= 0) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j]!;
          if (b.popS >= 0 || b.liftS >= 0) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const min = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          // One size, one mass: each takes half the overlap and half the impulse.
          const overlap = (min - d) / 2;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
          const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (closing < 0) {
            const impulse = (-(1 + SHELL_BOUNCE) * closing) / 2;
            a.vx -= impulse * nx;
            a.vy -= impulse * ny;
            b.vx += impulse * nx;
            b.vy += impulse * ny;
          }
        }
      }
      for (const s of list) if (s.popS < 0 && s.liftS < 0) this.collideWall(s);
    }
    let fastest = 0;
    for (const s of list) if (s.popS < 0 && s.liftS < 0) fastest = Math.max(fastest, Math.hypot(s.vx, s.vy));
    this.restS = fastest < REST_SPEED ? this.restS + STEP_S : 0;
  }

  private collideWall(b: Shell): void {
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

  /** One shell, turned as it lies, faded by `alpha`; a fined one greyed and dimmed besides. */
  private drawShell(g: CanvasRenderingContext2D, s: Shell, alpha: number): void {
    const half = s.r * SPRITE_OVER;
    g.save();
    g.globalAlpha = s.fined ? alpha * FINE_ALPHA : alpha;
    if (s.fined) g.filter = FINE_FILTER;
    g.translate(s.x, s.y);
    g.rotate(s.angle);
    g.drawImage(shellSprite(s.kind), -half, -half, 2 * half, 2 * half);
    g.restore();
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

    // Its shadow on whatever it stands on, then the glass behind the shells: a faint
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

    // The shells lying in the jar, behind the front glass.
    for (const s of this.shells) if (s.popS < 0 && s.liftS < 0) this.drawShell(g, s, 1);

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

    // The shells on their way out, in front of everything: lifted ones fading as they
    // rise, popped and fined ones fading in the last of their fall.
    for (const s of this.shells) {
      if (s.liftS >= 0) this.drawShell(g, s, 1 - Math.min(1, s.liftS / LIFT_S) ** 2);
      else if (s.popS >= 0) {
        const fall = s.fined ? FINE_FALL_S : POP_FALL_S;
        this.drawShell(g, s, s.fallS < 0 ? 1 : Math.max(0, 1 - Math.max(0, s.fallS - fall * 0.5) / (fall * 0.5)));
      }
    }
  }
}
