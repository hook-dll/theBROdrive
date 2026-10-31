/**
 * Keys and mouse buttons drawn as the things themselves: a keycap with the bound key's
 * legend, a mouse with the button lit. The whispers are written through `writeHint`, so
 * a rebound key shows as the player's own key.
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

function capLabel(code: string): string {
  return CAP_LABEL[code] ?? formatKey(code);
}

export function keycap(code: string): HTMLElement {
  const cap = document.createElement('kbd');
  const label = capLabel(code);
  cap.className = label.length > 2 ? 'tut-key is-wide' : 'tut-key';
  cap.textContent = label;
  return cap;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

type MouseGlyph = 'lmb' | 'rmb' | 'mmb' | 'mouse';

const MOUSE_WORD: Readonly<Record<MouseGlyph, string>> = {
  lmb: 'left mouse button',
  rmb: 'right mouse button',
  mmb: 'middle mouse button',
  mouse: 'the mouse',
};

/**
 * A mouse seen from above, 24×34: the button asked for filled, or arrows either side
 * for "move it" (they sway, `.tut-mouse-arrow`).
 */
export function mouseGlyph(kind: MouseGlyph): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', kind === 'mouse' ? '-11 0 46 34' : '0 0 24 34');
  svg.setAttribute('class', `tut-mouse is-${kind}`);
  svg.setAttribute('aria-label', MOUSE_WORD[kind]);
  svg.innerHTML =
    '<path class="tut-mouse-l" d="M11 2.2 C5.5 2.6 2.4 6.2 2.2 12.4 L11 12.4 Z"/>' +
    '<path class="tut-mouse-r" d="M13 2.2 C18.5 2.6 21.6 6.2 21.8 12.4 L13 12.4 Z"/>' +
    '<path class="tut-mouse-body" d="M2.2 14.2 L21.8 14.2 C21.8 26 18 31.8 12 31.8 C6 31.8 2.2 26 2.2 14.2 Z"/>' +
    '<rect class="tut-mouse-m" x="10.4" y="4.6" width="3.2" height="6.2" rx="1.6"/>' +
    (kind === 'mouse'
      ? '<path class="tut-mouse-arrow" d="M-2 17 L-9 17 M-6 13.5 L-9.5 17 L-6 20.5 M26 17 L33 17 M30 13.5 L33.5 17 L30 20.5"/>'
      : '');
  return svg;
}

/** Four keys as the hand rests on them: one on top, three below. */
function cluster(up: string, left: string, down: string, right: string): HTMLElement {
  const box = document.createElement('span');
  box.className = 'tut-cluster';
  const top = document.createElement('span');
  top.append(keycap(up));
  const row = document.createElement('span');
  row.append(keycap(left), keycap(down), keycap(right));
  box.append(top, row);
  return box;
}

const TOKEN = /\{([a-zA-Z]+)\}/g;

/**
 * Writes a hint into `node`: plain text with `{token}` glyphs. An action token draws its
 * first bound key; `{wasd}` the movement keys as the cluster the hand rests on, `{arrows}`
 * the arrow keys the same way.
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
  if (token === 'lmb' || token === 'rmb' || token === 'mmb' || token === 'mouse') return mouseGlyph(token);
  if (token === 'wasd') {
    return cluster(keys('throttle')[0] ?? 'KeyW', keys('left')[0] ?? 'KeyA', keys('brake')[0] ?? 'KeyS', keys('right')[0] ?? 'KeyD');
  }
  if (token === 'arrows') return cluster('ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight');
  const code = keys(token)[0];
  return code === undefined ? document.createTextNode('(unbound)') : keycap(code);
}
