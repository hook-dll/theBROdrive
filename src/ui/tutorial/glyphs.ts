/**
 * Keys and mouse buttons drawn as the things themselves: a keycap with the bound key's
 * legend, a mouse with the button lit. Every presenter writes its hints through
 * `writeHint`, so a rebound key shows as the player's own key everywhere.
 */
import { formatKey } from '../../core/input';

/** The live bindings: every key code bound to an action, first the main one. */
export type KeyCodes = (action: string) => readonly string[];

const CAP_LABEL: Readonly<Record<string, string>> = {
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
  AltLeft: 'Alt', AltRight: 'Alt', Space: 'Space', Enter: 'Enter', Tab: 'Tab', CapsLock: 'Caps',
  Backspace: 'Bksp', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backslash: '\\',
  BracketLeft: '[', BracketRight: ']',
};

export function capLabel(code: string): string {
  return CAP_LABEL[code] ?? formatKey(code);
}

export function keycap(code: string): HTMLElement {
  const cap = document.createElement('kbd');
  const label = capLabel(code);
  cap.className = label.length > 2 ? 'tut-key is-wide' : 'tut-key';
  cap.dataset.code = code;
  cap.textContent = label;
  return cap;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export type MouseGlyph = 'lmb' | 'rmb' | 'mmb' | 'mouse' | 'wheel';

/**
 * A mouse seen from above, 24×34: the button asked for filled, or arrows either side
 * for "move it". The shape is one path per part so CSS can light any of them.
 */
export function mouseGlyph(kind: MouseGlyph): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', kind === 'mouse' ? '-10 0 44 34' : '0 0 24 34');
  svg.setAttribute('class', `tut-mouse is-${kind}`);
  svg.setAttribute('aria-label', MOUSE_WORD[kind]);
  svg.innerHTML =
    '<path class="tut-mouse-l" d="M11 2.2 C5.5 2.6 2.4 6.2 2.2 12.4 L11 12.4 Z"/>' +
    '<path class="tut-mouse-r" d="M13 2.2 C18.5 2.6 21.6 6.2 21.8 12.4 L13 12.4 Z"/>' +
    '<path class="tut-mouse-body" d="M2.2 14.2 L21.8 14.2 C21.8 26 18 31.8 12 31.8 C6 31.8 2.2 26 2.2 14.2 Z"/>' +
    '<rect class="tut-mouse-m" x="10.4" y="4.6" width="3.2" height="6.2" rx="1.6"/>' +
    (kind === 'mouse'
      ? '<path class="tut-mouse-arrow" d="M-2 17 L-8 17 M-5.5 14 L-8.5 17 L-5.5 20 M26 17 L32 17 M29.5 14 L32.5 17 L29.5 20"/>'
      : '') +
    (kind === 'wheel' ? '<path class="tut-mouse-arrow" d="M12 -0.5 L12 1.2 M12 12.2 L12 13.6"/>' : '');
  return svg;
}

const MOUSE_WORD: Readonly<Record<MouseGlyph, string>> = {
  lmb: 'left mouse button',
  rmb: 'right mouse button',
  mmb: 'middle mouse button',
  mouse: 'the mouse',
  wheel: 'the mouse wheel',
};

const TOKEN = /\{([a-zA-Z]+)\}/g;

/**
 * Writes a hint into `node`: plain text with `{token}` glyphs (lessons.ts `Lesson.hint`).
 * An action token draws its first bound key; `{wasd}` the four movement keys as the
 * cluster the hand rests on.
 */
export function writeHint(node: HTMLElement, hint: string, keys: KeyCodes): void {
  node.replaceChildren();
  let last = 0;
  for (const match of hint.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) node.append(hint.slice(last, at));
    node.append(glyph(match[1] ?? '', keys));
    last = at + match[0].length;
  }
  if (last < hint.length) node.append(hint.slice(last));
}

function glyph(token: string, keys: KeyCodes): Node {
  if (token === 'lmb' || token === 'rmb' || token === 'mmb' || token === 'mouse' || token === 'wheel') {
    return mouseGlyph(token);
  }
  if (token === 'wasd') {
    const cluster = document.createElement('span');
    cluster.className = 'tut-cluster';
    const top = document.createElement('span');
    top.append(keycap(keys('throttle')[0] ?? 'KeyW'));
    const row = document.createElement('span');
    row.append(keycap(keys('left')[0] ?? 'KeyA'), keycap(keys('brake')[0] ?? 'KeyS'), keycap(keys('right')[0] ?? 'KeyD'));
    cluster.append(top, row);
    return cluster;
  }
  const code = keys(token)[0];
  if (code === undefined) return document.createTextNode('(unbound)');
  const cap = keycap(code);
  cap.dataset.action = token;
  return cap;
}

/** The keyboard the manual draws: the letter block, the punctuation the game uses, Space. */
const KEYBOARD_ROWS: readonly (readonly string[])[] = [
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'],
  ['ShiftLeft', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period'],
  ['Space'],
];

/**
 * A small keyboard with the keys of `actions` lit, each lit key numbered by the order
 * of `actions` so a legend beside it can name them. Keys bound off the drawn block
 * (arrows, a rebinding elsewhere) are simply not lit; the legend still names them.
 */
export function keyboardDiagram(actions: readonly string[], keys: KeyCodes): HTMLElement {
  const lit = new Map<string, number>();
  actions.forEach((action, i) => {
    for (const code of keys(action)) {
      const drawn = code === 'ShiftRight' ? 'ShiftLeft' : code;
      if (!lit.has(drawn)) lit.set(drawn, i + 1);
    }
  });
  const board = document.createElement('div');
  board.className = 'tut-board';
  KEYBOARD_ROWS.forEach((row, r) => {
    const line = document.createElement('div');
    line.className = `tut-board-row is-row${r}`;
    for (const code of row) {
      const cap = keycap(code);
      const n = lit.get(code);
      if (n !== undefined) {
        cap.classList.add('is-lit');
        cap.dataset.n = String(n);
      }
      if (code === 'Space') cap.classList.add('is-space');
      line.append(cap);
    }
    board.append(line);
  });
  return board;
}

/**
 * A car from above, nose up, its working panels outlined and lettered: the manual's
 * page on the outside of a car. `lit` names the parts to ink in the accent.
 */
export function carDiagram(lit: ReadonlySet<'bonnet' | 'boot' | 'doors' | 'flap' | 'mirrors'>): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 240 300');
  svg.setAttribute('class', 'tut-car');
  const on = (part: string): string => (lit.has(part as never) ? ' is-lit' : '');
  svg.innerHTML =
    // Body and glass.
    '<path class="tut-car-body" d="M84 30 Q120 18 156 30 L166 70 L168 236 Q166 272 120 278 Q74 272 72 236 L74 70 Z"/>' +
    '<path class="tut-car-glass" d="M86 100 Q120 90 154 100 L150 128 L90 128 Z"/>' +
    '<path class="tut-car-glass" d="M92 214 L148 214 L152 236 Q120 244 88 236 Z"/>' +
    // Bonnet.
    `<path class="tut-car-part${on('bonnet')}" d="M86 36 Q120 26 154 36 L160 92 Q120 84 80 92 Z"/>` +
    // Boot.
    `<path class="tut-car-part${on('boot')}" d="M84 244 Q120 252 156 244 L160 238 Q164 266 120 272 Q76 266 80 238 Z"/>` +
    // Doors.
    `<path class="tut-car-part${on('doors')}" d="M75 132 L86 132 L86 176 L75 176 Z M75 180 L86 180 L86 214 L75 214 Z"/>` +
    `<path class="tut-car-part${on('doors')}" d="M165 132 L154 132 L154 176 L165 176 Z M165 180 L154 180 L154 214 L165 214 Z"/>` +
    // Mirrors.
    `<path class="tut-car-part${on('mirrors')}" d="M74 118 L60 112 L60 122 L74 126 Z M166 118 L180 112 L180 122 L166 126 Z"/>` +
    // Fuel flap, rear right quarter.
    `<circle class="tut-car-part${on('flap')}" cx="163" cy="226" r="5"/>` +
    // Callouts.
    '<g class="tut-car-callouts">' +
    '<path d="M120 58 L120 8"/><text x="120" y="6" text-anchor="middle">bonnet</text>' +
    '<path d="M120 262 L120 292"/><text x="120" y="298" text-anchor="middle">boot</text>' +
    '<path d="M75 156 L28 156"/><text x="26" y="152" text-anchor="end" class="is-small">door</text>' +
    '<path d="M60 116 L30 96"/><text x="28" y="94" text-anchor="end" class="is-small">mirror</text>' +
    '<path d="M168 226 L212 246"/><text x="214" y="252" class="is-small">fuel flap</text>' +
    '</g>';
  return svg;
}

/** The pedal lever's notches, top to bottom, for the cruise page. */
export function leverDiagram(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 220 200');
  svg.setAttribute('class', 'tut-lever');
  const rows = [
    ['80 %', 'tap'], ['60 %', 'tap'], ['40 %', 'tap'], ['20 %', 'first tap'], ['neutral', ''], ['brake', 'hold'],
  ] as const;
  let body = '<rect class="tut-lever-slot" x="34" y="14" width="14" height="172" rx="7"/>';
  rows.forEach(([label, how], i) => {
    const y = 26 + i * 30;
    const cls = i === 5 ? ' is-brake' : i === 4 ? ' is-neutral' : '';
    body +=
      `<path class="tut-lever-tick${cls}" d="M28 ${y} L54 ${y}"/>` +
      `<text class="tut-lever-label${cls}" x="64" y="${y + 5}">${label}</text>` +
      (how ? `<text class="tut-lever-how" x="210" y="${y + 5}" text-anchor="end">${how}</text>` : '');
  });
  body += '<circle class="tut-lever-knob" cx="41" cy="86" r="9"/>';
  svg.innerHTML = body;
  return svg;
}
