import { hasShells, priceWords, SHELL_KINDS, splitShells, type ShellKind, type ShellPrice } from '../economy/shells';

/**
 * THE SHELLS (economy/shells.ts), painted: one sprite per kind, drawn once on a canvas,
 * used by the HUD's DOM (as a background image), by the jar (ui/hudjar.ts) and by every
 * canvas that paints game text — the boards (world/market.ts), the cards
 * (world/cardmachine.ts) and the toy box (world/toybox.ts) — so a price on a card is the
 * same shells as the ones lying in the jar.
 *
 * All four kinds are worth the same, so what tells them apart has to be read at a glance
 * by a child who cannot read: the SHAPE first and the colour second. The scallop is a
 * coral fan with ribs running out from its hinge; the spiral a golden snail coiled round
 * on itself; the horn a long cream turret tapering to a point, banded in rust; the cowrie
 * a glossy brown egg with a toothed slit down its belly. Each carries a dark rim, to stand
 * on the cream card paper as well as on the sky.
 *
 * A price is drawn the same way everywhere: up to five shells as that many shells in a
 * row, more than five as the figure and one shell (a row of thirty is not read, it is
 * counted), and nothing at all — a price of none — as one faded shell.
 */

const SPRITE_PX = 96;

/** The most shells a price is drawn as one by one; past it, the figure and one shell. */
const ROW_MAX = 5;

interface ShellLook {
  readonly light: string;
  readonly body: string;
  readonly shade: string;
  /** The rim and the drawn lines on the shell. */
  readonly edge: string;
}

const LOOKS: Readonly<Record<ShellKind, ShellLook>> = {
  scallop: { light: '#ffe2d2', body: '#f28a6a', shade: '#c9533b', edge: '#5e2014' },
  spiral: { light: '#fff1c4', body: '#e7b54a', shade: '#a86d1e', edge: '#4f300a' },
  horn: { light: '#fffaf0', body: '#efd9b0', shade: '#c79a5e', edge: '#55331a' },
  cowrie: { light: '#fbe3c0', body: '#b9733b', shade: '#7a3f1a', edge: '#3a1a08' },
};

const sprites = new Map<ShellKind, HTMLCanvasElement>();

/** The shell of `kind` on a square transparent canvas, `SPRITE_PX` across. */
export function shellSprite(kind: ShellKind): HTMLCanvasElement {
  const cached = sprites.get(kind);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SPRITE_PX;
  const g = canvas.getContext('2d')!;
  if (kind === 'scallop') paintScallop(g, LOOKS.scallop);
  else if (kind === 'spiral') paintSpiral(g, LOOKS.spiral);
  else if (kind === 'horn') paintHorn(g, LOOKS.horn);
  else paintCowrie(g, LOOKS.cowrie);
  sprites.set(kind, canvas);
  return canvas;
}

/**
 * The round of every kind: the outline filled with the body lit from the upper left,
 * the kind's own markings clipped inside it, a soft highlight, and the dark rim last.
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

/** THE SPIRAL: a snail's shell from the side, a round whorl coiled in on itself, its mouth open at the lower right. */
function paintSpiral(g: CanvasRenderingContext2D, look: ShellLook): void {
  const s = SPRITE_PX;
  const cx = s * 0.47;
  const cy = s * 0.5;
  const r = s * 0.42;
  const outline = (): void => {
    g.beginPath();
    g.arc(cx, cy, r, Math.PI * 0.3, Math.PI * 2.1);
    // The lip of the mouth stands out a little past the round.
    g.quadraticCurveTo(cx + r * 1.15, cy + r * 0.55, cx + r * 0.62, cy + r * 0.92);
    g.closePath();
  };
  paintShell(g, look, outline, () => {
    // The coil: a spiral in from the rim, drawn as a groove with a light ridge beside it.
    const turns = 2.6;
    const coil = (offset: number): void => {
      g.beginPath();
      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        const a = -Math.PI * 0.4 + k * turns * Math.PI * 2;
        const rr = r * (0.95 - 0.88 * k) + offset;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    g.lineCap = 'round';
    g.strokeStyle = look.shade;
    g.lineWidth = 7;
    g.globalAlpha = 0.7;
    coil(-3);
    g.strokeStyle = look.light;
    g.lineWidth = 3;
    coil(2);
    g.strokeStyle = look.edge;
    g.lineWidth = 2.4;
    g.globalAlpha = 0.9;
    coil(-1);
    // The dark of the mouth.
    g.globalAlpha = 0.8;
    g.fillStyle = look.edge;
    g.beginPath();
    g.ellipse(cx + r * 0.62, cy + r * 0.58, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  });
}

/** THE HORN: a long turret, its whorls stacked and narrowing to a sharp tip at the upper right, the mouth at the lower left. */
function paintHorn(g: CanvasRenderingContext2D, look: ShellLook): void {
  const s = SPRITE_PX;
  const whorls = 6;
  const length = s * 0.98;
  const base = s * 0.19;
  // Laid along the diagonal: local y runs from the mouth (0) to the tip (length).
  const ang = -Math.PI / 4;
  const ox = s * 0.17;
  const oy = s * 0.83;
  const at = (side: number, along: number): [number, number] => {
    const lx = side;
    const ly = along;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    // Local +y points along the diagonal toward the upper right.
    return [ox + ly * c - lx * sn, oy + ly * sn + lx * c];
  };
  const halfAt = (along: number): number => base * (1 - along / length);
  const outline = (): void => {
    g.beginPath();
    const steps = whorls * 8;
    // Up one side, each whorl bulging a little, round the tip, and down the other.
    for (const side of [1, -1]) {
      for (let i = 0; i <= steps; i++) {
        const k = side === 1 ? i / steps : 1 - i / steps;
        const along = k * length;
        const bulge = 1 + 0.12 * Math.sin((k * whorls % 1) * Math.PI);
        const [x, y] = at(side * halfAt(along) * bulge, along);
        if (side === 1 && i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    }
    g.closePath();
  };
  paintShell(g, look, outline, () => {
    // The sutures between the whorls, slanted, each with a rust band above it.
    for (let i = 1; i < whorls; i++) {
      const along = (i / whorls) * length;
      const half = halfAt(along) * 1.1;
      const [x0, y0] = at(-half, along - half * 0.25);
      const [x1, y1] = at(half, along + half * 0.25);
      g.strokeStyle = '#b5532a';
      g.globalAlpha = 0.55;
      g.lineWidth = Math.max(2, half * 0.35);
      const [bx0, by0] = at(-half, along - half * 0.25 + half * 0.35);
      const [bx1, by1] = at(half, along + half * 0.25 + half * 0.35);
      g.beginPath();
      g.moveTo(bx0, by0);
      g.lineTo(bx1, by1);
      g.stroke();
      g.strokeStyle = look.edge;
      g.globalAlpha = 0.85;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    // The mouth's dark opening.
    const [mx, my] = at(0, base * 0.2);
    g.globalAlpha = 0.85;
    g.fillStyle = look.edge;
    g.beginPath();
    g.ellipse(mx, my, base * 0.85, base * 0.42, ang, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  });
}

/** THE COWRIE: a glossy egg lying on its side, speckled, with the long toothed slit of its mouth down the middle. */
function paintCowrie(g: CanvasRenderingContext2D, look: ShellLook): void {
  const s = SPRITE_PX;
  const cx = s / 2;
  const cy = s / 2;
  const rx = s * 0.45;
  const ry = s * 0.33;
  const tilt = -0.3;
  const outline = (): void => {
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, tilt, 0, Math.PI * 2);
  };
  paintShell(g, look, outline, () => {
    g.save();
    g.translate(cx, cy);
    g.rotate(tilt);
    // The speckles of its back, on the upper half.
    g.fillStyle = look.light;
    g.globalAlpha = 0.55;
    const dots: ReadonlyArray<readonly [number, number, number]> = [
      [-0.55, -0.45, 0.07], [-0.25, -0.6, 0.06], [0.1, -0.55, 0.08], [0.45, -0.42, 0.06],
      [-0.4, -0.2, 0.05], [0.25, -0.25, 0.05], [0.65, -0.15, 0.05], [-0.7, -0.05, 0.04],
    ];
    for (const [x, y, d] of dots) {
      g.beginPath();
      g.arc(x * rx, y * ry, d * s, 0, Math.PI * 2);
      g.fill();
    }
    // The slit: a dark wavy groove along the length, low of the middle.
    const slitY = ry * 0.3;
    const slitX = rx * 0.78;
    g.globalAlpha = 0.95;
    g.strokeStyle = look.edge;
    g.lineCap = 'round';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-slitX, slitY);
    g.bezierCurveTo(-slitX * 0.3, slitY + ry * 0.1, slitX * 0.3, slitY - ry * 0.1, slitX, slitY);
    g.stroke();
    // Its teeth: light ticks across the slit, both lips.
    g.strokeStyle = look.light;
    g.lineWidth = 2;
    const teeth = 9;
    for (let i = 0; i < teeth; i++) {
      const k = (i + 0.5) / teeth;
      const x = -slitX + k * 2 * slitX;
      const y = slitY + Math.sin(k * Math.PI * 2) * ry * -0.06;
      g.beginPath();
      g.moveTo(x, y - ry * 0.16);
      g.lineTo(x, y - ry * 0.05);
      g.moveTo(x, y + ry * 0.05);
      g.lineTo(x, y + ry * 0.16);
      g.stroke();
    }
    g.restore();
    // The gloss: a hard bright streak along the back.
    g.globalAlpha = 0.7;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3.5;
    g.lineCap = 'round';
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.72, ry * 0.62, tilt, Math.PI * 1.15, Math.PI * 1.55);
    g.stroke();
    g.globalAlpha = 1;
  });
}

// ---------------------------------------------------------------------------
// One price in a row
// ---------------------------------------------------------------------------

/** A shell's size in a line of text, in text sizes; the step from one to the next; the gap after a figure. */
const ROW_SHELL = 1.15;
const ROW_STEP = 0.98;
const FIGURE_GAP = 0.12;

/** How a price is drawn: `shells` sprites in a row, after the figure when there is one. */
interface PriceLook {
  readonly shells: number;
  readonly figure: string | null;
  readonly faded: boolean;
}

function priceLook(price: ShellPrice): PriceLook {
  if (price.count <= 0) return { shells: 1, figure: null, faded: true };
  if (price.count <= ROW_MAX) return { shells: price.count, figure: null, faded: false };
  return { shells: 1, figure: String(price.count), faded: false };
}

// ---------------------------------------------------------------------------
// Canvas text
// ---------------------------------------------------------------------------

function fontPx(g: CanvasRenderingContext2D): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(g.font);
  return match ? Number(match[1]) : 16;
}

/**
 * `g.fillText` for game text: the same arguments and the context's own font, fill,
 * `textAlign` and `textBaseline`, with every price token drawn as shells. Squeezed to
 * `maxWidth` as `fillText` squeezes.
 */
export function fillGameText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number): void {
  if (!hasShells(text)) {
    if (maxWidth === undefined) g.fillText(text, x, y);
    else g.fillText(text, x, y, maxWidth);
    return;
  }
  const size = fontPx(g);
  const runs = splitShells(text).map((run) => {
    if ('text' in run) return { run, width: g.measureText(run.text).width, look: null, figureW: 0 };
    const look = priceLook(run.price);
    const figureW = look.figure === null ? 0 : g.measureText(look.figure).width + FIGURE_GAP * size;
    // The shells overlap a little: each after the first steps on by `ROW_STEP` of one.
    return { run, width: figureW + (1 + (look.shells - 1) * ROW_STEP) * ROW_SHELL * size, look, figureW };
  });
  const total = runs.reduce((sum, r) => sum + r.width, 0);
  const squeeze = maxWidth !== undefined && total > maxWidth ? maxWidth / total : 1;
  const align = g.textAlign;
  const right = align === 'right' || align === 'end';
  const start = align === 'center' ? x - (total * squeeze) / 2 : right ? x - total * squeeze : x;

  // The text's middle, from the baseline in use, and the floor the shells lie on.
  const baseline = g.textBaseline;
  const middle = baseline === 'middle' ? y : baseline === 'top' || baseline === 'hanging' ? y + size * 0.5 : y - size * 0.35;
  const floor = middle + size * 0.5;
  const d = ROW_SHELL * size;

  g.save();
  g.textAlign = 'left';
  g.translate(start, 0);
  g.scale(squeeze, 1);
  let left = 0;
  for (const { run, width, look, figureW } of runs) {
    if ('text' in run) {
      g.fillText(run.text, left, y);
    } else if (look !== null) {
      if (look.figure !== null) g.fillText(look.figure, left, y);
      const sprite = shellSprite(run.price.kind);
      g.save();
      if (look.faded) g.globalAlpha *= 0.35;
      for (let i = 0; i < look.shells; i++) {
        const sx = left + figureW + i * d * ROW_STEP;
        // The contact shadow, then the shell on it.
        g.fillStyle = 'rgba(30, 22, 12, 0.25)';
        g.beginPath();
        g.ellipse(sx + d * 0.5, floor - d * 0.06, d * 0.42, d * 0.1, 0, 0, Math.PI * 2);
        g.fill();
        g.drawImage(sprite, sx, floor - d, d, d);
      }
      g.restore();
    }
    left += width;
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// DOM text
// ---------------------------------------------------------------------------

let shellStyleInstalled = false;

/** The sprites as CSS custom properties, once per document (`.shell` in hud.css reads them). */
export function installShellStyle(): void {
  if (shellStyleInstalled || typeof document === 'undefined') return;
  shellStyleInstalled = true;
  const style = document.createElement('style');
  style.textContent = `:root{${SHELL_KINDS.map((kind) => `--shell-${kind}:url(${shellSprite(kind).toDataURL('image/png')})`).join(';')}}`;
  document.head.appendChild(style);
}

/** A price as a row of DOM shells (hud.css `.shell-row`), read out in words. */
export function shellRow(price: ShellPrice): HTMLElement {
  installShellStyle();
  const look = priceLook(price);
  const row = document.createElement('span');
  row.className = 'shell-row';
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', priceWords(price));
  if (look.faded) row.classList.add('is-zero');
  if (look.figure !== null) {
    const figure = document.createElement('span');
    figure.className = 'shell-figure';
    figure.textContent = look.figure;
    row.append(figure);
  }
  for (let i = 0; i < look.shells; i++) {
    const shell = document.createElement('i');
    shell.className = `shell shell--${price.kind}`;
    row.append(shell);
  }
  return row;
}

const shownText = new WeakMap<Element, string>();

/**
 * `node.textContent = text` for game text, with every price token drawn as shells. A
 * no-op when `node` already shows `text`, so it may be called every frame.
 */
export function setGameText(node: HTMLElement, text: string): void {
  if (shownText.get(node) === text) return;
  shownText.set(node, text);
  if (!hasShells(text)) {
    node.textContent = text;
    return;
  }
  node.replaceChildren(...splitShells(text).map((run) => ('text' in run ? document.createTextNode(run.text) : shellRow(run.price))));
}
