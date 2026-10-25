import { balls, hasMoney, splitMoney, type Balls } from '../economy/money';

/**
 * THE CALCITE BALLS (economy/money.ts), painted: one sprite per kind, drawn once on a
 * canvas, used by the HUD's DOM (as a background image) and by every canvas that paints
 * game text — the boards (world/market.ts) and the cards (world/cardmachine.ts) — so
 * a price on a card is the same three balls as the money on the HUD.
 *
 * The three kinds differ in size and in colour both, so a lone ball still says which it
 * is: the big one honey calcite, the middle one green, the small one blue. Each carries
 * a faint film of rainbow, the shimmer of the stone (the jar moves it, ui/hudjar.ts),
 * and a dark rim, to stand on the cream card paper as well as on the sky.
 */

export type BallKind = 'big' | 'middle' | 'small';

/** Diameters as a share of the text size they stand in. */
export const BALL_SCALE: Readonly<Record<BallKind, number>> = { big: 1.2, middle: 0.86, small: 0.58 };

const SPRITE_PX = 96;

interface BallLook {
  readonly light: string;
  readonly body: string;
  readonly shade: string;
  readonly edge: string;
  /** The warm glow of light come through the stone, opposite the highlight. */
  readonly glow: string;
}

const LOOKS: Readonly<Record<BallKind, BallLook>> = {
  big: { light: '#fff3d6', body: '#f2b84e', shade: '#c0761b', edge: '#6f420c', glow: 'rgba(255, 205, 120, 0.75)' },
  middle: { light: '#ecfff5', body: '#79d3a4', shade: '#2c8f62', edge: '#18533a', glow: 'rgba(175, 255, 215, 0.7)' },
  small: { light: '#f2f9ff', body: '#8ac2f0', shade: '#3a78ba', edge: '#203f66', glow: 'rgba(195, 228, 255, 0.7)' },
};

const sprites = new Map<BallKind, HTMLCanvasElement>();

/**
 * A ball's shimmer: a band of rainbow across a ball of radius `r` at (x, y), turned to
 * `turn` (0..1 of a full turn). The jar turns it as the light plays (ui/hudjar.ts).
 */
export function shimmer(g: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number): CanvasGradient {
  const a = turn * Math.PI * 2;
  const dx = Math.cos(a) * r;
  const dy = Math.sin(a) * r;
  const band = g.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
  const hues = [330, 40, 90, 170, 220, 280];
  hues.forEach((hue, i) => band.addColorStop(i / (hues.length - 1), `hsl(${hue}, 90%, 62%)`));
  return band;
}

/** The ball of `kind` on a square transparent canvas, `SPRITE_PX` across. */
export function ballSprite(kind: BallKind): HTMLCanvasElement {
  const cached = sprites.get(kind);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SPRITE_PX;
  const g = canvas.getContext('2d')!;
  const look = LOOKS[kind];
  const c = SPRITE_PX / 2;
  const r = c - 2;
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  const body = g.createRadialGradient(c - r * 0.3, c - r * 0.38, r * 0.05, c, c, r);
  body.addColorStop(0, look.light);
  body.addColorStop(0.45, look.body);
  body.addColorStop(0.9, look.shade);
  body.addColorStop(1, look.edge);
  g.fillStyle = body;
  g.fill();
  g.save();
  g.clip();
  // Light through the stone: a soft warm crescent low on the far side.
  const glow = g.createRadialGradient(c + r * 0.3, c + r * 0.42, 0, c + r * 0.3, c + r * 0.42, r * 0.62);
  glow.addColorStop(0, look.glow);
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  // A faint veil across the stone, the cleavage calcite shows inside.
  g.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  g.lineWidth = r * 0.07;
  g.beginPath();
  g.ellipse(c + r * 0.1, c + r * 0.15, r * 0.95, r * 0.42, -0.5, Math.PI * 0.05, Math.PI * 0.8);
  g.stroke();
  // The film of rainbow on the stone.
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.45;
  g.fillStyle = shimmer(g, c, c, r, 0.62);
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.restore();
  // The highlight.
  const spot = g.createRadialGradient(c - r * 0.36, c - r * 0.42, 0, c - r * 0.36, c - r * 0.42, r * 0.3);
  spot.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  spot.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = spot;
  g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  g.beginPath();
  g.arc(c, c, r - 2.5, 0, Math.PI * 2);
  g.strokeStyle = look.edge;
  g.globalAlpha = 0.8;
  g.lineWidth = 5;
  g.stroke();
  sprites.set(kind, canvas);
  return canvas;
}

// ---------------------------------------------------------------------------
// One amount in a row
// ---------------------------------------------------------------------------

/**
 * AN AMOUNT IN A LINE OF TEXT: big balls, then middle, then small, each kind in fives
 * with a little gap after every five so a count reads at a glance, all standing on one
 * floor like balls on a table. In units of the text size.
 */
const ROW_STEP = 1.04;
const ROW_FIVE_GAP = 0.18;
const ROW_KIND_GAP = 0.3;

interface RowBall {
  readonly kind: BallKind;
  /** Left edge, in text sizes from the row's start. */
  readonly x: number;
}

function rowLayout(amount: Balls): { balls: RowBall[]; width: number } {
  const out: RowBall[] = [];
  let x = 0;
  let first = true;
  for (const kind of ['big', 'middle', 'small'] as const) {
    const count = amount[kind];
    if (count === 0) continue;
    if (!first) x += ROW_KIND_GAP;
    first = false;
    const d = BALL_SCALE[kind];
    for (let i = 0; i < count; i++) {
      if (i > 0 && i % 5 === 0) x += ROW_FIVE_GAP * d;
      out.push({ kind, x });
      x += d * (i === count - 1 ? 1 : ROW_STEP);
    }
  }
  return { balls: out, width: x };
}

/** Width of a zero amount (an empty ring), in text sizes. */
const ZERO_RING = BALL_SCALE.small;

// ---------------------------------------------------------------------------
// Canvas text
// ---------------------------------------------------------------------------

function fontPx(g: CanvasRenderingContext2D): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(g.font);
  return match ? Number(match[1]) : 16;
}

/**
 * `g.fillText` for game text: the same arguments and the context's own font, fill,
 * `textAlign` and `textBaseline`, with every money token drawn as balls. Squeezed to
 * `maxWidth` as `fillText` squeezes.
 */
export function fillGameText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number): void {
  if (!hasMoney(text)) {
    if (maxWidth === undefined) g.fillText(text, x, y);
    else g.fillText(text, x, y, maxWidth);
    return;
  }
  const size = fontPx(g);
  const runs = splitMoney(text).map((run) => {
    if ('text' in run) return { run, width: g.measureText(run.text).width, row: null };
    const amount = balls(run.rubles);
    const row = run.rubles === 0 ? { balls: [], width: ZERO_RING } : rowLayout(amount);
    return { run, width: row.width * size, row };
  });
  const total = runs.reduce((sum, r) => sum + r.width, 0);
  const squeeze = maxWidth !== undefined && total > maxWidth ? maxWidth / total : 1;
  const align = g.textAlign;
  const right = align === 'right' || align === 'end';
  let left = align === 'center' ? x - (total * squeeze) / 2 : right ? x - total * squeeze : x;

  // The text's middle, from the baseline in use, and the floor the balls stand on.
  const baseline = g.textBaseline;
  const middle = baseline === 'middle' ? y : baseline === 'top' || baseline === 'hanging' ? y + size * 0.5 : y - size * 0.35;
  const floor = middle + size * 0.42;

  g.save();
  g.textAlign = 'left';
  g.translate(left, 0);
  g.scale(squeeze, 1);
  left = 0;
  for (const { run, width, row } of runs) {
    if ('text' in run) {
      g.fillText(run.text, left, y);
    } else if (row !== null && row.balls.length === 0) {
      const r = (ZERO_RING * size) / 2;
      g.save();
      g.globalAlpha *= 0.5;
      g.strokeStyle = g.fillStyle;
      g.lineWidth = Math.max(1, size * 0.06);
      g.beginPath();
      g.arc(left + r, floor - r, r * 0.85, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    } else if (row !== null) {
      for (const ball of row.balls) {
        const d = BALL_SCALE[ball.kind] * size;
        const bx = left + ball.x * size;
        // The contact shadow, then the ball on it.
        g.save();
        g.fillStyle = 'rgba(30, 22, 12, 0.28)';
        g.beginPath();
        g.ellipse(bx + d * 0.55, floor - d * 0.06, d * 0.45, d * 0.12, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
        g.drawImage(ballSprite(ball.kind), bx, floor - d, d, d);
      }
    }
    left += width;
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// DOM text
// ---------------------------------------------------------------------------

let ballStyleInstalled = false;

/** The sprites as CSS custom properties, once per document (`.ball` in hud.css reads them). */
export function installBallStyle(): void {
  if (ballStyleInstalled || typeof document === 'undefined') return;
  ballStyleInstalled = true;
  const style = document.createElement('style');
  style.textContent = `:root{${(['big', 'middle', 'small'] as const)
    .map((kind) => `--ball-${kind}:url(${ballSprite(kind).toDataURL('image/png')})`)
    .join(';')}}`;
  document.head.appendChild(style);
}

/** One ball as a DOM element, sized by its CSS class in text sizes (hud.css `.ball`). */
export function ballElement(kind: BallKind): HTMLElement {
  const node = document.createElement('i');
  node.className = `ball ball--${kind}`;
  return node;
}

/** An amount as a row of DOM balls (hud.css `.money-row`). */
export function moneyRow(rubles: number): HTMLElement {
  installBallStyle();
  const row = document.createElement('span');
  row.className = 'money-row';
  row.setAttribute('aria-label', `${rubles} rubles`);
  if (rubles <= 0) {
    row.append(ballElement('small'));
    row.classList.add('is-zero');
    return row;
  }
  const amount = balls(rubles);
  for (const kind of ['big', 'middle', 'small'] as const) {
    const count = amount[kind];
    if (count === 0) continue;
    const group = document.createElement('span');
    group.className = 'money-kind';
    for (let i = 0; i < count; i++) {
      const ball = ballElement(kind);
      if (i > 0 && i % 5 === 0) ball.classList.add('is-five');
      group.append(ball);
    }
    row.append(group);
  }
  return row;
}

const shownText = new WeakMap<Element, string>();

/**
 * `node.textContent = text` for game text, with every money token drawn as balls. A
 * no-op when `node` already shows `text`, so it may be called every frame.
 */
export function setGameText(node: HTMLElement, text: string): void {
  if (shownText.get(node) === text) return;
  shownText.set(node, text);
  if (!hasMoney(text)) {
    node.textContent = text;
    return;
  }
  node.replaceChildren(...splitMoney(text).map((run) => ('text' in run ? document.createTextNode(run.text) : moneyRow(run.rubles))));
}
