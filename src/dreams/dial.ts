/**
 * A rotary dial: the goal terminal's PIN entry (dreams/terminal.ts).
 *
 * A finger plate with ten holes over a ring of printed digits. Put the pointer in a
 * hole, drag the plate clockwise until the hole meets the finger stop, let go: the
 * plate runs back and the digit is dialled. Let go short of the stop and nothing is
 * dialled, as on the real thing. A wrong digit clears the number; six right ones open
 * the window. Digit keys dial too (the plate turns on its own); Escape hangs up.
 *
 * Plain SVG over the canvas: no program, no texture, nothing for the GPU to link.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Plate geometry in the SVG's own units (viewBox −160..160). */
const RING_R = 108;
const HOLE_R = 19;
/** The finger stop, degrees clockwise from twelve o'clock: about four o'clock. */
const STOP_DEG = 120;
/** Holes 30° apart; hole k (1..9, 10 for 0) rests at STOP − 30k and travels 30k to the stop. */
const STEP_DEG = 30;
/** Released this close to the stop still counts, degrees. */
const STOP_TOLERANCE_DEG = 7;
/** How fast the plate runs back, degrees per second: about a tenth of a second per digit step. */
const RETURN_DEG_PER_S = 330;
/** Self-dial speed for a digit key, degrees per second. */
const KEY_DIAL_DEG_PER_S = 420;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** Hole index (1..10) for a digit character. */
function holeOf(digit: string): number {
  return digit === '0' ? 10 : Number(digit);
}

/** Point on a circle, `deg` clockwise from twelve o'clock. */
function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

export type DialResult = 'opened' | 'hung-up';

/**
 * Opens the dial over `root` and resolves when the PIN is dialled or the player hangs
 * up. One at a time; the caller pauses the game around it.
 */
export function dialPin(root: HTMLElement, pin: string): Promise<DialResult> {
  const { promise, resolve } = Promise.withResolvers<DialResult>();
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:12px;background:rgba(14,12,9,0.62);pointer-events:auto;user-select:none;touch-action:none;' +
    'font:15px/1.4 system-ui,sans-serif;color:#efe6d2';
  const display = document.createElement('div');
  display.style.cssText = 'font:700 30px/1 ui-monospace,monospace;letter-spacing:6px;min-height:34px';
  const hint = document.createElement('div');
  hint.textContent = 'Dial the PIN from the parcel label — drag a hole round to the stop. Esc hangs up.';
  const status = document.createElement('div');
  status.style.cssText = 'min-height:20px;color:#f0b48a';

  const face = svg('svg', { viewBox: '-160 -160 320 320', width: 320, height: 320 });
  face.style.cssText = 'cursor:grab;max-width:80vw;max-height:60vh';
  // The printed digits, fixed under the plate: hole k's digit shows through hole k at rest.
  face.append(svg('circle', { r: 150, fill: '#262019', stroke: '#5b4d3c', 'stroke-width': 4 }));
  for (let k = 1; k <= 10; k++) {
    const [x, y] = polar(RING_R, STOP_DEG - STEP_DEG * k);
    face.append(svg('circle', { cx: x, cy: y, r: HOLE_R - 2, fill: '#f2ead8' }));
    const label = svg('text', { x, y: y + 7, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 700, fill: '#2a2218' });
    label.textContent = String(k % 10);
    face.append(label);
  }
  // The plate: a ring with holes, turning about the centre.
  const plate = svg('g', {});
  const ring = svg('path', { fill: 'rgba(170,150,120,0.92)', 'fill-rule': 'evenodd', stroke: '#3d3328', 'stroke-width': 2 });
  let d = 'M 0 -140 A 140 140 0 1 1 0 140 A 140 140 0 1 1 0 -140 Z M 0 -70 A 70 70 0 1 0 0 70 A 70 70 0 1 0 0 -70 Z';
  for (let k = 1; k <= 10; k++) {
    const [x, y] = polar(RING_R, STOP_DEG - STEP_DEG * k);
    d += ` M ${x} ${y - HOLE_R} A ${HOLE_R} ${HOLE_R} 0 1 0 ${x} ${y + HOLE_R} A ${HOLE_R} ${HOLE_R} 0 1 0 ${x} ${y - HOLE_R} Z`;
  }
  ring.setAttribute('d', d);
  plate.append(ring, svg('circle', { r: 54, fill: '#efe6d2', stroke: '#3d3328', 'stroke-width': 2 }));
  face.append(plate);
  // The finger stop, outside the ring at four o'clock.
  {
    const [x0, y0] = polar(RING_R + 4, STOP_DEG + 14);
    const [x1, y1] = polar(150, STOP_DEG + 14);
    face.append(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: '#c9c1ad', 'stroke-width': 8, 'stroke-linecap': 'round' }));
  }
  overlay.append(display, face, hint, status);
  root.appendChild(overlay);

  let entered = '';
  /** Current clockwise turn of the plate, degrees. */
  let turn = 0;
  /** The hole held (1..10), or 0 with the plate free. */
  let held = 0;
  /** Pointer angle at the last move while held, degrees. */
  let lastAngle = 0;
  /** A digit key's hole while the plate dials itself, else 0. */
  let autoHole = 0;
  let frame = 0;
  let lastTime = 0;
  let done = false;

  const showDisplay = (): void => {
    display.textContent = Array.from({ length: pin.length }, (_, i) => entered[i] ?? '_').join('');
  };
  showDisplay();
  const pose = (): void => plate.setAttribute('transform', `rotate(${turn})`);

  const pointerAngle = (ev: PointerEvent): number => {
    const box = face.getBoundingClientRect();
    const x = ev.clientX - (box.left + box.width / 2);
    const y = ev.clientY - (box.top + box.height / 2);
    return (Math.atan2(x, -y) * 180) / Math.PI;
  };

  const finish = (result: DialResult): void => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    window.removeEventListener('keydown', onKey, true);
    overlay.remove();
    resolve(result);
  };

  /** A digit reached the stop: compare it, and run the number on. */
  const dialled = (hole: number): void => {
    const digit = String(hole % 10);
    if (digit !== pin[entered.length]) {
      entered = '';
      status.textContent = 'Wrong number — the line clicks dead. Dial again.';
    } else {
      entered += digit;
      status.textContent = '';
    }
    showDisplay();
    if (entered === pin) {
      status.textContent = 'The window unlocks.';
      window.setTimeout(() => finish('opened'), 450);
    }
  };

  /** The plate's own motion: running back after a release, or turning for a key. */
  const tick = (time: number): void => {
    const dt = lastTime === 0 ? 0 : Math.min(0.05, (time - lastTime) / 1000);
    lastTime = time;
    if (autoHole !== 0) {
      turn = Math.min(STEP_DEG * autoHole, turn + KEY_DIAL_DEG_PER_S * dt);
      if (turn >= STEP_DEG * autoHole) {
        dialled(autoHole);
        autoHole = 0;
      }
    } else if (held === 0) {
      turn = Math.max(0, turn - RETURN_DEG_PER_S * dt);
    }
    pose();
    frame = turn > 0 || autoHole !== 0 ? requestAnimationFrame(tick) : 0;
    if (frame === 0) lastTime = 0;
  };
  const run = (): void => {
    if (frame === 0) frame = requestAnimationFrame(tick);
  };

  face.addEventListener('pointerdown', (ev) => {
    if (done || held !== 0 || autoHole !== 0 || turn > 0.5) return;
    const box = face.getBoundingClientRect();
    const scale = 320 / box.width;
    const x = (ev.clientX - (box.left + box.width / 2)) * scale;
    const y = (ev.clientY - (box.top + box.height / 2)) * scale;
    for (let k = 1; k <= 10; k++) {
      const [hx, hy] = polar(RING_R, STOP_DEG - STEP_DEG * k);
      if (Math.hypot(x - hx, y - hy) <= HOLE_R) {
        held = k;
        lastAngle = pointerAngle(ev);
        face.setPointerCapture(ev.pointerId);
        face.style.cursor = 'grabbing';
        return;
      }
    }
  });
  face.addEventListener('pointermove', (ev) => {
    if (held === 0) return;
    const angle = pointerAngle(ev);
    // Shortest signed step, so crossing six o'clock does not jump a full turn.
    const step = ((angle - lastAngle + 540) % 360) - 180;
    lastAngle = angle;
    // Clockwise only, and no further than the stop.
    turn = Math.min(STEP_DEG * held, Math.max(0, turn + step));
    pose();
  });
  const release = (): void => {
    if (held === 0) return;
    if (turn >= STEP_DEG * held - STOP_TOLERANCE_DEG) dialled(held);
    held = 0;
    face.style.cursor = 'grab';
    run();
  };
  face.addEventListener('pointerup', release);
  face.addEventListener('pointercancel', release);

  const onKey = (ev: KeyboardEvent): void => {
    ev.stopPropagation();
    if (ev.code === 'Escape') {
      ev.preventDefault();
      finish('hung-up');
      return;
    }
    if (/^[0-9]$/.test(ev.key) && held === 0 && autoHole === 0 && turn <= 0.5) {
      autoHole = holeOf(ev.key);
      run();
    }
  };
  window.addEventListener('keydown', onKey, true);
  return promise;
}
