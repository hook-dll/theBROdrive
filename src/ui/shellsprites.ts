import { hasShells, shellWords, splitShells } from '../economy/shells';

/**
 * THE SHELL (economy/shells.ts), painted: one sprite, drawn once on a canvas, used by the
 * HUD's DOM (as a background image), by the jar (ui/hudjar.ts) and by every canvas that
 * paints game text — the boards (world/market.ts), the cards (world/cardmachine.ts), the
 * toy box (world/toybox.ts) and the race boards (race/visuals.ts) — so a price on a card
 * is the same shell as the ones lying in the jar.
 *
 * The shell is a coral SCALLOP: a fan with ribs running out from its hinge, and a dark
 * rim to stand on the cream card paper as well as on the sky. There is one shell and one
 * picture of it, worth one.
 *
 * An amount is drawn the same way everywhere: its figure and one shell after it, and an
 * amount of none as "0" with the shell faded.
 */

const SPRITE_PX = 96;

interface ShellLook {
  readonly light: string;
  readonly body: string;
  readonly shade: string;
  /** The rim and the drawn lines on the shell. */
  readonly edge: string;
}

const LOOK: ShellLook = { light: '#ffe2d2', body: '#f28a6a', shade: '#c9533b', edge: '#5e2014' };

let sprite: HTMLCanvasElement | null = null;

/** The shell on a square transparent canvas, `SPRITE_PX` across. */
export function shellSprite(): HTMLCanvasElement {
  if (sprite) return sprite;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SPRITE_PX;
  paintScallop(canvas.getContext('2d')!, LOOK);
  sprite = canvas;
  return canvas;
}

/**
 * The shell's round: the outline filled with the body lit from the upper left, the
 * markings clipped inside it, a soft highlight, and the dark rim last.
 */
function paintShell(g: CanvasRenderingContext2D, look: ShellLook, outline: () => void, marks: () => void): void {
  const s = SPRITE_PX;
  const body = g.createLinearGradient(s * 0.2, s * 0.1, s * 0.8, s * 0.95);
  body.addColorStop(0, look.light);
  body.addColorStop(0.45, look.body);
  body.addColorStop(1, look.shade);
  outline();
  g.fillStyle = body;
  g.fill();
  g.save();
  outline();
  g.clip();
  marks();
  const spot = g.createRadialGradient(s * 0.36, s * 0.3, 0, s * 0.36, s * 0.3, s * 0.3);
  spot.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
  spot.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = spot;
  g.fillRect(0, 0, s, s);
  g.restore();
  outline();
  g.strokeStyle = look.edge;
  g.lineWidth = 4.5;
  g.lineJoin = 'round';
  g.stroke();
}

/** THE SCALLOP: a fan from a hinge low in the middle, its edge waved where the ribs end, the two ears either side of the hinge. */
function paintScallop(g: CanvasRenderingContext2D, look: ShellLook): void {
  const s = SPRITE_PX;
  const hx = s / 2;
  const hy = s * 0.84;
  const reach = s * 0.7;
  const ribs = 7;
  const from = Math.PI * 1.17;
  const to = Math.PI * 1.83;
  const outline = (): void => {
    g.beginPath();
    // The ears: a little square shoulder each side of the hinge.
    g.moveTo(hx - s * 0.17, hy + s * 0.06);
    g.lineTo(hx + s * 0.17, hy + s * 0.06);
    g.lineTo(hx + s * 0.17, hy - s * 0.06);
    const steps = ribs * 12;
    for (let i = 0; i <= steps; i++) {
      const a = to - (i / steps) * (to - from);
      // Each rib ends in a bump: the wave of the edge.
      const wave = Math.abs(Math.sin((i / steps) * ribs * Math.PI));
      const r = reach * (0.93 + 0.07 * wave);
      g.lineTo(hx + Math.cos(a) * r, hy + Math.sin(a) * r);
    }
    g.lineTo(hx - s * 0.17, hy - s * 0.06);
    g.closePath();
  };
  paintShell(g, look, outline, () => {
    // The ribs, from the hinge out to the bumps of the edge, light on their crowns.
    for (let i = 0; i < ribs; i++) {
      const a = from + ((i + 0.5) / ribs) * (to - from);
      for (const [width, colour, shift] of [
        [6, look.shade, -0.04],
        [3, look.light, 0.03],
      ] as const) {
        g.strokeStyle = colour;
        g.globalAlpha = 0.75;
        g.lineWidth = width;
        g.beginPath();
        g.moveTo(hx, hy);
        g.lineTo(hx + Math.cos(a + shift) * reach, hy + Math.sin(a + shift) * reach);
        g.stroke();
      }
    }
    // The furrows between, drawn dark.
    g.globalAlpha = 0.6;
    g.strokeStyle = look.edge;
    g.lineWidth = 1.6;
    for (let i = 1; i < ribs; i++) {
      const a = from + (i / ribs) * (to - from);
      g.beginPath();
      g.moveTo(hx, hy);
      g.lineTo(hx + Math.cos(a) * reach, hy + Math.sin(a) * reach);
      g.stroke();
    }
    // Growth lines across the fan.
    g.globalAlpha = 0.25;
    for (const k of [0.45, 0.65, 0.82]) {
      g.beginPath();
      g.arc(hx, hy, reach * k, from, to);
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

// ---------------------------------------------------------------------------
// Canvas text
// ---------------------------------------------------------------------------

/** The shell's size in a line of text, in text sizes; the gap between the figure and the shell. */
const ROW_SHELL = 1.15;
const FIGURE_GAP = 0.08;

function fontPx(g: CanvasRenderingContext2D): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(g.font);
  return match ? Number(match[1]) : 16;
}

/**
 * `g.fillText` for game text: the same arguments and the context's own font, fill,
 * `textAlign` and `textBaseline`, with every shell token drawn as its figure and the
 * shell. Squeezed to `maxWidth` as `fillText` squeezes.
 */
export function fillGameText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number): void {
  if (!hasShells(text)) {
    if (maxWidth === undefined) g.fillText(text, x, y);
    else g.fillText(text, x, y, maxWidth);
    return;
  }
  const size = fontPx(g);
  const d = ROW_SHELL * size;
  const runs = splitShells(text).map((run) => {
    if ('text' in run) return { text: run.text, width: g.measureText(run.text).width, faded: false, figureW: 0 };
    const figure = String(run.shells);
    const figureW = g.measureText(figure).width + FIGURE_GAP * size;
    return { text: figure, width: figureW + d, faded: run.shells <= 0, figureW };
  });
  const total = runs.reduce((sum, r) => sum + r.width, 0);
  const squeeze = maxWidth !== undefined && total > maxWidth ? maxWidth / total : 1;
  const align = g.textAlign;
  const right = align === 'right' || align === 'end';
  const start = align === 'center' ? x - (total * squeeze) / 2 : right ? x - total * squeeze : x;

  // The text's middle, from the baseline in use, and the floor the shell lies on.
  const baseline = g.textBaseline;
  const middle = baseline === 'middle' ? y : baseline === 'top' || baseline === 'hanging' ? y + size * 0.5 : y - size * 0.35;
  const floor = middle + size * 0.5;

  g.save();
  g.textAlign = 'left';
  g.translate(start, 0);
  g.scale(squeeze, 1);
  let left = 0;
  for (const run of runs) {
    g.fillText(run.text, left, y);
    if (run.figureW > 0) {
      const sx = left + run.figureW;
      g.save();
      if (run.faded) g.globalAlpha *= 0.35;
      // The contact shadow, then the shell on it.
      g.fillStyle = 'rgba(30, 22, 12, 0.25)';
      g.beginPath();
      g.ellipse(sx + d * 0.5, floor - d * 0.06, d * 0.42, d * 0.1, 0, 0, Math.PI * 2);
      g.fill();
      g.drawImage(shellSprite(), sx, floor - d, d, d);
      g.restore();
    }
    left += run.width;
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// DOM text
// ---------------------------------------------------------------------------

let shellStyleInstalled = false;

/** The sprite as a CSS custom property, once per document (`.shell` in hud.css reads it). */
export function installShellStyle(): void {
  if (shellStyleInstalled || typeof document === 'undefined') return;
  shellStyleInstalled = true;
  const style = document.createElement('style');
  style.textContent = `:root{--shell:url(${shellSprite().toDataURL('image/png')})}`;
  document.head.appendChild(style);
}

/** An amount as its figure and a DOM shell (hud.css `.shell-row`), read out in words. */
export function shellRow(count: number): HTMLElement {
  installShellStyle();
  const row = document.createElement('span');
  row.className = 'shell-row';
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', shellWords(count));
  if (count <= 0) row.classList.add('is-zero');
  const figure = document.createElement('span');
  figure.className = 'shell-figure';
  figure.textContent = String(count);
  const shell = document.createElement('i');
  shell.className = 'shell';
  row.append(figure, shell);
  return row;
}

const shownText = new WeakMap<Element, string>();

/**
 * `node.textContent = text` for game text, with every shell token drawn as its figure and
 * the shell. A no-op when `node` already shows `text`, so it may be called every frame.
 */
export function setGameText(node: HTMLElement, text: string): void {
  if (shownText.get(node) === text) return;
  shownText.set(node, text);
  if (!hasShells(text)) {
    node.textContent = text;
    return;
  }
  node.replaceChildren(...splitShells(text).map((run) => ('text' in run ? document.createTextNode(run.text) : shellRow(run.shells))));
}
