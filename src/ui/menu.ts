import type { DriveSummary, SaveBackend, SaveListing, SaveMeta } from '../save/save';
import type { WorldState } from '../game/state';
import { BINDABLE_ACTIONS, isSystemControlCode } from '../core/input';
import { gamepads, PAD } from '../core/gamepad';
import {
  DAY_CYCLE_MAX_MINUTES,
  DAY_CYCLE_MIN_MINUTES,
  DEFAULT_MOUSE_SENSITIVITY,
  DASHBOARD_SIZE_MAX,
  DASHBOARD_SIZE_MIN,
  DASHBOARD_SIZE_STEP,
  CONTROLLER_DEADZONE_MAX,
  CONTROLLER_DEADZONE_MIN,
  CONTROLLER_DEADZONE_STEP,
  CONTROLLER_STEER_MAX,
  CONTROLLER_STEER_MIN,
  CONTROLLER_STEER_STEP,
  CONTROLLER_VIBRATION_STEP,
  FIELD_OF_VIEW_MAX,
  FIELD_OF_VIEW_MIN,
  MOUSE_SENSITIVITY_MAX,
  MOUSE_SENSITIVITY_MIN,
  FRAME_RATE_LIMITS,
  RETRO_LINE_CHOICES,
  TIME_OF_DAY_PRESETS,
} from '../game/settings';
import type {
  ComputeLevel,
  GraphicsQuality,
  GraphicsQualitySource,
  Settings,
  TimeOfDayPreset,
} from '../game/settings';
import {
  GRAPHICS_TIERS,
  DEFAULT_SETTINGS,
  TRAFFIC_CAPS,
  viewDistanceFor,
  loadStoredSettings,
  storeSettings,
  withTierDefaults,
} from '../game/settings';
import { RADIO_RECOMMENDATIONS } from '../audio/radio';
import {
  manualRenderScale,
  offeredRenderScales,
  prefersMobilePresentation,
  renderScaleFor,
} from '../core/renderer';
import { buildProfileFor, retroPixelRatio } from '../render/retro';
import type { SpawnRequest } from '../game/spawn';
import { CAR_MODELS } from '../vehicle/carmodels';
import { CAR_PAINTS } from '../vehicle/carpaint';
import { ALL_VARIANTS } from '../parts/registry';
import { CAMERA_FRAME_LIMIT, type FluidKind, type ShadeTint } from '../items/items';
import { STICKERS, type StickerKind } from '../items/stickercatalog';

/** The Compute rows' buttons, lightest first; see `ComputeLevel`. */
const COMPUTE_LEVELS: readonly { level: ComputeLevel; label: string }[] = [
  { level: 'very_low', label: 'Very Low' },
  { level: 'low', label: 'Low' },
  { level: 'medium', label: 'Medium' },
  { level: 'high', label: 'High' },
];
const HORIZON_ICONS: Record<ComputeLevel, string> = {
  very_low: 'horizon1',
  low: 'horizon2',
  medium: 'horizon3',
  high: 'horizon4',
};
const TRAFFIC_ICONS: Record<ComputeLevel, string> = {
  very_low: 'retro',
  low: 'gfx1',
  medium: 'gfx2',
  high: 'gfx3',
};

/**
 * Title screen and pause overlay. Plain DOM, no framework. Each call owns the
 * overlay it creates: `show` removes the title screen before resolving and
 * `showPause`/`hidePause` manage the pause overlay's lifecycle.
 *
 * Both are one SHEET docked to the right edge over the scene, built from the same few
 * parts: a screen title, big action rows, drive cards led by a kilometre post, and the
 * settings controls. menu.css holds the type scale and palette they all share.
 */

function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

/**
 * What a detail level means, spelled out from the rung's own numbers.
 *
 * Read out of `GRAPHICS_TIERS` rather than written here, so a label cannot describe a
 * tier the player is not getting. That drift is exactly how the old menu came to
 * promise a horizon change "applies on resume" while a light-source change silently
 * waited for the next load: two halves of one rung described in two places, and only
 * one of them true.
 *
 * PIXELS ARE DELIBERATELY ABSENT. The rung still carries a ceiling, but `Sharpness` is
 * the control that names a resolution and quotes it as one — and two rows quoting the
 * same number is the same drift in a new place: a manual sharpness makes the rung's
 * ceiling irrelevant, and this line would go on claiming it.
 */
function describeTier(quality: GraphicsQuality, mobilePresentation: boolean): string {
  const tier = GRAPHICS_TIERS[quality];
  // Read as the presentation in front of the player will actually get it. A phone is
  // handed different numbers for the shadow pass and the light slots, and a label
  // quoting the desktop column at a phone would be describing a rung nobody is on.
  const shadows = mobilePresentation ? tier.mobileShadows : tier.shadows;
  const spots = mobilePresentation ? tier.mobileVehicleLightSlots : tier.vehicleLightSlots;
  const light = buildProfileFor(quality) === 'light';
  return (
    `${shadows ? 'Sun shadows' : 'No sun shadows'}, ` +
    `${spots} lights shaded on every lit pixel. ` +
    `Stars to magnitude ${mobilePresentation ? tier.mobileStarMagnitude : tier.starMagnitude}. ` +
    (light
      ? 'Lighter ground cover, plants and open desert, as on Very Low: under half the '
        + 'triangles of Medium. Switching between Low and Medium or High saves the drive '
        + 'and reloads it.'
      : 'Full ground cover. The light count is compiled into the world, so between Medium '
        + 'and High it changes on the next load.')
  );
}

function formatHorizon(metres: number): string {
  return metres >= 1000 ? `${Math.round(metres / 1000)} km` : `${metres} m`;
}

function button(cls: string, label: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.className = cls;
  node.type = 'button';
  node.textContent = label;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Stroked 24x24 glyphs, as raw path data.
 *
 * Inline paths rather than an icon font or image files: they inherit `currentColor`,
 * so a selected control's glyph brightens with its text for free, and there is
 * nothing to load, cache or fail. Every glyph is strokes only (no fills) at a single
 * width, which is what keeps sixteen unrelated shapes looking like one set.
 *
 * They exist to carry the AXIS of a control at a glance — three bars for a quality
 * tier, three receding ridges for a horizon, a sun climbing and setting for the time
 * of day. The words next to them confirm; the shapes are what you navigate by.
 */
const ICONS: Record<string, readonly string[]> = {
  drive: [
    'M3 16l2-6h14l2 6v2h-3M3 18v-2M8 18h8',
    'M8 18a1.6 1.6 0 1 0-3.2 0 1.6 1.6 0 0 0 3.2 0z',
    'M19.2 18a1.6 1.6 0 1 0-3.2 0 1.6 1.6 0 0 0 3.2 0z',
  ],
  display: ['M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z', 'M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z'],
  sound: ['M4 9h3l5-4v14l-5-4H4z', 'M16 9.5a4 4 0 0 1 0 5'],
  controls: ['M3 7h18v10H3z', 'M6 11h1M9 11h1M12 11h1M15 11h1M18 11h1M8 14h8'],
  gameplay: ['M4 3v18', 'M4 5h12l-2 4 2 4H4z'],
  manual: ['M12 20V9', 'M12 9l-4-4M12 9l4-4', 'M13.6 7.4a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z'],
  auto: ['M13 3l-6 10h4l-1 8 7-12h-4z'],
  keys: ['M3 7h18v10H3z', 'M7 11h1M11 11h1M15 11h1M9 14h6'],
  mouse: ['M9 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z', 'M12 7v4'],
  /** A staircase of square steps: the retro rung's whole-pixel look. */
  retro: ['M4 19h5v-5h5v-5h6'],
  gfx1: ['M5 18v-3'],
  gfx2: ['M5 18v-3M12 18v-7'],
  gfx3: ['M5 18v-3M12 18v-7M19 18v-11'],
  /**
   * A framed grid, for a control whose axis is PIXELS rather than quality: the render
   * scale row is the one place in this menu where the player is naming a resolution.
   */
  pixels: ['M4 5h16v14H4z', 'M4 12h16M12 5v14'],
  /** A view cone from the eye, for the field of view. */
  fov: ['M5 12l15-7', 'M5 12l15 7', 'M5 12h5'],
  horizon1: ['M3 16h18'],
  horizon2: ['M3 16h18M6 12h12'],
  horizon3: ['M3 16h18M6 12h12M9 8h6'],
  horizon4: ['M3 16h18M6 12h12M9 8h6M11 4h2'],
  /** A processor die, for the Compute tab. */
  compute: ['M7 7h10v10H7z', 'M10 10h4v4h-4z', 'M9 4v3M15 4v3M9 17v3M15 17v3M4 9h3M4 15h3M17 9h3M17 15h3'],
  morning: ['M15 15a3 3 0 1 0-6 0', 'M3 18h18', 'M12 7v3M9.5 9.5 11 11M14.5 9.5 13 11'],
  noon: ['M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z', 'M12 3v2M12 19v2M3 12h2M19 12h2'],
  evening: ['M15 15a3 3 0 1 0-6 0', 'M3 18h18', 'M12 10V7M10.5 8.5 12 10l1.5-1.5'],
  midnight: ['M15 3a8 8 0 1 0 5.6 9.6A6.4 6.4 0 0 1 15 3z'],
  clock: ['M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z', 'M12 7.5V12l3 2'],
  /** Hills under a sun, for the world's own sound. */
  world: ['M2 19l6-7 4 4 3-3 7 6z', 'M17.5 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'],
  radio: ['M3 10h18v9H3z', 'M8 6.5l9-2.5', 'M7 14h4', 'M17 14h.01'],
  /** A bouncing wave, for the Yaris-mode toggle. */
  bounce: ['M3 18c2-8 4-8 6 0s4-8 6 0 4-8 6 0'],
  back: ['M14.5 5.5 8 12l6.5 6.5'],
  /** A game controller: two grips, a D-pad and two face buttons. */
  gamepad: [
    'M7.5 8h9a5 5 0 0 1 5 5.4l-.3 2.6a1.8 1.8 0 0 1-3.3.8L16 14H8l-1.9 2.8a1.8 1.8 0 0 1-3.3-.8L2.5 13.4A5 5 0 0 1 7.5 8z',
    'M7 11.5v2M6 12.5h2M15.5 12h.01M17.5 13.5h.01',
  ],
  /**
   * A camera path that curves: the axis of the camera-style control. Straight would be
   * steady, so the glyph is the departure from it.
   */
  cameraStyle: ['M4 19c4 0 4-12 8-12s5 12 8 12', 'M12 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
  trash: ['M4.5 7h15', 'M9.5 7V4.5h5V7', 'M6.5 7l1 12.5h9l1-12.5', 'M10.5 10.5v6M13.5 10.5v6'],
};

/** One glyph, sized by CSS. Decorative: the control's own text is the label. */
function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'menu-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] ?? []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function formatPlayed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** In-game clock, 24-hour, from a fraction of the day. */
function formatClock(dayFraction: number): string {
  const minutes = Math.floor(dayFraction * 24 * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The sun's place in the sky as one of the time-of-day glyphs. */
function clockIcon(dayFraction: number): string {
  const hour = dayFraction * 24;
  if (hour >= 5 && hour < 8.5) return 'morning';
  if (hour >= 8.5 && hour < 17) return 'noon';
  if (hour >= 17 && hour < 20.5) return 'evening';
  return 'midnight';
}

/**
 * Distance on a kilometre post: tenths while the number is short, whole kilometres once
 * it has three digits, so the post never has to grow.
 */
function formatKm(km: number): string {
  return km < 100 ? km.toFixed(1) : String(Math.floor(km));
}

const SAVED_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const SAVED_DATE_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const SAVED_TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** When a save was written, in the words a person uses: Today, Yesterday, 12 Sep. */
function formatSavedDay(savedAt: number, now = Date.now()): string {
  const day = (t: number): number => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(savedAt)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(savedAt).getFullYear() === new Date(now).getFullYear()
    ? SAVED_DATE.format(savedAt)
    : SAVED_DATE_YEAR.format(savedAt);
}

function text(content: string, cls?: string): HTMLElement {
  const node = el('span', cls);
  node.textContent = content;
  return node;
}

const HEAT_HAZE_ID = 'menu-heat-haze';
/** Height of one noise tile, px: the air climbs one of these per `HAZE_RISE`. */
const HAZE_BAND = 160;
/** Six bands per tile at about 27 px each, so roughly two and a half bands a second. */
const HAZE_RISE = '2.4s';

/**
 * The game's name, with the joke in it: the word that shimmers is not `Mirage` but
 * `Voyage`. Mirage stands solid as a road sign; the journey is the thing that wavers
 * in the heat, with a faint inverted copy hanging above it — a superior mirage, which
 * is the kind that shows over the horizon rather than on the road.
 *
 * The shimmer is an SVG displacement over noise that RISES, horizontal bands of hot air
 * climbing through the letters the way they climb off a road at noon: each band bends
 * the word sideways as it passes, so the wobble travels up the word instead of breathing
 * in place. It runs only while the title screen exists.
 */
function wordmark(): HTMLElement {
  const mark = el('h1', 'menu-wordmark');
  mark.setAttribute('aria-label', 'Voyage Mirage');

  const svgNode = (tag: string, attrs: Record<string, string>): SVGElement => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  };
  const svg = svgNode('svg', { class: 'menu-wordmark-defs', 'aria-hidden': 'true' });
  const filter = svgNode('filter', { id: HEAT_HAZE_ID, x: '-4%', y: '-10%', width: '108%', height: '120%' });
  // Wide, flat noise: bands of air, not grain. Softened, so an edge bends instead of
  // tearing; and only its red channel is used, so the letters slide sideways and never
  // up or down — which is how a shimmer over hot ground moves.
  //
  // The noise is one stitched tile, `HAZE_BAND` tall, so it repeats seamlessly; tiled
  // over the word and slid up by exactly one tile per loop, the air rises for ever with
  // no jump at the seam. A single offset would drag a bare strip in behind it, so two
  // copies a tile apart are merged: where one has moved off, the other has arrived.
  const noise = svgNode('feTurbulence', {
    type: 'fractalNoise',
    baseFrequency: `0.002 ${6 / HAZE_BAND}`,
    numOctaves: '1',
    seed: '7',
    stitchTiles: 'stitch',
    x: '0',
    y: '0',
    width: '1024',
    height: String(HAZE_BAND),
    result: 'tile',
  });
  const rising = (from: number, result: string): SVGElement => {
    const offset = svgNode('feOffset', { in: 'air', dy: String(from), result });
    offset.appendChild(
      svgNode('animate', {
        attributeName: 'dy',
        values: `${from};${from - HAZE_BAND}`,
        dur: HAZE_RISE,
        repeatCount: 'indefinite',
      }),
    );
    return offset;
  };
  const low = rising(0, 'low');
  const high = rising(HAZE_BAND, 'high');
  const merge = svgNode('feMerge', {});
  merge.append(svgNode('feMergeNode', { in: 'low' }), svgNode('feMergeNode', { in: 'high' }));
  filter.append(
    noise,
    svgNode('feTile', { in: 'tile', result: 'air' }),
    low,
    high,
    merge,
    svgNode('feGaussianBlur', { stdDeviation: '10 3' }),
    svgNode('feColorMatrix', {
      type: 'matrix',
      values: '1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 1',
    }),
    svgNode('feDisplacementMap', {
      in: 'SourceGraphic',
      scale: '14',
      xChannelSelector: 'R',
      yChannelSelector: 'G',
    }),
  );
  svg.appendChild(filter);

  const voyage = text('Voyage', 'menu-wordmark-voyage');
  voyage.dataset.text = 'Voyage';
  mark.append(svg, voyage, text('Mirage', 'menu-wordmark-mirage'));
  return mark;
}

/**
 * A roadside kilometre post, white with a painted cap, carrying the drive's distance.
 *
 * Distance is the one number every drive has and no two share, so it is the thing the
 * eye lands on first in a list of saves; the post is how the desert road itself writes it.
 */
function milestone(km: number): HTMLElement {
  const post = el('span', 'menu-milestone');
  post.setAttribute('role', 'img');
  post.setAttribute('aria-label', `${formatKm(km)} km`);
  post.append(text(formatKm(km), 'menu-milestone-value'), text('km', 'menu-milestone-unit'));
  return post;
}

/**
 * The two lines that tell one drive from another: the car, in its own colour, and the
 * in-game day and hour. `meta` adds the played time and names a car that no longer
 * summarises; the pause sheet has no meta and shows the live drive.
 */
function driveFacts(drive: DriveSummary | null, meta: SaveMeta | null): HTMLElement {
  const facts = el('span', 'menu-facts');
  const car = el('span', 'menu-facts-car');
  if (drive?.paintHex != null) {
    const swatch = el('span', 'menu-paint-dot');
    swatch.style.background = `#${drive.paintHex.toString(16).padStart(6, '0')}`;
    car.appendChild(swatch);
  }
  car.appendChild(text(drive?.carLabel ?? meta?.name ?? 'On foot', 'menu-facts-car-name'));
  facts.appendChild(car);

  const line = el('span', 'menu-facts-line');
  if (drive) {
    line.append(
      icon(clockIcon(drive.dayFraction)),
      text(`Day ${drive.dayIndex + 1}, ${formatClock(drive.dayFraction)}`),
    );
  }
  if (meta) {
    if (drive) line.appendChild(text('·', 'menu-facts-sep'));
    line.appendChild(text(`${formatPlayed(meta.playedSeconds)} played`));
  }
  facts.appendChild(line);
  return facts;
}

/**
 * One row of a menu's main list: big, left-aligned, the whole width of the sheet.
 * `detail` is a second line under the label, for Continue to say what it continues.
 */
function actionButton(label: string, detail: string | null, primary: boolean): HTMLButtonElement {
  const node = button(primary ? 'menu-action is-primary' : 'menu-action', '');
  node.dataset.nav = '';
  node.appendChild(text(label, 'menu-action-label'));
  if (detail) node.appendChild(text(detail, 'menu-action-detail'));
  return node;
}

/** A sub-screen's title bar: Back, then the name of where you are. */
function screenHead(title: string, onBack: () => void): { head: HTMLElement; back: HTMLButtonElement } {
  const head = el('div', 'menu-screen-head');
  const back = button('menu-button menu-back', '');
  back.append(icon('back'), text('Back'));
  back.addEventListener('click', onBack);
  const name = el('h1', 'menu-screen-title');
  name.textContent = title;
  head.append(back, name);
  return { head, back };
}

/**
 * Up and down walk the sheet's rows, the way a game menu is expected to: every row
 * that takes part carries `data-nav`, in document order.
 */
function walkRows(container: HTMLElement, ev: KeyboardEvent): void {
  const step = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
  if (step === 0) return;
  const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-nav]:not(:disabled)'));
  if (rows.length === 0) return;
  ev.preventDefault();
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = at < 0 ? (step > 0 ? 0 : rows.length - 1) : (at + step + rows.length) % rows.length;
  rows[next]!.focus();
}

type DriveLayout = 'FWD' | 'RWD' | 'AWD';

const DRIVE_LAYOUTS: readonly { readonly id: DriveLayout; readonly label: string }[] = [
  { id: 'FWD', label: 'FWD — front-wheel drive' },
  { id: 'RWD', label: 'RWD — rear-wheel drive' },
  { id: 'AWD', label: 'AWD — all-wheel drive' },
];

/**
 * What the dev fluid dispenser offers. Capacities mirror `FLUID_STOCK` in
 * world/poi.ts so a dev-spawned can behaves exactly like a found one.
 */
const DEV_FLUIDS: readonly { readonly fluid: FluidKind; readonly capacity: number }[] = [
  { fluid: 'petrol', capacity: 20 },
  { fluid: 'water', capacity: 5 },
  { fluid: 'oil', capacity: 5 },
];

export type DevSpawnItemRequest =
  | { readonly type: 'fluid_can'; readonly fluid: FluidKind; readonly capacity: number }
  | { readonly type: 'spray_can'; readonly paint: number }
  | { readonly type: 'bubble_gum' }
  | { readonly type: 'medicine' }
  | { readonly type: 'binoculars' }
  | { readonly type: 'torchlight' }
  | { readonly type: 'sun_shades'; readonly tint: ShadeTint }
  | { readonly type: 'camera' }
  | { readonly type: 'football' }
  | { readonly type: 'pocket_watch' }
  | { readonly type: 'postcard' }
  | { readonly type: 'sticker_envelope'; readonly stickerKind: StickerKind };

function driveLayout(rearDriveBias: number): DriveLayout {
  if (rearDriveBias <= 0) return 'FWD';
  if (rearDriveBias >= 1) return 'RWD';
  return 'AWD';
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** How long the pause sheet's save row says `Saved` before it reads `Save drive` again. */
const SAVE_ANSWER_MS = 1600;

/* ---- gamepad navigation for an open menu ---- */

/**
 * Everything the pad may land on inside a menu, in document order.
 *
 * Not `[data-nav]`: that attribute marks the rows of the LIST screens, and the
 * settings panes are ordinary form controls — range sliders, text fields, buttons —
 * which a player on a pad has exactly the same business with as one on a mouse.
 */
const FOCUSABLE_SELECTOR =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Left-stick travel at which a menu counts the stick as a direction. */
const NAV_STICK_THRESHOLD = 0.55;
/** Hold delays for a held direction: move once, then repeat; see `moveFocus`. */
const NAV_REPEAT_DELAY_MS = 380;
const NAV_REPEAT_MS = 110;

/**
 * Moves focus one control in a direction, by GEOMETRY rather than document order.
 *
 * The menus are several layouts in one sheet — a vertical list of rows, a settings
 * pane of rows that each hold a horizontal row of options, a rail down the left — and
 * document order only describes one of them. Picking the nearest control whose centre
 * lies in the direction of travel is the same rule for all of them: down walks the
 * rows, left and right walk the options inside the focused row, and the rail is
 * reachable by the same leftward step.
 */
function moveFocus(root: HTMLElement, dx: number, dy: number): void {
  const items: HTMLElement[] = [];
  for (const node of Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))) {
    if (node.offsetParent !== null) items.push(node);
  }
  if (items.length === 0) return;
  const current = document.activeElement;
  if (!(current instanceof HTMLElement) || !items.includes(current)) {
    items[0]?.focus();
    return;
  }
  // A range input owns its own left and right: stepping the control is what the
  // player is asking for, and moving focus away from it would make a slider the one
  // thing a pad cannot change.
  if (
    (dx !== 0) &&
    current instanceof HTMLInputElement &&
    current.type === 'range'
  ) {
    if (dx < 0) current.stepDown();
    else current.stepUp();
    // The control's own listeners are on `input`, and only a real event runs them.
    current.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const from = current.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const item of items) {
    if (item === current) continue;
    const rect = item.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const along = dx !== 0 ? (cx - fx) * dx : (cy - fy) * dy;
    if (along <= 1) continue;
    const across = dx !== 0 ? Math.abs(cy - fy) : Math.abs(cx - fx);
    // Nearest in the direction of travel wins, with the cross-axis distance as a
    // penalty so a step never jumps a column sideways to reach a nearer row.
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  (best ?? current).focus();
}

/**
 * Drives an open menu with the pad: the D-pad and left stick move focus, A activates
 * what is focused, B backs out and Start is the sheet's own key. Returns the function
 * that detaches it, which the caller must run when the overlay closes.
 *
 * A poll, not events: the Gamepad API has no button events, and this loop is
 * animation-framed like everything else the overlay does. `isCapturing` is the one
 * exception the sheet needs — while the player is recording a new key binding the pad
 * is switched off entirely, so a hand resting on a stick cannot navigate out from
 * under the capture or bind itself to an action.
 */
function attachPadNavigation(
  root: HTMLElement,
  onBack: () => void,
  onStart: (() => void) | null,
  isCapturing: () => boolean,
): () => void {
  const hub = gamepads();
  const held = { up: false, down: false, left: false, right: false, confirm: false, back: false, start: false };
  const repeatAt = { up: 0, down: 0, left: 0, right: 0 };
  let animation = 0;
  let stopped = false;

  // Defined once, not per frame: this holds the repeat state for one direction.
  const step = (
    active: boolean,
    wasActive: boolean,
    direction: 'up' | 'down' | 'left' | 'right',
    dx: number,
    dy: number,
    nowMs: number,
  ): void => {
    if (!active) {
      held[direction] = false;
      return;
    }
    if (!wasActive) {
      held[direction] = true;
      repeatAt[direction] = nowMs + NAV_REPEAT_DELAY_MS;
      moveFocus(root, dx, dy);
      return;
    }
    if (nowMs >= repeatAt[direction]) {
      repeatAt[direction] = nowMs + NAV_REPEAT_MS;
      moveFocus(root, dx, dy);
    }
  };

  const frame = (): void => {
    if (stopped) return;
    animation = window.requestAnimationFrame(frame);
    const pad = hub.read();
    const buttons = pad.buttons;
    if (isCapturing()) {
      // Capture mode: the pad is deliberately inert, and its buttons are latched so
      // leaving capture does not read a held button as a fresh press.
      held.up = pad.moveZ > NAV_STICK_THRESHOLD || buttons[PAD.DUp] === true;
      held.down = pad.moveZ < -NAV_STICK_THRESHOLD || buttons[PAD.DDown] === true;
      held.left = pad.moveX < -NAV_STICK_THRESHOLD;
      held.right = pad.moveX > NAV_STICK_THRESHOLD;
      held.confirm = buttons[PAD.A] === true;
      held.back = buttons[PAD.B] === true;
      held.start = buttons[PAD.Start] === true;
      return;
    }
    const nowMs = performance.now();
    const up = pad.moveZ > NAV_STICK_THRESHOLD || buttons[PAD.DUp] === true;
    const down = pad.moveZ < -NAV_STICK_THRESHOLD || buttons[PAD.DDown] === true;
    const left = pad.moveX < -NAV_STICK_THRESHOLD || buttons[PAD.DLeft] === true;
    const right = pad.moveX > NAV_STICK_THRESHOLD || buttons[PAD.DRight] === true;
    step(up, held.up, 'up', 0, -1, nowMs);
    step(down, held.down, 'down', 0, 1, nowMs);
    step(left, held.left, 'left', -1, 0, nowMs);
    step(right, held.right, 'right', 1, 0, nowMs);

    const confirm = buttons[PAD.A] === true;
    if (confirm && !held.confirm) {
      const focused = document.activeElement;
      // Only a button is activated: clicking a text field or a slider would mean
      // nothing, and the sheet's rows are all buttons.
      if (focused instanceof HTMLButtonElement && !focused.disabled) focused.click();
    }
    held.confirm = confirm;

    const back = buttons[PAD.B] === true;
    if (back && !held.back) onBack();
    held.back = back;

    const start = buttons[PAD.Start] === true;
    if (start && !held.start) onStart?.();
    held.start = start;
  };

  // Seed the latches from the pad as it is now: a button already down when the sheet
  // opens is not a press on it.
  const pad = hub.read();
  held.confirm = pad.buttons[PAD.A] === true;
  held.back = pad.buttons[PAD.B] === true;
  held.start = pad.buttons[PAD.Start] === true;
  animation = window.requestAnimationFrame(frame);
  return () => {
    stopped = true;
    window.cancelAnimationFrame(animation);
  };
}

/** What the player chose on the pause overlay. */
export type PauseAction = 'resume' | 'quit';

/** Everything the pause overlay needs from the game; wired by main. */
export interface PauseHooks {
  settings: () => Settings;
  /** Persist a complete settings object; main pushes it through world.apply. */
  applySettings: (next: Settings) => void;
  /** Apply a time-of-day preset immediately; not part of persisted settings. */
  applyTimePreset: (preset: TimeOfDayPreset) => void;
  /**
   * Write the drive in progress to its slot; resolves once the write has landed.
   *
   * A hook rather than a pause action: saving does not close the pause sheet — the
   * player paused to save, not to leave — so the menu has to know when it finished.
   */
  saveDrive: () => Promise<void>;
  /**
   * The canvas CSS size the resolution policy is resolved against.
   *
   * Not `window.innerWidth`: cinema mode shortens the CANVAS and not the window, so the
   * two disagree by exactly 180 pixels while it is on — and a render-scale row that
   * quotes a resolution the game is not rendering is the same drift this control exists
   * to end.
   */
  viewport: () => { readonly cssWidth: number; readonly cssHeight: number };
  /**
   * Forget the recorded rung verdict and measure the machine again on the next launch.
   *
   * It reloads: the measurement needs the loading cover, thirty discarded frames and a
   * settle of up to twenty seconds, none of which can happen behind a pause overlay
   * with a car parked in the road.
   */
  remeasureGraphics: () => void;
  /**
   * Frame cost breakdown, as preformatted text.
   *
   * Development only, and a HOOK rather than a value because the report has to be read
   * on the device whose heat is in question. A phone has no console anyone can attach
   * to in a car, so the numbers have to be able to appear on its screen.
   */
  frameReport?: () => string;
  /** The live performance graph across the top of the screen (ui/perfoverlay.ts). Dev only. */
  perfOverlay?: { readonly enabled: boolean; setEnabled(on: boolean): void };
  /** The lens on the finishing pass (render/hazeshader.ts). Dev only. */
  lens?: { readonly label: string; cycle(): void };
  /**
   * Record a fully fuelled car into the world.
   *
   * Optional, and absent in a production build. Cars are meant to be found in the
   * world and kept: stickers earned by hauling are permanent and do not follow the
   * player to another vehicle, which is worth nothing if a fresh, full-tanked car
   * is one keypress away. It survives as a development tool only — when the hook
   * is absent the button and its whole screen are never built.
   */
  spawnVehicle?: (request: SpawnRequest) => void;
  /**
   * Drop a trailer into the world. Same dev-only reasoning as `spawnVehicle`: a
   * trailer is meant to be found at a gas stop and left at the destination, and a
   * free one on demand makes the whole hauling loop optional. Optional, and absent
   * in a production build — when the hook is absent the button is never built.
   */
  spawnTrailer?: () => void;
  /**
   * Drops a normal world item at the player's feet. Dev-only: the picker exists to
   * exercise fluid cans and bubble-gum packs without bypassing pickup physics.
   */
  spawnItem?: (request: DevSpawnItemRequest) => void;
  /**
   * Drops one part variant at the player's feet as a loose part. Dev-only for the
   * same reason as the item dispenser: parts are what a run is spent scavenging,
   * and a free engine on demand retires that whole search. When the hook is absent
   * the button and its screen are never built.
   */
  spawnPart?: (variantId: string) => void;
  /**
   * Flips the driven car — or, on foot, the nearest car or trailer — back onto its
   * wheels. Dev-only: the shipping recovery for a car on its roof is a bubble-gum
   * charge chewed next to it, which costs a consumable and takes eight seconds, and
   * a free instant righting from the pause menu would retire that item. When the
   * hook is absent the button is never built.
   */
  flipVehicle?: () => void;
  /**
   * Seat the player in the nearest car, skipping the look-ray at a door. Dev only;
   * absent in a production build, like the spawn hooks above.
   */
  seatInNearestCar?: () => void;
  /**
   * Put the player on the rim of a lake basin, by site index. Lakes are one per
   * 200-300 km, so driving to one is hours; dev only, absent in a production build.
   */
  jumpToLake?: (index: number) => void;
}

/** Turns a KeyboardEvent.code into something a human reads: KeyW -> W. */
function formatKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse2') return 'RMB';
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export class MainMenu {
  private pauseOverlay: HTMLElement | null = null;
  private pauseCleanup: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly loading: HTMLElement,
  ) {}

  /**
   * The title screen. Resolves with the save to load, or null for a new drive.
   *
   * The front is at most three rows, and a first launch sees one: New drive. Continue
   * is the latest save, and says which drive it is. Saved drives is the one place drives
   * are told apart, so every card there leads with what differs between them: how far
   * down the road, in which car, at what hour of which day, and when it was saved.
   * Delete asks once, inside the card, because nothing brings a drive back.
   *
   * There is no seed field: a new drive's world is random, and a number the player
   * cannot read anything from is not a choice. Tools pin it with `?seed=` (see main).
   */
  show(backend: SaveBackend): Promise<WorldState | null> {
    const { promise, resolve } = Promise.withResolvers<WorldState | null>();
    const overlay = el('div', 'menu menu-title-screen');
    const hero = el('div', 'menu-hero');
    hero.appendChild(wordmark());
    const sheet = el('div', 'menu-sheet');
    overlay.append(hero, sheet);

    let listings: SaveListing[] = [];
    let listFailed = false;
    let view: 'front' | 'saves' = 'front';
    let errorLine: HTMLElement | null = null;
    let settled = false;
    let detachPad: (() => void) | null = null;

    /** Back from the list lands on the row that opened it, not on Continue. */
    const backToFront = (): void => {
      view = 'front';
      render();
      sheet.querySelector<HTMLButtonElement>('.menu-actions > :last-child')?.focus();
    };

    const showError = (message: string): void => {
      if (errorLine) errorLine.textContent = message;
    };

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.code === 'Escape' && view === 'saves') {
        ev.preventDefault();
        backToFront();
        return;
      }
      walkRows(sheet, ev);
    };

    const finish = (state: WorldState | null): void => {
      if (settled) return;
      settled = true;
      detachPad?.();
      detachPad = null;
      window.removeEventListener('keydown', onKey);
      this.loading.classList.remove('is-hidden');
      overlay.remove();
      resolve(state);
    };

    const load = (listing: SaveListing, control: HTMLButtonElement): void => {
      control.disabled = true;
      void backend
        .load(listing.meta.id)
        .catch(() => null)
        .then((state) => {
          if (state) {
            finish(state);
            return;
          }
          control.disabled = false;
          showError('That drive could not be loaded.');
        });
    };

    const refresh = async (): Promise<void> => {
      try {
        listings = await backend.list();
        listFailed = false;
      } catch {
        listings = [];
        listFailed = true;
      }
      if (listings.length === 0) view = 'front';
      render();
    };

    const driveCard = (listing: SaveListing): HTMLElement => {
      const card = el('div', 'menu-drive');
      const open = button('menu-drive-open', '');
      open.dataset.nav = '';
      const when = el('span', 'menu-drive-when');
      when.append(
        text(formatSavedDay(listing.meta.savedAt), 'menu-drive-day'),
        text(SAVED_TIME.format(listing.meta.savedAt), 'menu-drive-time'),
      );
      open.append(
        milestone(listing.drive?.km ?? listing.meta.km),
        driveFacts(listing.drive, listing.meta),
        when,
      );
      open.addEventListener('click', () => load(listing, open));

      const remove = button('menu-drive-delete', '');
      remove.appendChild(icon('trash'));
      remove.setAttribute('aria-label', 'Delete this drive');
      remove.title = 'Delete';
      remove.addEventListener('click', () => {
        const ask = el('div', 'menu-drive-confirm');
        const keep = button('menu-button', 'Keep');
        const erase = button('menu-button menu-danger', 'Delete');
        ask.append(text('Delete this drive? It cannot be brought back.', 'menu-drive-confirm-text'), keep, erase);
        card.classList.add('is-confirming');
        card.appendChild(ask);
        keep.focus();
        keep.addEventListener('click', () => {
          ask.remove();
          card.classList.remove('is-confirming');
          remove.focus();
        });
        erase.addEventListener('click', () => {
          erase.disabled = true;
          void backend.remove(listing.meta.id).then(refresh, () => {
            erase.disabled = false;
            showError('That drive could not be deleted.');
          });
        });
      });

      card.append(open, remove);
      return card;
    };

    const renderFront = (): void => {
      const nav = el('nav', 'menu-actions');
      const latest = listings[0];
      if (latest) {
        const car = latest.drive?.carLabel ?? latest.meta.name;
        const km = formatKm(latest.drive?.km ?? latest.meta.km);
        const saved = formatSavedDay(latest.meta.savedAt).toLowerCase();
        const resume = actionButton('Continue', `${car} · ${km} km · saved ${saved}`, true);
        resume.addEventListener('click', () => load(latest, resume));
        nav.appendChild(resume);
      }
      const fresh = actionButton('New drive', null, latest === undefined);
      fresh.addEventListener('click', () => finish(null));
      nav.appendChild(fresh);
      if (latest) {
        const count = listings.length === 1 ? '1 drive' : `${listings.length} drives`;
        const all = actionButton('Saved drives', count, false);
        all.addEventListener('click', () => {
          view = 'saves';
          render();
        });
        nav.appendChild(all);
      }
      sheet.appendChild(nav);
      sheet.appendChild(graphicsLevel());
    };

    /**
     * The graphics level, and only the level: it is the one display choice a player has
     * to make before the first frame, because Very Low is built into the world at load
     * and cannot be switched to afterwards without a reload. Picking one stores it with
     * its own defaults (settings.ts, `withTierDefaults`); everything finer is the pause
     * menu's. Untouched, a first launch still measures the machine and picks for itself.
     */
    const graphicsLevel = (): HTMLElement => {
      const field = el('div', 'menu-field menu-title-graphics');
      const head = el('div', 'menu-field-head');
      const label = el('span', 'menu-label');
      label.textContent = 'Graphics';
      head.appendChild(label);
      const row = el('div', 'menu-seg');
      const current = (): GraphicsQuality =>
        (loadStoredSettings() ?? DEFAULT_SETTINGS).graphicsQuality;
      const levels: readonly { quality: GraphicsQuality; label: string; icon: string }[] = [
        { quality: 'retro', label: 'Very Low', icon: 'retro' },
        { quality: 'acceptable', label: 'Low', icon: 'gfx1' },
        { quality: 'standard', label: 'Medium', icon: 'gfx2' },
        { quality: 'blessing', label: 'High', icon: 'gfx3' },
      ];
      const buttons = levels.map((level) => {
        const btn = button('menu-seg-btn', '');
        btn.dataset.nav = '';
        btn.append(icon(level.icon), text(level.label, 'menu-seg-label'));
        row.appendChild(btn);
        return { level, btn };
      });
      const paint = (): void => {
        const quality = current();
        for (const { level, btn } of buttons) btn.classList.toggle('is-selected', level.quality === quality);
      };
      for (const { level, btn } of buttons) {
        btn.addEventListener('click', () => {
          storeSettings(withTierDefaults(loadStoredSettings() ?? DEFAULT_SETTINGS, level.quality));
          paint();
        });
      }
      paint();
      field.append(head, row);
      return field;
    };

    const renderSaves = (): void => {
      const { head } = screenHead('Saved drives', backToFront);
      const list = el('div', 'menu-drives');
      for (const listing of listings) list.appendChild(driveCard(listing));
      sheet.append(head, list);
    };

    const render = (): void => {
      sheet.textContent = '';
      sheet.classList.toggle('is-list', view === 'saves');
      if (view === 'front') renderFront();
      else renderSaves();
      errorLine = el('div', 'menu-error');
      errorLine.setAttribute('role', 'alert');
      if (listFailed) errorLine.textContent = 'Saved drives are unavailable right now.';
      sheet.appendChild(errorLine);
      sheet.querySelector<HTMLButtonElement>('[data-nav]')?.focus();
    };

    // The launch cover stays up until the list has answered, so the first frame of the
    // title is the real one: Continue does not appear a moment after New drive did.
    void refresh().then(() => {
      this.root.appendChild(overlay);
      this.loading.classList.add('is-hidden');
      sheet.querySelector<HTMLButtonElement>('[data-nav]')?.focus();
      window.addEventListener('keydown', onKey);
      // The title screen is a menu like any other: a pad moves focus, A activates and
      // B backs out of the saved-drives list. Start does nothing here — there is no
      // drive to pause.
      detachPad = attachPadNavigation(
        sheet,
        () => {
          if (view === 'saves') backToFront();
        },
        null,
        () => false,
      );
    });
    return promise;
  }

  /**
   * Pause overlay with Settings and Spawn Vehicle sub-screens. One window
   * keydown listener serves the whole pause: it routes either pause key by screen
   * and runs key-capture for rebinding. Element listeners live on the overlay, so
   * removePause (which drops the overlay) releases everything except that one
   * window listener, which pauseCleanup removes.
   */
  showPause(info: { drive: DriveSummary; seed: number }, hooks: PauseHooks): Promise<PauseAction> {
    this.removePause();
    return new Promise((resolve) => {
      const overlay = el('div', 'menu menu-pause');
      const panel = el('div', 'menu-sheet');
      overlay.appendChild(panel);
      this.root.appendChild(overlay);
      this.pauseOverlay = overlay;

      let settled = false;
      const finish = (action: PauseAction): void => {
        if (settled) return;
        settled = true;
        this.removePause();
        resolve(action);
      };

      // The pad gets the same three keys the overlay already answers to: A activates
      // the focused control, B is Escape's back, and Start is Escape on the main screen
      // — which is Resume, exactly as the keyboard's pause key is.
      const back = (): void => {
        if (screen === 'main') finish('resume');
        else showScreen('main');
      };
      let detachPad: (() => void) | null = null;

      // Working copy of the player's settings. hooks.settings() hands out the
      // authoritative object: it is copied on entry, never mutated here, and
      // every change pushes a complete Settings object back through
      // hooks.applySettings (keyBindings re-copied so the applied map is ours).
      const mobilePresentation = prefersMobilePresentation();
      const base = hooks.settings();
      const settings: Settings = {
        gearboxMode: base.gearboxMode,
        dayCycleMinutes: base.dayCycleMinutes,
        mouseSensitivity: base.mouseSensitivity,
        cameraStyle: base.cameraStyle,
        controllerVibration: base.controllerVibration,
        controllerDeadzone: base.controllerDeadzone,
        controllerSteerSensitivity: base.controllerSteerSensitivity,
        controllerSteerAssist: base.controllerSteerAssist,
        keyboardSteerAssist: base.keyboardSteerAssist,
        keyboardSteerRelease: base.keyboardSteerRelease,
        masterVolume: base.masterVolume,
        carVolume: base.carVolume,
        worldVolume: base.worldVolume,
        radioVolume: base.radioVolume,
        radioStation1Url: base.radioStation1Url,
        radioStation2Url: base.radioStation2Url,
        keyBindings: { ...base.keyBindings },
        graphicsQuality: base.graphicsQuality,
        graphicsQualitySource: base.graphicsQualitySource,
        renderScale: base.renderScale,
        retroLines: base.retroLines,
        msaa: base.msaa,
        frameRateLimit: base.frameRateLimit,
        fieldOfView: base.fieldOfView,
        preciseSteering: base.preciseSteering,
        cameraShake: base.cameraShake,
        bouncyCars: base.bouncyCars,
        dashboardSize: base.dashboardSize,
        viewDistance: base.viewDistance,
        trafficDensity: base.trafficDensity,
      };
      const apply = (): void => {
        hooks.applySettings({
          gearboxMode: settings.gearboxMode,
          dayCycleMinutes: settings.dayCycleMinutes,
          mouseSensitivity: settings.mouseSensitivity,
          cameraStyle: settings.cameraStyle,
          controllerVibration: settings.controllerVibration,
          controllerDeadzone: settings.controllerDeadzone,
          controllerSteerSensitivity: settings.controllerSteerSensitivity,
          controllerSteerAssist: settings.controllerSteerAssist,
          keyboardSteerAssist: settings.keyboardSteerAssist,
          keyboardSteerRelease: settings.keyboardSteerRelease,
          masterVolume: settings.masterVolume,
          carVolume: settings.carVolume,
          worldVolume: settings.worldVolume,
          radioVolume: settings.radioVolume,
          radioStation1Url: settings.radioStation1Url,
          radioStation2Url: settings.radioStation2Url,
          keyBindings: { ...settings.keyBindings },
          graphicsQuality: settings.graphicsQuality,
          graphicsQualitySource: settings.graphicsQualitySource,
          renderScale: settings.renderScale,
          retroLines: settings.retroLines,
          msaa: settings.msaa,
          frameRateLimit: settings.frameRateLimit,
          fieldOfView: settings.fieldOfView,
          preciseSteering: settings.preciseSteering,
          cameraShake: settings.cameraShake,
          bouncyCars: settings.bouncyCars,
          dashboardSize: settings.dashboardSize,
          viewDistance: settings.viewDistance,
          trafficDensity: settings.trafficDensity,
        });
      };

      /**
       * Label of the first other action bound to `code`, or null. Two actions may
       * deliberately share a key only when both declare it as a default; F uses
       * that context-sensitive exception for world manipulation and vehicle entry.
       */
      const holderOf = (code: string, exceptActionId: string): string | null => {
        const except = BINDABLE_ACTIONS.find((action) => action.id === exceptActionId);
        for (const action of BINDABLE_ACTIONS) {
          const intentionalSharedDefault =
            except?.defaultKeys.includes(code) === true && action.defaultKeys.includes(code);
          if (
            action.id !== exceptActionId &&
            !intentionalSharedDefault &&
            (settings.keyBindings[action.id] ?? action.defaultKeys).includes(code)
          ) {
            return action.label;
          }
        }
        return null;
      };

      type Screen = 'main' | 'settings' | 'spawn' | 'item' | 'part' | 'perf';
      let screen: Screen = 'main';
      /**
       * Settings section, remembered across visits: someone adjusting the horizon
       * comes back to the horizon, not to the top of a list.
       */
      type SettingsTab = 'drive' | 'display' | 'compute' | 'gameplay' | 'sound' | 'controls' | 'controller';
      let settingsTab: SettingsTab = 'drive';
      /** Action id waiting for a key in capture mode; only set on settings. */
      let capturingActionId: string | null = null;
      /** Feedback line on the settings screen; null while not on settings. */
      let note: HTMLElement | null = null;
      /** Bindings list on the settings screen; null while not on settings. */
      let bindingsList: HTMLElement | null = null;

      const clearNote = (): void => {
        if (!note) return;
        note.textContent = '';
        note.classList.remove('is-alarm');
      };

      const renderBindings = (): void => {
        if (!bindingsList) return;
        bindingsList.textContent = '';
        for (const action of BINDABLE_ACTIONS) {
          const row = button('menu-binding', '');
          const labelSpan = el('span', 'menu-binding-label');
          labelSpan.textContent = action.label;
          const keysSpan = el('span', 'menu-binding-keys');
          if (capturingActionId === action.id) {
            row.classList.add('is-capturing');
            const waiting = el('span', 'menu-keycap is-waiting');
            waiting.textContent = 'press a key';
            keysSpan.appendChild(waiting);
          } else {
            // One cap per key, not a slash-joined string: a boxed glyph is read as a
            // key without being parsed as a sentence, which is the whole point of a
            // twenty-row list nobody wants to read.
            for (const code of settings.keyBindings[action.id] ?? action.defaultKeys) {
              const cap = el('kbd', 'menu-keycap');
              cap.textContent = formatKey(code);
              keysSpan.appendChild(cap);
            }
          }
          row.append(labelSpan, keysSpan);
          row.addEventListener('click', () => {
            // Clicking the armed row again disarms it; clicking any other row
            // moves capture there.
            capturingActionId = capturingActionId === action.id ? null : action.id;
            clearNote();
            renderBindings();
          });
          bindingsList.appendChild(row);
        }
      };

      const showScreen = (next: Screen): void => {
        screen = next;
        if (next !== 'settings') {
          // Leaving settings disarms capture and drops the references to its
          // elements; both are rebuilt from scratch on the next visit.
          capturingActionId = null;
          note = null;
          bindingsList = null;
        }
        // Settings is the one screen that needs nearly the whole width; the dev pickers
        // are lists and want more than the main column.
        panel.classList.toggle('is-wide', next !== 'main' && next !== 'settings');
        panel.classList.toggle('is-settings', next === 'settings');
        if (next === 'main') renderMain();
        else if (next === 'settings') renderSettings();
        else if (next === 'item') renderItem?.();
        else if (next === 'perf') renderPerf();
        else if (next === 'part') renderPart?.();
        else renderSpawn?.();
      };

      const onKey = (ev: KeyboardEvent): void => {
        if (screen === 'settings' && capturingActionId !== null) {
          // Capture mode: the next keydown becomes the binding. Modifier chords
          // stay with the browser, while fixed system controls cancel capture.
          if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
          ev.preventDefault();
          if (isSystemControlCode(ev.code)) {
            capturingActionId = null;
            clearNote();
            renderBindings();
            return;
          }
          const action = BINDABLE_ACTIONS.find((a) => a.id === capturingActionId);
          if (!action) return;
          const holder = holderOf(ev.code, action.id);
          if (holder) {
            // Reject rather than clobber: say who already owns the key.
            if (note) {
              note.textContent = `"${formatKey(ev.code)}" is bound to ${holder}`;
              note.classList.add('is-alarm');
            }
            return;
          }
          settings.keyBindings[action.id] = [ev.code];
          apply();
          capturingActionId = null;
          clearNote();
          renderBindings();
          return;
        }
        if (ev.code === 'Escape' || ev.code === 'Backquote') {
          ev.preventDefault();
          if (screen === 'main') finish('resume');
          else showScreen('main');
          return;
        }
        if (screen === 'main') walkRows(panel, ev);
      };
      window.addEventListener('keydown', onKey);
      detachPad = attachPadNavigation(
        panel,
        back,
        () => finish('resume'),
        () => screen === 'settings' && capturingActionId !== null,
      );
      this.pauseCleanup = () => {
        window.removeEventListener('keydown', onKey);
        detachPad?.();
        detachPad = null;
      };

      /**
       * The pause sheet: where you are, and the four things a pause is for.
       *
       * The trip card is the same card the title screen lists saves with, so the drive
       * the player saves here is recognisable there. The seed is not shown: nothing in
       * the game takes one any more, and a number that cannot be used is noise.
       */
      const renderMain = (): void => {
        panel.textContent = '';

        const title = el('h1', 'menu-screen-title');
        title.textContent = 'Paused';
        const trip = el('div', 'menu-trip');
        trip.append(milestone(info.drive.km), driveFacts(info.drive, null));
        panel.append(title, trip);

        const nav = el('nav', 'menu-actions');
        const resumeBtn = actionButton('Resume', null, true);
        const saveBtn = actionButton('Save drive', null, false);
        const settingsBtn = actionButton('Settings', null, false);
        const quitBtn = actionButton('Quit to title', null, false);
        nav.append(resumeBtn, saveBtn, settingsBtn, quitBtn);
        panel.appendChild(nav);

        resumeBtn.addEventListener('click', () => finish('resume'));
        // The row answers for itself, green `Saved` for a moment, and the sheet stays
        // up: a save is something done in passing, and the player may still want to
        // change a setting or quit. A second press while the row speaks is ignored.
        const saveLabel = saveBtn.querySelector('.menu-action-label');
        let saving = false;
        const answer = (text: string, cls: string): void => {
          if (saveLabel) saveLabel.textContent = text;
          saveBtn.classList.add(cls);
          window.setTimeout(() => {
            if (saveLabel) saveLabel.textContent = 'Save drive';
            saveBtn.classList.remove(cls);
            saving = false;
          }, SAVE_ANSWER_MS);
        };
        saveBtn.addEventListener('click', () => {
          if (saving) return;
          saving = true;
          hooks.saveDrive().then(
            () => answer('Saved', 'is-saved'),
            (error: unknown) => {
              console.error('save failed', error);
              answer('Save failed', 'is-failed');
            },
          );
        });
        settingsBtn.addEventListener('click', () => showScreen('settings'));
        quitBtn.addEventListener('click', () => finish('quit'));

        // Dev only, in a box of its own under a label, so a screenshot of it is never
        // mistaken for the shipping menu. `import.meta.env.DEV` is tested first in
        // every branch so each folds to a constant false in a production build, and the
        // box, its label and every button go with it.
        const devTools: HTMLButtonElement[] = [];
        const devButton = (label: string, onClick: () => void): void => {
          const btn = button('menu-button', label);
          btn.addEventListener('click', onClick);
          devTools.push(btn);
        };
        if (import.meta.env.DEV && hooks.spawnVehicle) {
          devButton('Spawn vehicle', () => showScreen('spawn'));
        }
        // There is exactly one trailer, so no picker screen — the button is the whole
        // surface, and it only exists when the hook does.
        if (import.meta.env.DEV && hooks.spawnTrailer) {
          devButton('Spawn trailer', () => {
            hooks.spawnTrailer?.();
            finish('resume');
          });
        }
        // World items share one picker: fluid cans plus the five-charge gum pack.
        if (import.meta.env.DEV && hooks.spawnItem) {
          devButton('Spawn item', () => showScreen('item'));
        }
        // Every part variant the registry defines, grouped by kind: the picker is
        // how a bonnet slot, an anchor mount or a part's mesh gets exercised without
        // driving to a wreck first.
        if (import.meta.env.DEV && hooks.spawnPart) {
          devButton('Spawn part', () => showScreen('part'));
        }
        // No picker for this one either: the target is whatever the player is in or
        // standing next to, decided by main, so the button is the whole surface.
        if (import.meta.env.DEV && hooks.flipVehicle) {
          devButton('Flip car', () => {
            hooks.flipVehicle?.();
            finish('resume');
          });
        }
        if (import.meta.env.DEV && hooks.seatInNearestCar) {
          devButton('Drive nearest car', () => {
            hooks.seatInNearestCar?.();
            finish('resume');
          });
        }
        // Frame cost opens a readout rather than resuming, because a measurement is
        // something you read, not something you do.
        if (import.meta.env.DEV && hooks.frameReport) {
          devButton('Frame report', () => showScreen('perf'));
        }
        // A switch rather than a screen: the graph is for watching the drive, so the
        // label carries the state and pressing it leaves the menu where it is.
        if (import.meta.env.DEV && hooks.perfOverlay) {
          const overlay = hooks.perfOverlay;
          const label = (): string => `Performance overlay: ${overlay.enabled ? 'on' : 'off'}`;
          const index = devTools.length;
          devButton(label(), () => {
            overlay.setEnabled(!overlay.enabled);
            const btn = devTools[index];
            if (btn) btn.textContent = label();
          });
        }
        // Cycles the lens through its modes and strengths; the FOV slider stays as it is,
        // so the two combine (e.g. 75° at Panini 0.7 against 85° plain).
        if (import.meta.env.DEV && hooks.lens) {
          const lens = hooks.lens;
          const label = (): string => `Lens: ${lens.label}`;
          const index = devTools.length;
          devButton(label(), () => {
            lens.cycle();
            const btn = devTools[index];
            if (btn) btn.textContent = label();
          });
        }
        if (import.meta.env.DEV && hooks.jumpToLake) {
          // Cycles through the first sites on each press rather than opening a screen
          // for one number: every seed has 160 of them and they are interchangeable.
          let nextLake = 0;
          devButton('Jump to lake', () => {
            hooks.jumpToLake?.(nextLake++);
            finish('resume');
          });
        }
        if (import.meta.env.DEV && devTools.length > 0) {
          const dev = el('section', 'menu-dev');
          const grid = el('div', 'menu-dev-grid');
          grid.append(...devTools);
          dev.append(text(`Developer build · seed ${info.seed}`, 'menu-eyebrow'), grid);
          panel.appendChild(dev);
        }

        resumeBtn.focus();
      };


      /**
       * Settings, as four short sections behind an icon rail.
       *
       * What this replaces was one flat column: nine controls and twenty key bindings
       * in a single scroll, every row the same shape, and every option's explanatory
       * sentence on screen at once. It could only be read, never scanned.
       *
       * Three rules do the work here:
       *  - Sections, so driving settings are not adjacent to volume sliders.
       *  - ONE hint line, at a fixed height, describing whatever is hovered, focused
       *    or selected. Nine sentences become one, and the layout never jumps when it
       *    changes.
       *  - A glyph per option, carrying the axis (bars for quality, receding ridges
       *    for a horizon, the sun's height for time) so the row is scannable.
       *
       * Nothing here previews live. The whole loop — simulation and renderer — is
       * stopped while the overlay is up, so a graphics or horizon change cannot be
       * seen until Resume. An earlier version faded the panel to "show" the effect,
       * which showed a frozen frame and taught the player nothing.
       */
      const renderSettings = (): void => {
        panel.textContent = '';

        const { head, back: backBtn } = screenHead('Settings', () => showScreen('main'));
        panel.appendChild(head);

        const layout = el('div', 'menu-settings');
        const rail = el('div', 'menu-rail');
        const pane = el('div', 'menu-pane');
        layout.append(rail, pane);
        panel.appendChild(layout);

        // The hint line doubles as the rebinding conflict line (`note`), so a
        // rejected key lands where the player is already looking.
        note = el('div', 'menu-note menu-hint');
        panel.appendChild(note);

        const setHint = (text: string): void => {
          if (!note) return;
          note.textContent = text;
          note.classList.remove('is-alarm');
        };

        /**
         * One option of a segmented control. `active`/`pick` rather than a generic
         * value type: some rows select persisted state, and the time-of-day row
         * selects nothing at all (it fires and forgets), and both are the same widget.
         */
        interface SegOption {
          readonly label: string;
          readonly icon: string;
          /**
           * The hint line, or a function for one that depends on state the row does not
           * own: the render-scale row quotes the pixel count the CURRENT rung would give,
           * and a string captured at build time would keep quoting the rung just left.
           */
          readonly hint: string | (() => string);
          readonly active: () => boolean;
          readonly pick: () => void;
        }

        /** Four call sites below need this resolution in lockstep; see `SegOption.hint`. */
        const hintOf = (option: SegOption): string =>
          typeof option.hint === 'string' ? option.hint : option.hint();

        /**
         * `head` is for state and actions that belong to THIS row rather than beside it:
         * the detail row carries who picked it and the button that hands the choice back
         * to the game, and a separate field for those was a row whose label had to name
         * a concept ("rung source") the player had never met.
         */
        const segmented = (
          labelText: string,
          options: readonly SegOption[],
          head: readonly HTMLElement[] = [],
        ): HTMLElement => {
          const field = el('div', 'menu-field');
          const fieldHead = el('div', 'menu-field-head');
          const label = el('span', 'menu-label');
          label.textContent = labelText;
          fieldHead.append(label, ...head);
          const row = el('div', 'menu-seg');
          const buttons = options.map((option) => {
            const btn = button('menu-seg-btn', '');
            const text = el('span', 'menu-seg-label');
            text.textContent = option.label;
            btn.append(icon(option.icon), text);
            row.appendChild(btn);
            return { option, btn };
          });
          const selectedHint = (): string => {
            const selected = options.find((o) => o.active()) ?? options[0];
            return selected === undefined ? '' : hintOf(selected);
          };
          const paint = (): void => {
            for (const { option, btn } of buttons) {
              btn.classList.toggle('is-selected', option.active());
            }
          };
          for (const [index, entry] of buttons.entries()) {
            entry.btn.addEventListener('click', () => {
              entry.option.pick();
              paint();
              setHint(hintOf(entry.option));
            });
            // Hover and focus preview their own option's hint; leaving restores the
            // selected one, so the line always describes something real.
            entry.btn.addEventListener('pointerenter', () => setHint(hintOf(entry.option)));
            entry.btn.addEventListener('focus', () => setHint(hintOf(entry.option)));
            entry.btn.addEventListener('blur', () => setHint(selectedHint()));
            entry.btn.addEventListener('keydown', (ev) => {
              // Left/right walks the row, the way a segmented control should: the
              // whole screen is reachable without a mouse.
              const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
              if (step === 0) return;
              ev.preventDefault();
              const next = buttons[(index + step + buttons.length) % buttons.length];
              next.btn.focus();
            });
          }
          paint();
          row.addEventListener('pointerleave', () => setHint(selectedHint()));
          field.append(fieldHead, row);
          return field;
        };

        const sliderField = (
          labelText: string,
          iconName: string,
          hint: string,
          min: number,
          max: number,
          step: number,
          get: () => number,
          format: (value: number) => string,
          set: (value: number) => void,
        ): HTMLElement => {
          const field = el('div', 'menu-field');
          const fieldHead = el('div', 'menu-field-head');
          const sliderId = `settings-${labelText.toLowerCase().replaceAll(' ', '-')}`;
          const label = el('label', 'menu-label');
          label.textContent = labelText;
          label.setAttribute('for', sliderId);
          // The value rides in the head as a chip instead of taking its own column,
          // which is what let four sliders become four scannable rows.
          const chip = el('output', 'menu-chip');
          fieldHead.append(icon(iconName), label, chip);
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.id = sliderId;
          slider.className = 'menu-slider';
          slider.min = String(min);
          slider.max = String(max);
          slider.step = String(step);
          const paint = (): void => {
            slider.value = String(get());
            chip.textContent = format(get());
            // The filled part of the track, which a range input cannot style natively.
            slider.style.setProperty('--fill', `${((get() - min) / (max - min)) * 100}%`);
          };
          slider.addEventListener('input', () => {
            set(slider.valueAsNumber);
            paint();
            apply();
          });
          slider.addEventListener('pointerenter', () => setHint(hint));
          slider.addEventListener('focus', () => setHint(hint));
          paint();
          field.append(fieldHead, slider);
          return field;
        };

        const renderDrive = (): void => {
          pane.append(
            segmented('Gearbox', [
              {
                label: 'Manual',
                icon: 'manual',
                hint: 'Four speeds and a clutch you do not have to think about. X and Z shift.',
                active: () => settings.gearboxMode === 'manual',
                pick: () => {
                  settings.gearboxMode = 'manual';
                  apply();
                },
              },
              {
                label: 'Automatic',
                icon: 'auto',
                hint: 'The box shifts for you. X and Z still override it.',
                active: () => settings.gearboxMode === 'automatic',
                pick: () => {
                  settings.gearboxMode = 'automatic';
                  apply();
                },
              },
            ]),
            segmented('Steering', [
              {
                label: 'Standard',
                icon: 'keys',
                hint: 'A and D ask for as much steering as the front tyres can use at this speed. Let go and the wheel unwinds on its own.',
                active: () => !settings.preciseSteering,
                pick: () => {
                  settings.preciseSteering = false;
                  apply();
                },
              },
              {
                label: 'Precise',
                icon: 'mouse',
                hint: 'Mouse and A/D wind one linear wheel that stays put. Tap a key to trim; hold it to keep turning.',
                active: () => settings.preciseSteering,
                pick: () => {
                  settings.preciseSteering = true;
                  apply();
                },
              },
            ]),
            segmented('Camera shake', [
              {
                label: 'On',
                icon: 'drive',
                hint: 'Past 60 km/h the view sways slowly, barely at all, growing with speed and more on gravel and sand than on smooth tarmac.',
                active: () => settings.cameraShake,
                pick: () => {
                  settings.cameraShake = true;
                  apply();
                },
              },
              {
                label: 'Off',
                icon: 'fov',
                hint: 'The view stays steady at any speed.',
                active: () => !settings.cameraShake,
                pick: () => {
                  settings.cameraShake = false;
                  apply();
                },
              },
            ]),
            segmented('Camera style', [
              {
                label: 'Steady',
                icon: 'drive',
                hint: 'The camera as it has always been: it follows the car, holds a level horizon and points where you point it. Nothing about a slide moves the frame.',
                active: () => settings.cameraStyle === 'steady',
                pick: () => {
                  settings.cameraStyle = 'steady';
                  apply();
                },
              },
              {
                label: 'Dynamic',
                icon: 'cameraStyle',
                hint: 'The camera reads the car: it lags the slip angle so a slide is visible, leans out of corners with the body, rolls the bonnet view with the suspension and looks into the wheels at parking speed.',
                active: () => settings.cameraStyle === 'dynamic',
                pick: () => {
                  settings.cameraStyle = 'dynamic';
                  apply();
                },
              },
            ]),
            segmented('Yaris mode', [
              {
                label: 'Off',
                icon: 'drive',
                hint: 'Cars sit still on their springs, same as any other drive.',
                active: () => !settings.bouncyCars,
                pick: () => {
                  settings.bouncyCars = false;
                  apply();
                },
              },
              {
                label: 'On',
                icon: 'bounce',
                hint: 'Every car on the road — yours and traffic — hops in place like the viral bouncing Yaris. Purely visual: handling, suspension and collisions are untouched.',
                active: () => settings.bouncyCars,
                pick: () => {
                  settings.bouncyCars = true;
                  apply();
                },
              },
            ]),
          );
        };

        /**
         * WHO PICKED THE DETAIL LEVEL, in the player's words.
         *
         * A measured verdict and a chosen preference used to look identical — the rung
         * was a bare string and the only record of who set it was that stored
         * preferences existed at all — so one unlucky measurement was permanent and
         * nothing could ask again. These are the four answers to "picked by", which is
         * the only form the distinction survives in: `measured` and `chosen` are exact
         * words for the code and mean nothing to the person reading a menu.
         */
        const PICKED_BY: Record<GraphicsQualitySource, string> = {
          default: 'not picked yet',
          device: 'phone default',
          measured: 'picked by the game',
          chosen: 'picked by you',
        };
        const PICKED_NOTES: Record<GraphicsQualitySource, string> = {
          default: 'Nobody has picked yet. The next launch times your graphics chip and picks.',
          device: 'Phones start on the lightest level so they stay cool.',
          measured:
            'The game timed your graphics chip while the game was loading, and picked this. '
            + 'It will not change it again.',
          chosen: 'You picked this. Nothing will change it unless you do.',
        };
        const PICK_FOR_ME_HINT =
          'Let the game time your graphics chip and pick the level again. Restarts the game, '
          + 'because the timing happens behind the loading screen: it throws away the first '
          + 'thirty frames and can take up to twenty seconds, with nobody driving.';

        const renderDisplay = (): void => {
          // Nothing here previews: the simulation and the renderer are both stopped
          // while the pause overlay is up, so graphics and horizon changes are only
          // seen after Resume. Saying so in the hint is honest; fading the panel to
          // show a frozen frame was not.
          //
          // `Sharpness` quotes PIXELS, not a percentage of something unstated, and reads
          // them from the canvas rather than the window: cinema mode shortens the canvas
          // by two 90-pixel bars and leaves the window alone, and a row that names a
          // resolution the game is not rendering is the drift this control exists to end.
          const viewport = hooks.viewport();
          const cssPixels = viewport.cssWidth * viewport.cssHeight;
          const pixelsAt = (ratio: number): string => {
            const width = Math.floor(viewport.cssWidth * ratio);
            const height = Math.floor(viewport.cssHeight * ratio);
            return `${width}x${height}, ${((width * height) / 1_000_000).toFixed(2)} Mpx`;
          };

          // WHO PICKED IT rides in the detail row's own head, next to the thing it
          // describes, with the one action on it — shaped like the key-bindings field,
          // which is the same kind of row: a piece of state and a button that resets it.
          // It was a row of its own, and a row needs a label: that label had to name a
          // concept ("rung source") the player had never met and could not guess.
          const pickedChip = el('output', 'menu-chip');
          const paintSource = (): void => {
            pickedChip.textContent = PICKED_BY[settings.graphicsQualitySource];
          };
          paintSource();
          pickedChip.addEventListener('pointerenter', () =>
            setHint(PICKED_NOTES[settings.graphicsQualitySource]),
          );
          const detailHead: HTMLElement[] = [pickedChip];
          // A phone is never timed: it is put on the lightest level, which is the floor,
          // and the only direction a measurement could move it is up — which is the heat
          // that level exists to refuse. Offering the button there would promise a
          // measurement the launch declines to make.
          if (!mobilePresentation) {
            const pickBtn = button('menu-button menu-reset', 'Let the game pick');
            pickBtn.addEventListener('click', () => hooks.remeasureGraphics());
            pickBtn.addEventListener('pointerenter', () => setHint(PICK_FOR_ME_HINT));
            pickBtn.addEventListener('focus', () => setHint(PICK_FOR_ME_HINT));
            detailHead.push(pickBtn);
          }

          pane.append(
            // ONE LADDER, AND IT IS NOT ABOUT PIXELS ANY MORE. `Sharpness` below owns the
            // resolution; what is left here is how much WORLD there is — how far the
            // desert is drawn, whether the sun casts, how many lamps are shaded, how deep
            // the sky goes. The labels used to name machines (`Phone`, `Desktop`,
            // `Workstation`), which asked the player to classify his own computer and
            // then guess which class he was in; the measurement answers that now, and
            // says so in the head, so the levels can describe the picture instead.
            segmented('Detail', [
              {
                label: 'Very Low',
                icon: 'retro',
                hint: () =>
                  'For weak mini-PCs and old laptops. The world is drawn at about 360 lines '
                  + '(540 under Sharpness) and shown as crisp square pixels, like a late-90s '
                  + 'game, with lighter ground cover and no sun shadows. '
                  + (settings.graphicsQuality === 'retro'
                    ? ''
                    : 'Switching to it or away from it saves the drive and reloads it.'),
                active: () => settings.graphicsQuality === 'retro',
                pick: () => {
                  settings.graphicsQuality = 'retro';
                  settings.graphicsQualitySource = 'chosen';
                  paintSource();
                  apply();
                },
              },
              {
                label: 'Low',
                icon: 'gfx1',
                hint: describeTier('acceptable', mobilePresentation),
                active: () => settings.graphicsQuality === 'acceptable',
                pick: () => {
                  settings.graphicsQuality = 'acceptable';
                  settings.graphicsQualitySource = 'chosen';
                  paintSource();
                  apply();
                },
              },
              {
                label: 'Medium',
                icon: 'gfx2',
                hint: describeTier('standard', mobilePresentation),
                active: () => settings.graphicsQuality === 'standard',
                pick: () => {
                  settings.graphicsQuality = 'standard';
                  settings.graphicsQualitySource = 'chosen';
                  paintSource();
                  apply();
                },
              },
              {
                label: 'High',
                icon: 'gfx3',
                hint: describeTier('blessing', mobilePresentation),
                active: () => settings.graphicsQuality === 'blessing',
                pick: () => {
                  settings.graphicsQuality = 'blessing';
                  settings.graphicsQualitySource = 'chosen';
                  paintSource();
                  apply();
                },
              },
            ], detailHead),
            // THE AXIS THE LEVEL CANNOT EXPRESS. A level is three points — on a 4K
            // television 1.44, 3.69 and 12.96 megapixels — and a machine is not three
            // machines; worse, `Auto` is a GPU timer query, so a browser without
            // `EXT_disjoint_timer_query_webgl2` cannot move the scale at all and three
            // points were the whole of the choice there. Both directions are offered:
            // down for the machine between two levels, up for the one with headroom that
            // does not want a 25 km vista and eighteen headlamps to go with it.
            // On the retro rung the row offers whole-pixel line counts instead: its
            // resolution IS the look (render/retro.ts), so the choice is how coarse the
            // squares are, never a fraction the compositor would smear.
            ...(settings.graphicsQuality === 'retro' ? [segmented('Sharpness', RETRO_LINE_CHOICES.map((lines) => ({
              label: `${lines} lines`,
              icon: 'pixels',
              hint: () =>
                `${pixelsAt(retroPixelRatio(viewport.cssHeight, window.devicePixelRatio, lines))}, `
                + 'each pixel a crisp square. '
                + (lines === 360
                  ? 'The level\'s own look, and the lightest on the graphics chip.'
                  : 'Finer squares, a little sharper. Costs the chip about a third more, '
                    + 'most of it the pixels; still far below Low.'),
              active: () => settings.retroLines === lines,
              pick: () => {
                settings.retroLines = lines;
                apply();
              },
            })))] : [segmented('Sharpness', [
              {
                label: 'Auto',
                icon: 'display',
                hint: () =>
                  'The game watches your graphics chip and picks, lowering this if the '
                  + 'machine cannot keep up. Full sharpness here is '
                  + `${pixelsAt(
                    renderScaleFor(
                      settings.graphicsQuality,
                      cssPixels,
                      window.devicePixelRatio,
                      mobilePresentation,
                    ),
                  )}. `
                  + 'Some browsers will not let the game time the chip — Safari, and most '
                  + 'phones inside an app. There it cannot watch, so pick a number yourself.',
                active: () => settings.renderScale === null,
                pick: () => {
                  settings.renderScale = null;
                  apply();
                },
              },
              // Built from the display, not from the list: the absolute bound flattens
              // the top of the row on a large screen, and two buttons with one outcome
              // is the menu promising pixels it will not draw.
              ...offeredRenderScales(
                cssPixels,
                window.devicePixelRatio,
                mobilePresentation,
                settings.renderScale,
              ).map((scale) => ({
                label: `${Math.round(scale * 100)}%`,
                icon: 'pixels',
                hint: () =>
                  `${Math.round(scale * 100)}% of this display: `
                  + `${pixelsAt(
                    manualRenderScale(
                      cssPixels,
                      window.devicePixelRatio,
                      mobilePresentation,
                      scale,
                    ),
                  )}. `
                  + (scale > 1
                    ? 'Drawn bigger than the screen and shrunk down, which smooths every '
                      + 'edge. Capped at what the game will ever draw. '
                    : '')
                  + 'Fixed: the game will not lower it for you.',
                active: () => settings.renderScale === scale,
                pick: () => {
                  settings.renderScale = scale;
                  apply();
                },
              })),
            ])]),
            // THE ONE LEVER THAT WORKS ON EVERY DEVICE, for opposite reasons, so it is
            // offered on both. On a phone it is a thermal control and has to be the
            // player's: no browser reports thermal state, battery temperature or clock
            // speed, so the device cannot say it is hot — only the person holding it can.
            // On a desktop it is noise and power, which the game cannot see either.
            //
            // It is also the largest lever there is: half the frames is half the render
            // work and half the presenting, while the simulation keeps its fixed rate, so
            // the car handles identically at every setting here. And its floor is that
            // simulation — nothing below the fixed rate can be saved by presenting less.
            segmented('Frame Rate', [
              ...FRAME_RATE_LIMITS.map((rate) => ({
                label: String(rate),
                icon: 'gfx3',
                hint:
                  `${rate} FPS. Simulation is unaffected — the car handles the same at ` +
                  'every rate here. Half the frames is half the render work and half the presenting.',
                active: () => settings.frameRateLimit === rate,
                pick: () => {
                  settings.frameRateLimit = rate;
                  apply();
                },
              })),
              {
                label: 'Max',
                icon: 'gfx1',
                hint:
                  'No cap. The right choice when the GPU is already the constraint, ' +
                  'because a cap there only costs smoothness.',
                active: () => settings.frameRateLimit === null,
                pick: () => {
                  settings.frameRateLimit = null;
                  apply();
                },
              },
            ]),
            segmented('Smooth Edges', [
              {
                label: 'On',
                icon: 'gfx3',
                hint: 'Softens the jagged steps along edges. Costs a lot on a weak chip.',
                active: () => settings.msaa,
                pick: () => {
                  settings.msaa = true;
                  apply();
                },
              },
              {
                label: 'Off',
                icon: 'gfx1',
                hint: 'Jagged edges left as they are. Sharpness and the drawn outlines still apply.',
                active: () => !settings.msaa,
                pick: () => {
                  settings.msaa = false;
                  apply();
                },
              },
            ]),
            sliderField(
              'Field of View',
              'fov',
              'How wide a view the camera has. Only the up-and-down angle is set here — a '
                + 'wider window then shows MORE desert to the sides rather than squeezing '
                + 'it. 65 is the authored view; the binoculars and the speed widening both '
                + 'follow whatever you set.',
              FIELD_OF_VIEW_MIN,
              FIELD_OF_VIEW_MAX,
              1,
              () => settings.fieldOfView,
              (value) => `${Math.round(value)}\u00b0`,
              (value) => {
                settings.fieldOfView = value;
              },
            ),
          );
        };

        // THE PROCESSOR'S BILL, a different chip from every Display row: the far desert,
        // rebuilt cell by cell as you drive, and the traffic, every car a full physical
        // vehicle with its own driver. Two rows because they cost different things and a
        // machine may afford one and not the other. Both apply live.
        const renderCompute = (): void => {
          pane.append(
            segmented('View Distance', COMPUTE_LEVELS.map(({ level, label }) => ({
              label,
              icon: HORIZON_ICONS[level],
              hint:
                `${formatHorizon(viewDistanceFor(level, mobilePresentation))} of desert before the haze. `
                + 'The far desert is rebuilt by the processor as you drive; the farther it '
                + 'reaches, the bigger that rebuild, and a slow processor feels it as a '
                + 'stutter every few hundred metres.',
              active: () => settings.viewDistance === level,
              pick: () => {
                settings.viewDistance = level;
                apply();
              },
            }))),
            segmented('Traffic', COMPUTE_LEVELS.map(({ level, label }) => ({
              label,
              icon: TRAFFIC_ICONS[level],
              hint:
                `Up to ${TRAFFIC_CAPS[level].narrow} cars on a two-lane road and `
                + `${TRAFFIC_CAPS[level].wide} on a four-lane one. Every one is fully `
                + 'simulated with its own driver, so this is the processor\'s, not the '
                + 'graphics card\'s.',
              active: () => settings.trafficDensity === level,
              pick: () => {
                settings.trafficDensity = level;
                apply();
              },
            }))),
          );
        };

        const renderGameplay = (): void => {
          pane.append(
            segmented(
              'Time of Day',
              (Object.keys(TIME_OF_DAY_PRESETS) as TimeOfDayPreset[]).map((preset) => ({
                label: preset.charAt(0).toUpperCase() + preset.slice(1),
                icon: preset,
                hint: `Move the sun to ${preset}. The clock keeps running from there.`,
                active: () => false,
                pick: () => hooks.applyTimePreset(preset),
              })),
            ),
            sliderField(
              'Day Length',
              'clock',
              'Real minutes for one full day and night.',
              DAY_CYCLE_MIN_MINUTES,
              DAY_CYCLE_MAX_MINUTES,
              1,
              () => settings.dayCycleMinutes,
              (value) => `${Math.round(value)} min`,
              (value) => {
                settings.dayCycleMinutes = value;
              },
            ),
            sliderField(
              'Dashboard Size',
              'gameplay',
              'How big the driving dashboard is drawn. 100% is the default size.',
              DASHBOARD_SIZE_MIN,
              DASHBOARD_SIZE_MAX,
              DASHBOARD_SIZE_STEP,
              () => settings.dashboardSize,
              (value) => `${Math.round(value * 100)}%`,
              (value) => {
                settings.dashboardSize = value;
              },
            ),
          );
        };

        const radioStationField = (
          labelText: string,
          get: () => string,
          set: (value: string) => void,
        ): HTMLElement => {
          const field = el('div', 'menu-field');
          const label = el('div', 'menu-label');
          label.textContent = labelText;
          const input = document.createElement('input');
          input.type = 'url';
          input.value = get();
          input.placeholder = 'https://…';
          input.autocomplete = 'off';
          input.className = 'menu-radio-url';
          input.style.width = '100%';
          input.addEventListener('change', () => {
            set(input.value.trim());
            apply();
          });
          const recommended = document.createElement('select');
          recommended.className = 'menu-radio-recommendations';
          recommended.style.width = '100%';
          recommended.add(new Option('Recommended streams…', ''));
          for (const station of RADIO_RECOMMENDATIONS) {
            recommended.add(new Option(`${station.label} — ${station.url}`, station.url));
          }
          recommended.addEventListener('change', () => {
            if (!recommended.value) return;
            input.value = recommended.value;
            set(recommended.value);
            apply();
            recommended.value = '';
          });
          field.append(label, input, recommended);
          return field;
        };

        const renderSound = (): void => {
          pane.append(
            sliderField(
              'Master',
              'sound',
              'Everything you hear: the car, the world, your own footsteps and the radio. The three below set their share of it.',
              0,
              1,
              0.01,
              () => settings.masterVolume,
              (value) => `${Math.round(value * 100)}%`,
              (value) => {
                settings.masterVolume = value;
              },
            ),
            sliderField(
              'Car',
              'drive',
              'Your car: engine, gearbox, tyres, wind over the body, knocks and clunks.',
              0,
              1,
              0.01,
              () => settings.carVolume,
              (value) => `${Math.round(value * 100)}%`,
              (value) => {
                settings.carVolume = value;
              },
            ),
            sliderField(
              'World',
              'world',
              'Everything around you: air, rain, thunder, birds and insects, other traffic.',
              0,
              1,
              0.01,
              () => settings.worldVolume,
              (value) => `${Math.round(value * 100)}%`,
              (value) => {
                settings.worldVolume = value;
              },
            ),
            sliderField(
              'Radio',
              'radio',
              'The car radio, levelled to sit with the game sound at the same setting.',
              0,
              1,
              0.01,
              () => settings.radioVolume,
              (value) => `${Math.round(value * 100)}%`,
              (value) => {
                settings.radioVolume = value;
              },
            ),
            radioStationField('Radio station 1 URL', () => settings.radioStation1Url, (value) => {
              settings.radioStation1Url = value;
            }),
            radioStationField('Radio station 2 URL', () => settings.radioStation2Url, (value) => {
              settings.radioStation2Url = value;
            }),
          );
        };

        /**
         * The controller. Three controls and a line of state.
         *
         * A pad's preferences are the same kind of thing as the mouse's — how the
         * device in your hand feels — so they are shaped the same way and applied at
         * the same place. They exist at all because the stick, the trigger and the
         * motors differ between pads and between hands: 8% dead-zone is right for a
         * Hall-effect stick and wrong for a worn one, and a pad that buzzes a nylon
         * desk mat is a pad nobody uses twice.
         *
         * The status line is read from the hub rather than written here, because "which
         * pad is it using" is exactly the question a player asks when nothing moves.
         */
        const renderController = (): void => {
          const hub = gamepads();
          const padHint =
            'An Xbox-style pad is used with the standard layout: left stick steers, '
            + 'RT and LT are throttle and brake, A is the handbrake, X enters and leaves '
            + 'the car, Y changes the camera view, the bumpers shift, the D-pad carries '
            + 'the indicators, the radio and the camera re-centre, and Start pauses.';
          const status = el('div', 'menu-field');
          const statusHead = el('div', 'menu-field-head');
          const statusLabel = el('span', 'menu-label');
          statusLabel.textContent = 'Gamepad';
          const statusChip = el('output', 'menu-chip');
          const paintStatus = (): void => {
            const pad = hub.read();
            if (!pad.connected) {
              statusChip.textContent = 'none detected';
              return;
            }
            const attached = navigator.getGamepads?.() ?? [];
            let name = 'connected';
            for (const candidate of attached) {
              if (candidate !== null && candidate.connected && candidate.mapping === 'standard') {
                name = candidate.id.split(' (')[0] ?? 'connected';
                break;
              }
            }
            statusChip.textContent = name;
          };
          paintStatus();
          statusHead.append(icon('gamepad'), statusLabel, statusChip);
          status.append(statusHead);
          // Focus re-reads the pad, which is how a player finds out that the pad he just
          // picked up is the one being used.
          statusChip.tabIndex = 0;
          statusChip.addEventListener('focus', () => {
            paintStatus();
            setHint(padHint);
          });
          statusChip.addEventListener('pointerenter', () => {
            paintStatus();
            setHint(padHint);
          });
          pane.appendChild(status);

          pane.append(
            sliderField(
              'Vibration',
              'bounce',
              'How hard the pad shakes. The strong motor carries the suspension and '
              + 'collisions, the weak one the road under the tyres and a sliding wheel.',
              0,
              1,
              CONTROLLER_VIBRATION_STEP,
              () => settings.controllerVibration,
              (value) => `${Math.round(value * 100)}%`,
              (value) => {
                settings.controllerVibration = value;
              },
            ),
            sliderField(
              'Stick dead-zone',
              'gamepad',
              'How far the left stick must move before the wheels see it. Raise it if a '
              + 'well-used pad steers on its own with nobody touching it.',
              CONTROLLER_DEADZONE_MIN,
              CONTROLLER_DEADZONE_MAX,
              CONTROLLER_DEADZONE_STEP,
              () => settings.controllerDeadzone,
              (value) => `${Math.round(value * 100)}%`,
              (value) => {
                settings.controllerDeadzone = value;
              },
            ),
            sliderField(
              'Steering sensitivity',
              'keys',
              'How much lock a given stick deflection asks for. Above 100% reaches full '
              + 'lock earlier; below it leaves more of the stick for small corrections.',
              CONTROLLER_STEER_MIN,
              CONTROLLER_STEER_MAX,
              CONTROLLER_STEER_STEP,
              () => settings.controllerSteerSensitivity,
              (value) => `${Math.round(value * 100)}%`,
              (value) => {
                settings.controllerSteerSensitivity = value;
              },
            ),
            segmented('Steering assist', [
              {
                label: 'On',
                icon: 'drive',
                hint: 'Full stick is as much steering as the front tyres can use at this speed; the stick is proportional inside it. Precise mouse steering follows the same setting.',
                active: () => settings.controllerSteerAssist,
                pick: () => {
                  settings.controllerSteerAssist = true;
                  apply();
                },
              },
              {
                label: 'Off',
                icon: 'keys',
                hint: 'Full stick is full lock at any speed.',
                active: () => !settings.controllerSteerAssist,
                pick: () => {
                  settings.controllerSteerAssist = false;
                  apply();
                },
              },
            ]),
          );
        };

        const renderControls = (): void => {
          pane.appendChild(
            segmented('Keyboard steering assist', [
              {
                label: 'On',
                icon: 'drive',
                hint: 'A held key asks for as much steering as the front tyres can use at this speed.',
                active: () => settings.keyboardSteerAssist,
                pick: () => {
                  settings.keyboardSteerAssist = true;
                  apply();
                },
              },
              {
                label: 'Off',
                icon: 'keys',
                hint: 'A held key winds the wheel toward full lock at any speed: quick hands needed at speed.',
                active: () => !settings.keyboardSteerAssist,
                pick: () => {
                  settings.keyboardSteerAssist = false;
                  apply();
                },
              },
            ]),
          );
          pane.appendChild(
            segmented('Steering key release', [
              {
                label: 'Let go',
                icon: 'keys',
                hint: 'Releasing the key lets go of the wheel: the tyres turn it back toward where the car is going at once.',
                active: () => settings.keyboardSteerRelease === 'letGo',
                pick: () => {
                  settings.keyboardSteerRelease = 'letGo';
                  apply();
                },
              },
              {
                label: 'Ease off',
                icon: 'drive',
                hint: 'Releasing the key eases the hand off over a quarter second before letting go: a correction holds a little longer.',
                active: () => settings.keyboardSteerRelease === 'ease',
                pick: () => {
                  settings.keyboardSteerRelease = 'ease';
                  apply();
                },
              },
            ]),
          );
          pane.appendChild(
            sliderField(
              'Mouse Look',
              'mouse',
              'Pointer sensitivity for looking around. Precise control uses a fixed steering gain.',
              MOUSE_SENSITIVITY_MIN,
              MOUSE_SENSITIVITY_MAX,
              0.0001,
              () => settings.mouseSensitivity,
              (value) => `${Math.round((value / DEFAULT_MOUSE_SENSITIVITY) * 100)}%`,
              (value) => {
                settings.mouseSensitivity = value;
              },
            ),
          );

          const bindField = el('div', 'menu-field');
          const bindHead = el('div', 'menu-field-head');
          const bindLabel = el('span', 'menu-label');
          bindLabel.textContent = 'Key Bindings';
          const resetBtn = button('menu-button menu-reset', 'Reset');
          resetBtn.addEventListener('click', () => {
            settings.keyBindings = {};
            apply();
            setHint('Every binding is back to its default.');
            renderBindings();
          });
          bindHead.append(icon('controls'), bindLabel, resetBtn);
          // Two columns: the list is 5% of the visits and was 70% of the height.
          bindingsList = el('div', 'menu-bindings');
          bindField.append(bindHead, bindingsList);
          pane.appendChild(bindField);
          renderBindings();
        };

        const TABS: readonly {
          readonly id: SettingsTab;
          readonly label: string;
          readonly icon: string;
          readonly hint: string;
          readonly render: () => void;
        }[] = [
          {
            id: 'drive',
            label: 'Drive',
            icon: 'drive',
            hint: 'How the car is driven.',
            render: renderDrive,
          },
          {
            id: 'display',
            label: 'Display',
            icon: 'display',
            hint: 'What is drawn, and how sharply.',
            render: renderDisplay,
          },
          {
            id: 'compute',
            label: 'Compute',
            icon: 'compute',
            hint: 'How far the desert reaches and how busy the road is: the processor\'s bill.',
            render: renderCompute,
          },
          {
            id: 'gameplay',
            label: 'Gameplay',
            icon: 'gameplay',
            hint: 'Time flow and the spacing between roadside stops.',
            render: renderGameplay,
          },
          {
            id: 'sound',
            label: 'Sound',
            icon: 'sound',
            hint: 'Levels for the car and the radio.',
            render: renderSound,
          },
          {
            id: 'controls',
            label: 'Controls',
            icon: 'controls',
            hint: 'The mouse, the pad and every key.',
            render: renderControls,
          },
          {
            id: 'controller',
            label: 'Controller',
            icon: 'gamepad',
            hint: 'How the gamepad feels: shake, stick and steering.',
            render: renderController,
          },
        ];

        const railButtons = TABS.map((tab) => {
          const btn = button('menu-rail-btn', '');
          const text = el('span', 'menu-rail-label');
          text.textContent = tab.label;
          btn.append(icon(tab.icon), text);
          rail.appendChild(btn);
          return { tab, btn };
        });

        const showTab = (id: SettingsTab): void => {
          settingsTab = id;
          // Capture cannot survive leaving the section that owns it.
          capturingActionId = null;
          bindingsList = null;
          pane.textContent = '';
          for (const { tab, btn } of railButtons) {
            btn.classList.toggle('is-selected', tab.id === id);
          }
          const active = TABS.find((t) => t.id === id) ?? TABS[0];
          active.render();
          setHint(active.hint);
        };

        for (const [index, entry] of railButtons.entries()) {
          entry.btn.addEventListener('click', () => showTab(entry.tab.id));
          entry.btn.addEventListener('keydown', (ev) => {
            const step = ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
            if (step === 0) return;
            ev.preventDefault();
            const next = railButtons[(index + step + railButtons.length) % railButtons.length];
            next.btn.focus();
            showTab(next.tab.id);
          });
        }

        showTab(settingsTab);
        backBtn.focus();
      };

      /**
       * What the frame costs, printed rather than graphed.
       *
       * Text because of where it is read: on a phone, held in a hand, after a drive that
       * made it warm. A number that says "380 ms of CPU per second" can be sent in a
       * message; a graph cannot.
       */
      const renderPerf = (): void => {
        panel.textContent = '';
        panel.appendChild(screenHead('Frame report', () => showScreen('main')).head);

        const report = hooks.frameReport?.() ?? 'no report available';

        // The report is read on a phone, in a car, by somebody who then has to get it
        // somewhere else. Retyping eight lines of monospace off a screen is not a
        // realistic way to move a measurement, so the measurement moves itself.
        const copyBtn = button('menu-button', 'Copy Report');
        copyBtn.addEventListener('click', () => {
          // Exactly what is on screen, not a fresh reading: a button that copied a
          // different set of numbers from the ones being looked at would make the two
          // impossible to compare.
          void copyText(report).then((ok) => {
            copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
            window.setTimeout(() => {
              copyBtn.textContent = 'Copy Report';
            }, 1500);
          });
        });
        panel.appendChild(copyBtn);

        const readout = el('div', 'menu-perf');
        readout.textContent = report;
        panel.appendChild(readout);
      };

      // Spawn selection resets per pause, so every visit starts at the first model.
      let spawnModelId = CAR_MODELS[0].id;

      // The screen itself is unconditional; only the reference below is gated, so
      // the body keeps its indentation and `import.meta.env.DEV` still folds to a
      // constant. In production `renderSpawn` is null, `renderSpawnScreen` becomes
      // unreferenced, and the minifier drops the screen, its labels and
      // `CAR_MODELS` together.
      const renderSpawnScreen = (): void => {
        panel.textContent = '';

        const { head, back: backBtn } = screenHead('Spawn vehicle', () => showScreen('main'));
        panel.appendChild(head);

        const modelField = el('div', 'menu-field');
        const modelLabel = el('label', 'menu-label');
        modelLabel.textContent = 'Model';
        const modelList = el('div', 'menu-body-list');
        const paintModels = (): void => {
          modelList.textContent = '';
          for (const layout of DRIVE_LAYOUTS) {
            const models = CAR_MODELS.filter(
              (def) => driveLayout(def.rearDriveBias) === layout.id,
            );
            if (models.length === 0) continue;

            const heading = el('div', 'menu-body-group');
            heading.textContent = layout.label;
            modelList.appendChild(heading);

            for (const def of models) {
              const row = button('menu-body', '');
              const name = el('span', 'menu-body-label');
              name.textContent = def.label;
              row.append(name);

              const cls = el('span', 'menu-body-class');
              cls.textContent = def.bodyClass;
              row.append(cls);
              if (def.id === spawnModelId) row.classList.add('is-selected');
              row.addEventListener('click', () => {
                spawnModelId = def.id;
                paintModels();
                paintNote();
              });
              modelList.appendChild(row);
            }
          }
        };
        paintModels();
        modelField.append(modelLabel, modelList);
        panel.appendChild(modelField);

        const spawnNote = el('div', 'menu-note');
        const paintNote = (): void => {
          const def = CAR_MODELS.find((m) => m.id === spawnModelId);
          if (!def) {
            spawnNote.textContent = spawnModelId;
            return;
          }
          spawnNote.textContent = `${def.label} (${def.bodyClass})`;
        };
        paintNote();
        panel.appendChild(spawnNote);

        const confirmBtn = button('menu-button menu-primary', 'Spawn');
        confirmBtn.addEventListener('click', () => {
          hooks.spawnVehicle?.({ modelId: spawnModelId });
          finish('resume');
        });
        panel.appendChild(confirmBtn);

        backBtn.focus();
      };
      const renderSpawn: (() => void) | null = import.meta.env.DEV ? renderSpawnScreen : null;

      /**
       * Dev item dispenser. Fluid capacities mirror gas-stop stock; bubble gum uses
       * the same five-charge pack found there. Every row drops a real world pickup,
       * the sticker rows one signed envelope of each design in the catalog.
       */
      const renderItemScreen = (): void => {
        panel.textContent = '';

        const { head, back: backBtn } = screenHead('Spawn item', () => showScreen('main'));
        panel.appendChild(head);

        const list = el('div', 'menu-body-list');
        for (const spec of DEV_FLUIDS) {
          const row = button('menu-body', '');
          const name = el('span', 'menu-body-label');
          name.textContent = spec.fluid;
          row.append(name);
          const cap = el('span', 'menu-body-class');
          cap.textContent = `${spec.capacity} L`;
          row.append(cap);
          row.addEventListener('click', () => {
            hooks.spawnItem?.({ type: 'fluid_can', fluid: spec.fluid, capacity: spec.capacity });
            finish('resume');
          });
          list.appendChild(row);
        }

        const gumRow = button('menu-body', '');
        const gumName = el('span', 'menu-body-label');
        gumName.textContent = 'bubble gum pack';
        const gumCount = el('span', 'menu-body-class');
        gumCount.textContent = '5 charges';
        gumRow.append(gumName, gumCount);
        gumRow.addEventListener('click', () => {
          hooks.spawnItem?.({ type: 'bubble_gum' });
          finish('resume');
        });
        list.appendChild(gumRow);

        // One chip per factory colour, painted in it: the spray cans.
        const paints = el('div', 'menu-paints');
        for (const swatch of CAR_PAINTS) {
          const chip = button('menu-paint', '');
          chip.style.background = `#${swatch.hex.toString(16).padStart(6, '0')}`;
          chip.title = `${swatch.name} spray paint`;
          chip.setAttribute('aria-label', chip.title);
          chip.addEventListener('click', () => {
            hooks.spawnItem?.({ type: 'spray_can', paint: swatch.hex });
            finish('resume');
          });
          paints.appendChild(chip);
        }
        list.appendChild(paints);

        const equipment: readonly {
          readonly label: string;
          readonly detail: string;
          readonly request: DevSpawnItemRequest;
        }[] = [
          { label: 'medicine bottle', detail: 'E use · full recovery', request: { type: 'medicine' } },
          { label: 'binoculars', detail: 'E toggle · 10x', request: { type: 'binoculars' } },
          { label: 'torchlight', detail: 'E toggle beam', request: { type: 'torchlight' } },
          {
            label: 'professional camera',
            detail: `E viewfinder · ${CAMERA_FRAME_LIMIT} frames`,
            request: { type: 'camera' },
          },
          { label: 'football', detail: 'walk or sprint into it', request: { type: 'football' } },
          { label: 'pocket watch', detail: 'E wind +4 h', request: { type: 'pocket_watch' } },
          { label: 'postcard from home', detail: 'E read · E flip · E put away', request: { type: 'postcard' } },
          { label: 'green sun shades', detail: 'E equip · G remove', request: { type: 'sun_shades', tint: 'green' } },
          { label: 'yellow sun shades', detail: 'E equip · G remove', request: { type: 'sun_shades', tint: 'yellow' } },
          { label: 'red sun shades', detail: 'E equip · G remove', request: { type: 'sun_shades', tint: 'red' } },
        ];
        for (const spec of equipment) {
          const row = button('menu-body', '');
          const name = el('span', 'menu-body-label');
          name.textContent = spec.label;
          const detail = el('span', 'menu-body-class');
          detail.textContent = spec.detail;
          row.append(name, detail);
          row.addEventListener('click', () => {
            hooks.spawnItem?.(spec.request);
            finish('resume');
          });
          list.appendChild(row);
        }

        const stickerHeading = el('div', 'menu-body-group');
        stickerHeading.textContent = `sticker envelopes · ${STICKERS.length}`;
        list.appendChild(stickerHeading);
        for (const sticker of STICKERS) {
          const row = button('menu-body', '');
          const name = el('span', 'menu-body-label');
          name.textContent = sticker.label;
          const size = el('span', 'menu-body-class');
          size.textContent = `${Math.round(sticker.widthM * 100)} × ${Math.round(sticker.heightM * 100)} cm`;
          row.append(name, size);
          row.addEventListener('click', () => {
            hooks.spawnItem?.({ type: 'sticker_envelope', stickerKind: sticker.kind });
            finish('resume');
          });
          list.appendChild(row);
        }
        panel.appendChild(list);

        const note = el('div', 'menu-note');
        note.textContent = 'selected item drops at your feet';
        panel.appendChild(note);

        backBtn.focus();
      };
      const renderItem: (() => void) | null = import.meta.env.DEV ? renderItemScreen : null;

      /**
       * Dev part dispenser. Reads the registry rather than a hand-written list, so a
       * variant added to `ALL_VARIANTS` is spawnable the moment it exists, and drops
       * a real loose part: the same object a wreck yields, with the same pickup,
       * storage and mounting paths behind it.
       */
      const renderPartScreen = (): void => {
        panel.textContent = '';

        const { head, back: backBtn } = screenHead('Spawn part', () => showScreen('main'));
        panel.appendChild(head);

        const list = el('div', 'menu-body-list');
        // Grouped by kind, in registry order: the engines stay together and the
        // gearboxes do not interleave with them halfway down the list.
        const kinds: string[] = [];
        for (const part of ALL_VARIANTS) {
          if (!kinds.includes(part.kind)) kinds.push(part.kind);
        }
        for (const kind of kinds) {
          const heading = el('div', 'menu-body-group');
          heading.textContent = kind.replace(/_/g, ' ');
          list.appendChild(heading);

          for (const part of ALL_VARIANTS.filter((v) => v.kind === kind)) {
            const row = button('menu-body', '');
            const name = el('span', 'menu-body-label');
            name.textContent = part.label;
            const detail = el('span', 'menu-body-class');
            detail.textContent = `${part.mass} kg`;
            row.append(name, detail);
            row.addEventListener('click', () => {
              hooks.spawnPart?.(part.id);
              finish('resume');
            });
            list.appendChild(row);
          }
        }
        panel.appendChild(list);

        const note = el('div', 'menu-note');
        note.textContent = 'selected part drops at your feet, clean and unused';
        panel.appendChild(note);

        backBtn.focus();
      };
      const renderPart: (() => void) | null = import.meta.env.DEV ? renderPartScreen : null;

      showScreen('main');
    });
  }

  hidePause(): void {
    this.removePause();
  }

  private removePause(): void {
    if (this.pauseCleanup) {
      this.pauseCleanup();
      this.pauseCleanup = null;
    }
    if (this.pauseOverlay) {
      this.pauseOverlay.remove();
      this.pauseOverlay = null;
    }
  }
}
