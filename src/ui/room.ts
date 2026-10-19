import { DREAMS } from '../dreams/dream';
import type { DreamProgress } from '../dreams/progress';

/**
 * THE ROOM: the title screen as the boy's bedroom at night (GAME_DESIGN.md §14.1). One
 * fixed view, a few things in it that answer to the pointer, the keys and a pad:
 *
 * - the bed: sleep, straight into the next dream;
 * - the map on the desk: every dream, to pick one;
 * - the keys on their hook: the saved drives;
 * - the window: the free drive, the endless road outside;
 * - the shelf: a toy car for every dream done;
 * - the toolbox: settings.
 *
 * Drawn as one SVG under plain buttons laid over it in the same frame (a 16:9 box fitted
 * into the screen), so it costs no WebGL context and no shader before the drive, and the
 * buttons stay ordinary focusable rows for the menu's keyboard and pad navigation.
 */

export type RoomSpot = 'bed' | 'map' | 'keys' | 'window' | 'shelf' | 'toolbox';

export interface RoomSpotState {
  /** What it does, said under the room on hover and focus. */
  readonly label: string;
  readonly detail: string;
  readonly disabled: boolean;
}

/** Where each thing is in the 1600 × 900 picture: x, y, width, height. */
const SPOTS: Readonly<Record<RoomSpot, readonly [number, number, number, number]>> = {
  bed: [50, 470, 520, 300],
  toolbox: [925, 640, 150, 105],
  window: [640, 110, 320, 370],
  keys: [985, 235, 70, 135],
  shelf: [1070, 250, 420, 100],
  map: [1070, 505, 420, 110],
};
/** Left to right, the order the arrows walk them. */
const ORDER: readonly RoomSpot[] = ['bed', 'window', 'toolbox', 'keys', 'shelf', 'map'];
/** The toy cars on the shelf, one per dream in the campaign's order. */
const TOY_COLOURS = ['#c8462f', '#3f78b5', '#e0b13a', '#5d9b55', '#8a4fa0', '#e07a32', '#4aa3a0', '#b5b5ad', '#a8342e', '#2f5c8f'];

export interface Room {
  readonly element: HTMLElement;
  /** Focus the bed, or the first live thing. */
  focusFirst(): void;
}

export function buildRoom(
  progress: DreamProgress,
  spots: Readonly<Record<RoomSpot, RoomSpotState>>,
  act: (spot: RoomSpot) => void,
): Room {
  const element = document.createElement('div');
  element.className = 'menu-room';
  const frame = document.createElement('div');
  frame.className = 'menu-room-frame';
  frame.innerHTML = roomSvg(progress);
  const caption = document.createElement('div');
  caption.className = 'menu-room-caption';
  caption.setAttribute('aria-live', 'polite');
  const say = (spot: RoomSpot | null): void => {
    caption.textContent = '';
    if (!spot) return;
    const state = spots[spot];
    const label = document.createElement('span');
    label.className = 'menu-room-caption-label';
    label.textContent = state.label;
    const detail = document.createElement('span');
    detail.className = 'menu-room-caption-detail';
    detail.textContent = state.detail;
    caption.append(label, detail);
  };
  const buttons: HTMLButtonElement[] = [];
  for (const spot of ORDER) {
    const [x, y, w, h] = SPOTS[spot];
    const state = spots[spot];
    const hit = document.createElement('button');
    hit.type = 'button';
    hit.className = `menu-room-spot is-${spot}`;
    hit.dataset.nav = '';
    hit.dataset.key = spot;
    hit.disabled = state.disabled;
    hit.setAttribute('aria-label', `${state.label}: ${state.detail}`);
    hit.style.left = `${(x / 1600) * 100}%`;
    hit.style.top = `${(y / 900) * 100}%`;
    hit.style.width = `${(w / 1600) * 100}%`;
    hit.style.height = `${(h / 900) * 100}%`;
    hit.addEventListener('click', () => act(spot));
    hit.addEventListener('focus', () => say(spot));
    hit.addEventListener('pointerenter', () => say(spot));
    hit.addEventListener('pointerleave', () => say(document.activeElement instanceof HTMLButtonElement ? spotOf(document.activeElement) : null));
    frame.appendChild(hit);
    buttons.push(hit);
  }
  element.append(frame, caption);
  return {
    element,
    focusFirst: () => (buttons.find((b) => !b.disabled) ?? buttons[0])?.focus(),
  };
}

function spotOf(node: HTMLElement): RoomSpot | null {
  const key = node.dataset.key;
  return ORDER.find((spot) => spot === key) ?? null;
}

/** A toy car side on, its nose to the right, standing on y = 0. */
function toyCar(x: number, y: number, colour: string, done: boolean): string {
  const body = done ? colour : 'none';
  const stroke = done ? '#1a120c' : 'rgba(242,232,208,0.28)';
  const dash = done ? '' : ' stroke-dasharray="4 3"';
  return `<g transform="translate(${x} ${y})">
    <path d="M2 -12 L8 -12 L16 -22 L36 -22 L44 -12 L54 -10 L54 -4 L2 -4 Z" fill="${body}" stroke="${stroke}" stroke-width="2"${dash}/>
    <path d="M18 -20 L26 -20 L26 -13 L12 -13 Z M28 -20 L35 -20 L41 -13 L28 -13 Z" fill="${done ? '#9fc3d6' : 'none'}" opacity="0.8"/>
    <circle cx="14" cy="-4" r="5" fill="${done ? '#1a1410' : 'none'}" stroke="${stroke}" stroke-width="2"${dash}/>
    <circle cx="42" cy="-4" r="5" fill="${done ? '#1a1410' : 'none'}" stroke="${stroke}" stroke-width="2"${dash}/>
  </g>`;
}

/** The room, night, the moon through the window, the desk lamp on. */
function roomSvg(progress: DreamProgress): string {
  const done = DREAMS.map((dream) => progress[dream.id] !== undefined);
  const count = DREAMS.length;
  const toys = DREAMS.map((_, i) => {
    const step = 400 / count;
    return toyCar(1080 + i * step + (step - 56) / 2, 336, TOY_COLOURS[i % TOY_COLOURS.length]!, done[i]!);
  }).join('');
  // The map: the road down the paper, a stop per dream, ringed when it is done.
  const stops = DREAMS.map((_, i) => {
    const t = (i + 0.5) / count;
    const x = 1110 + t * 330;
    const y = 552 + Math.sin(t * Math.PI * 2.2) * 14;
    return done[i]
      ? `<circle cx="${x}" cy="${y}" r="7" fill="#5bb57a" stroke="#22361f" stroke-width="2"/>`
      : `<circle cx="${x}" cy="${y}" r="5" fill="#d9c8a5" stroke="#7b5a3a" stroke-width="2"/>`;
  }).join('');
  const road = Array.from({ length: 34 }, (_, i) => {
    const t = i / 33;
    return `${(1110 + t * 330).toFixed(1)},${(552 + Math.sin(t * Math.PI * 2.2) * 14).toFixed(1)}`;
  }).join(' ');
  const stars = [[690, 150], [742, 196], [812, 140], [880, 175], [928, 132], [705, 252], [905, 236], [846, 210]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 2.2 : 1.4}" fill="#f2e8d0" opacity="${0.5 + (i % 4) * 0.12}"/>`)
    .join('');
  return `<svg class="menu-room-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <defs>
    <linearGradient id="room-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1330"/><stop offset="0.72" stop-color="#26385e"/><stop offset="1" stop-color="#4b3a52"/>
    </linearGradient>
    <linearGradient id="room-wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e1a26"/><stop offset="1" stop-color="#2d2433"/>
    </linearGradient>
    <linearGradient id="room-floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a2a1d"/><stop offset="1" stop-color="#1c140d"/>
    </linearGradient>
    <radialGradient id="room-lamp" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffcf87" stop-opacity="0.55"/><stop offset="1" stop-color="#ffcf87" stop-opacity="0"/>
    </radialGradient>
    <pattern id="room-paper" width="40" height="40" patternUnits="userSpaceOnUse">
      <rect width="40" height="40" fill="none"/><path d="M20 0 V40" stroke="#ffffff" stroke-opacity="0.025" stroke-width="10"/>
    </pattern>
  </defs>
  <rect width="1600" height="640" fill="url(#room-wall)"/>
  <rect width="1600" height="640" fill="url(#room-paper)"/>
  <rect y="640" width="1600" height="260" fill="url(#room-floor)"/>
  ${Array.from({ length: 9 }, (_, i) => `<path d="M${-200 + i * 260} 900 L${520 + i * 70} 640" stroke="#120c07" stroke-opacity="0.5" stroke-width="2"/>`).join('')}
  <rect y="628" width="1600" height="14" fill="#241a12"/>

  <!-- the window: the night desert and the road going away -->
  <rect x="628" y="98" width="344" height="394" rx="6" fill="#4a3424"/>
  <rect x="646" y="116" width="308" height="358" fill="url(#room-sky)"/>
  ${stars}
  <circle cx="886" cy="176" r="24" fill="#f4ecd6"/><circle cx="896" cy="170" r="22" fill="#26385e" opacity="0.35"/>
  <path d="M646 390 Q720 372 800 384 T954 378 V474 H646 Z" fill="#3a2b2c"/>
  <path d="M646 418 Q760 396 954 410 V474 H646 Z" fill="#4b3326"/>
  <path d="M770 474 L796 392 L804 392 L830 474 Z" fill="#1f1a1d"/>
  <path d="M800 404 V414 M800 426 V440 M800 452 V472" stroke="#d9c8a5" stroke-width="2.5" opacity="0.7"/>
  <rect x="796" y="116" width="8" height="358" fill="#4a3424"/>
  <rect x="646" y="292" width="308" height="8" fill="#4a3424"/>
  <rect x="618" y="486" width="364" height="16" rx="3" fill="#5a3f2a"/>
  <path d="M600 84 Q636 300 612 520 L660 520 Q682 300 652 84 Z" fill="#6b2f2c" opacity="0.92"/>
  <path d="M1000 84 Q964 300 988 520 L940 520 Q918 300 948 84 Z" fill="#6b2f2c" opacity="0.92"/>
  <rect x="590" y="78" width="420" height="10" rx="4" fill="#2b1d14"/>
  <path d="M646 498 L954 498 L1080 900 L520 900 Z" fill="#9fb6e6" opacity="0.06"/>

  <!-- the bed -->
  <rect x="40" y="430" width="34" height="340" rx="6" fill="#4d3322"/>
  <rect x="60" y="590" width="510" height="120" rx="10" fill="#5a3c27"/>
  <rect x="70" y="560" width="490" height="60" rx="16" fill="#d8cdb4"/>
  <rect x="86" y="532" width="130" height="52" rx="22" fill="#efe6d0"/>
  <path d="M200 560 Q300 528 560 552 L560 640 Q340 650 196 636 Z" fill="#7a3b3a"/>
  <path d="M232 560 L232 640 M292 552 L292 642 M352 548 L352 644 M412 548 L412 644 M472 550 L472 642 M532 552 L532 640" stroke="#5f2a2b" stroke-width="3"/>
  <rect x="540" y="560" width="30" height="210" rx="6" fill="#4d3322"/>
  <rect x="70" y="706" width="16" height="64" fill="#3b2619"/>

  <!-- the toolbox on the floor by the wall, between the window and the desk -->
  <g transform="translate(340 -105)">
    <rect x="598" y="772" width="124" height="58" rx="6" fill="#a8342e"/>
    <rect x="598" y="772" width="124" height="16" rx="5" fill="#c4473d"/>
    <path d="M640 772 V758 H680 V772" stroke="#2a201a" stroke-width="6" fill="none"/>
    <rect x="652" y="796" width="16" height="8" fill="#2a201a"/>
  </g>

  <!-- the keys on their hook -->
  <rect x="992" y="248" width="56" height="20" rx="4" fill="#5a3f2a"/>
  <path d="M1020 268 V284" stroke="#b7a37a" stroke-width="3"/>
  <circle cx="1020" cy="292" r="9" fill="none" stroke="#c9b27a" stroke-width="3"/>
  <path d="M1014 300 L1006 340 L1012 342 L1014 334 L1018 336 L1020 326 L1024 302 Z" fill="#c9b27a"/>
  <rect x="1022" y="300" width="22" height="34" rx="4" fill="#d9c8a5" transform="rotate(12 1033 317)"/>

  <!-- the shelf and its toy cars -->
  <rect x="1068" y="338" width="424" height="12" rx="3" fill="#5a3f2a"/>
  <path d="M1090 350 L1100 372 M1470 350 L1460 372" stroke="#3b2619" stroke-width="6"/>
  ${toys}

  <!-- the desk, the map on it, the lamp -->
  <circle cx="1440" cy="520" r="170" fill="url(#room-lamp)"/>
  <rect x="1060" y="596" width="450" height="22" rx="4" fill="#6a4a30"/>
  <rect x="1080" y="618" width="22" height="210" fill="#4d3322"/>
  <rect x="1468" y="618" width="22" height="210" fill="#4d3322"/>
  <rect x="1300" y="618" width="168" height="110" fill="#5a3c27"/>
  <rect x="1372" y="664" width="24" height="6" rx="3" fill="#2a201a"/>
  <path d="M1086 600 L1100 516 L1452 522 L1456 600 Z" fill="#e3d4ae"/>
  <path d="M1200 518 L1192 600 M1320 520 L1318 600" stroke="#c8b78f" stroke-width="2"/>
  <polyline points="${road}" fill="none" stroke="#b5623a" stroke-width="5" stroke-linecap="round"/>
  ${stops}
  <path d="M1452 596 L1472 596 L1466 470 L1460 470 Z" fill="#3b2a1c"/>
  <path d="M1426 476 L1506 476 L1488 440 L1444 440 Z" fill="#e8b65e"/>
</svg>`;
}
