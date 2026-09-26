/**
 * The settings, described as data: what each page holds, in what order, with which bounds
 * and which words.
 *
 * The pages are not written as DOM. A row says what it is — an enum of three answers, a
 * slider between two numbers, a toggle, the key list — and `menu.ts` renders all four kinds
 * once. That is why a new setting is one entry here rather than a new hand-built field, and
 * why the reset button, the keyboard walk and the hint line work on every row without being
 * written for it.
 *
 * The description is a FUNCTION of the live settings, not a constant: several rows quote
 * numbers the player's own choices decide — the pixels a render scale resolves to on this
 * window, the kilometres a view distance step reaches, whether the rung above this one
 * exists — and a table built once at import time would quote whatever was true then.
 */

import {
  DAY_CYCLE_MAX_MINUTES,
  DAY_CYCLE_MIN_MINUTES,
  DEFAULT_MOUSE_SENSITIVITY,
  DETAIL_AXES,
  FIELD_OF_VIEW_MAX,
  FIELD_OF_VIEW_MIN,
  FRAME_RATE_LIMITS,
  GRAPHICS_TIERS,
  LANGUAGES,
  MOUSE_SENSITIVITY_MAX,
  MOUSE_SENSITIVITY_MIN,
  POI_SPACING_MAX_METRES,
  POI_SPACING_MIN_METRES,
  POI_SPACING_STEP_METRES,
  RENDER_SCALES,
  UNITS,
  VIEW_DISTANCE_AXES,
  WEATHER_FORCES,
  detailRungFor,
  horizonMetresFor,
  shadowsFor,
  starMagnitudeFor,
  streetLightSlotsFor,
  vehicleLightSlotsFor,
  type DetailAxis,
  type GraphicsQuality,
  type Language,
  type Settings,
  type SettingsCategory,
  type TimeOfDayPreset,
  type Units,
  type ViewDistanceAxis,
  type WeatherForce,
} from '../game/settings';
import { manualRenderScale, renderScaleFor } from '../core/renderer';
import { GRASS_BAND_M, TREE_MODEL_RANGE_M } from './settingsfacts';
import { formattedDistance, distanceUnitKey } from './units';
import { format, type StringKey } from './i18n';

/** The reader of the tables, as `i18n.ts` hands it out: one per language. */
export type Translate = (key: StringKey, vars?: Record<string, string | number>) => string;

/** A hint is either a sentence or something that has to be worked out when it is read. */
export type Hint = string | (() => string);

/** A hint as text. The only reader of the two shapes, so the only place they are told apart. */
export function resolveHint(hint: Hint): string {
  return typeof hint === 'string' ? hint : hint();
}

/**
 * A stored setting as the text an option is compared against.
 *
 * `null` — an automatic render scale, no frame cap — is spelled `null`, and a number is its
 * own text. One function for both directions of the comparison, so a value cannot match its
 * own option in the menu and not in the stepper.
 */
export function enumToken(value: unknown): string {
  return value === null ? 'null' : String(value);
}

/** The token back as a value: `null`, a number, or the string itself. */
export function enumValue(token: string): unknown {
  if (token === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  return token;
}

export interface SettingOption {
  /**
   * The option's value, as TEXT.
   *
   * Compared against the stored setting through `enumToken`, so a numeric setting (`0.85`),
   * a string one (`standard`) and one that may be null (`null` — an automatic render scale or
   * no frame cap) all speak the same language here. A row is a list of names for values; how
   * a value is stored is the settings model's business, not the menu's.
   */
  readonly value: string;
  readonly label: string;
  readonly hint: Hint;
}

/** A chip or a button that belongs to one row rather than beside it. */
export interface SettingAction {
  readonly label: string;
  readonly hint: Hint;
  readonly run: () => void;
}

export interface SettingHead {
  /** Live text beside the label: who picked the rung, and the source's own explanation. */
  readonly chip?: { readonly text: () => string; readonly hint: () => string };
  readonly actions?: readonly SettingAction[];
}

export type SettingKind = 'enum' | 'toggle' | 'slider' | 'keys' | 'action';

export interface SettingRow {
  /**
   * The setting this row edits, or null for a row that edits nothing persistent.
   *
   * The time-of-day row is the one null: moving the sun is an action, not a preference, and
   * a row that had to name a field to exist would have had to invent one.
   */
  readonly key: (keyof Settings & string) | null;
  readonly kind: SettingKind;
  readonly label: string;
  readonly hint: Hint;
  readonly head?: SettingHead;
  /** enum only, and never empty. */
  readonly options: readonly SettingOption[];
  /** action only. */
  readonly actions: readonly SettingAction[];
  /** slider only. */
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
}

export interface SettingsPage {
  readonly id: SettingsCategory;
  readonly title: string;
  readonly hint: string;
  readonly rows: readonly SettingRow[];
}

/**
 * What a row needs to know about the machine it will be displayed on.
 *
 * Taken from the caller rather than read here: the canvas's CSS size and the device pixel
 * ratio are display facts the renderer already resolves (cinema mode shortens the canvas
 * and not the window), and a row that quotes a resolution the game is not rendering is the
 * drift the sharpness control exists to end.
 */
export interface SettingsEnvironment {
  readonly devicePixelRatio: number;
  readonly mobilePresentation: boolean;
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** Restarts the launch to measure the GPU again; absent on a phone, which is never timed. */
  readonly measure?: () => void;
  /**
   * Moves the sun to a clock preset. An action rather than a value: the time of day is
   * part of the running world, not a preference, and it is the one row here that is
   * visible the instant it is pressed — behind a paused frame, nobody can see it.
   */
  readonly timePreset?: (preset: TimeOfDayPreset) => void;
}

const NO_OPTIONS: readonly SettingOption[] = [];
const NO_ACTIONS: readonly SettingAction[] = [];

/** A row with neither options nor a range: the toggle, the key list and the actions. */
function plainRow(
  key: (keyof Settings & string) | null,
  kind: 'toggle' | 'keys' | 'action',
  label: string,
  hint: Hint,
  actions: readonly SettingAction[] = NO_ACTIONS,
): SettingRow {
  return {
    key,
    kind,
    label,
    hint,
    options: NO_OPTIONS,
    actions,
    min: 0,
    max: 0,
    step: 0,
    format: String,
  };
}

function enumRow(
  key: keyof Settings & string,
  label: string,
  hint: Hint,
  options: readonly SettingOption[],
  head?: SettingHead,
): SettingRow {
  return {
    key,
    kind: 'enum',
    label,
    hint,
    options,
    actions: NO_ACTIONS,
    min: 0,
    max: 0,
    step: 0,
    format: String,
    head,
  };
}

function sliderRow(
  key: keyof Settings & string,
  label: string,
  hint: Hint,
  min: number,
  max: number,
  step: number,
  format: (value: number) => string,
): SettingRow {
  return {
    key,
    kind: 'slider',
    label,
    hint,
    options: NO_OPTIONS,
    actions: NO_ACTIONS,
    min,
    max,
    step,
    format,
  };
}

/** Megapixels, to two places: the unit every resolution argument in this project is had in. */
function mpx(width: number, height: number): string {
  return ((width * height) / 1_000_000).toFixed(2);
}

/** The rung's own numbers, as a sentence built from the table rather than typed beside it. */
function describeQuality(
  quality: GraphicsQuality,
  environment: SettingsEnvironment,
  tr: Translate,
): string {
  const tier = GRAPHICS_TIERS[quality];
  const mobile = environment.mobilePresentation;
  const pixels = mobile ? tier.mobileMaxPixels : tier.maxPixels;
  const side = Math.round(Math.sqrt(pixels));
  const horizon = horizonMetresFor(quality, mobile, 'auto') / 1000;
  return format(tr('set.quality.numbers'), {
    mpx: mpx(side, side),
    shadows: shadowsFor(quality, mobile) ? tr('set.quality.shadowsOn') : tr('set.quality.shadowsOff'),
    km: Number.isInteger(horizon) ? String(horizon) : horizon.toFixed(1),
    spots: vehicleLightSlotsFor(quality, mobile),
    points: streetLightSlotsFor(quality, mobile),
    stars: starMagnitudeFor(quality, mobile),
  });
}

/** The picture the sharpness row is choosing between, on this window. */
function pixelsFor(
  environment: SettingsEnvironment,
  quality: GraphicsQuality,
  tr: Translate,
  ratio: number | null,
): string {
  const cssPixels = Math.max(1, environment.cssWidth * environment.cssHeight);
  const scale = ratio === null
    ? renderScaleFor(quality, cssPixels, environment.devicePixelRatio, environment.mobilePresentation)
    : manualRenderScale(
        cssPixels,
        environment.devicePixelRatio,
        environment.mobilePresentation,
        ratio,
      );
  const width = Math.max(1, Math.floor(environment.cssWidth * scale));
  const height = Math.max(1, Math.floor(environment.cssHeight * scale));
  return format(tr('set.renderScale.px'), { width, height, mpx: mpx(width, height) });
}

const QUALITY_LABEL: Record<GraphicsQuality, StringKey> = {
  acceptable: 'set.quality.low',
  standard: 'set.quality.mid',
  blessing: 'set.quality.high',
};

const VIEW_DISTANCE_LABEL: Record<ViewDistanceAxis, StringKey> = {
  near: 'set.viewDistance.near',
  auto: 'set.viewDistance.auto',
  far: 'set.viewDistance.far',
};

const DETAIL_LABEL: Record<DetailAxis, StringKey> = {
  low: 'set.detail.low',
  auto: 'set.detail.auto',
  high: 'set.detail.high',
};

const WEATHER_LABEL: Record<WeatherForce, StringKey> = {
  auto: 'set.weather.auto',
  clear: 'set.weather.clear',
  overcast: 'set.weather.overcast',
  rain: 'set.weather.rain',
};

const QUALITY_SOURCE_LABEL: Record<string, StringKey> = {
  default: 'set.quality.source.default',
  device: 'set.quality.source.device',
  measured: 'set.quality.source.measured',
  chosen: 'set.quality.source.chosen',
};

const QUALITY_SOURCE_NOTE: Record<string, StringKey> = {
  default: 'set.quality.source.default.note',
  device: 'set.quality.source.device.note',
  measured: 'set.quality.source.measured.note',
  chosen: 'set.quality.source.chosen.note',
};

/** The graphics page, whose rows quote each other's numbers and so are built together. */
function graphicsRows(
  settings: Settings,
  environment: SettingsEnvironment,
  tr: Translate,
): readonly SettingRow[] {
  const mobile = environment.mobilePresentation;
  const qualityOptions: SettingOption[] = (['acceptable', 'standard', 'blessing'] as const).map(
    (quality) => ({
      value: quality,
      label: tr(QUALITY_LABEL[quality]),
      hint: describeQuality(quality, environment, tr),
    }),
  );

  const viewOptions: SettingOption[] = VIEW_DISTANCE_AXES.map((axis) => ({
    value: axis,
    label: tr(VIEW_DISTANCE_LABEL[axis]),
    hint: () => {
      // Quoted against the rung the player is on: the axis multiplies the rung, so the number
      // only means anything next to it.
      const metres = horizonMetresFor(settings.graphicsQuality, mobile, axis);
      return format(tr('set.viewDistance.at'), { km: (metres / 1000).toFixed(metres < 3000 ? 1 : 0) });
    },
  }));

  const detailOptions: SettingOption[] = DETAIL_AXES.map((axis) => ({
    value: axis,
    label: tr(DETAIL_LABEL[axis]),
    hint: () => {
      const rung = detailRungFor(settings.graphicsQuality, axis);
      return format(tr('set.detail.numbers'), {
        grass: GRASS_BAND_M[rung],
        trees: TREE_MODEL_RANGE_M[rung],
      });
    },
  }));

  const scaleOptions: SettingOption[] = [
    {
      value: 'null',
      label: tr('set.renderScale.auto'),
      hint: () => format(tr('set.renderScale.autoHint'), {
        px: pixelsFor(environment, settings.graphicsQuality, tr, null),
      }),
    },
    ...RENDER_SCALES.map((fraction) => ({
      value: String(fraction),
      label: `${Math.round(fraction * 100)}%`,
      hint: () =>
        `${pixelsFor(environment, settings.graphicsQuality, tr, fraction)}. `
        + (fraction > 1 ? tr('set.renderScale.upscale') + ' ' : '')
        + tr('set.renderScale.fixed'),
    })),
  ];

  const fpsOptions: SettingOption[] = [
    ...FRAME_RATE_LIMITS.map((rate) => ({
      value: String(rate),
      label: String(rate),
      hint: format(tr('set.fps.option'), { rate }),
    })),
    { value: 'null', label: tr('set.fps.max'), hint: tr('set.fps.maxHint') },
  ];

  // The head of the picture row: who picked the rung, and the one action on it. A row of its
  // own would need a label, and that label would have to name a concept ("rung source") the
  // player has never met.
  const sourceHead: SettingHead = {
    chip: {
      text: () => tr(QUALITY_SOURCE_LABEL[settings.graphicsQualitySource] ?? 'set.quality.source.chosen'),
      hint: () => tr(QUALITY_SOURCE_NOTE[settings.graphicsQualitySource] ?? 'set.quality.source.chosen.note'),
    },
    actions: environment.measure === undefined
      ? undefined
      : [
          {
            label: tr('set.quality.measure'),
            hint: tr('set.quality.measure.hint'),
            run: environment.measure,
          },
        ],
  };

  return [
    enumRow('graphicsQuality', tr('set.quality.level'), tr('set.quality.hint'), qualityOptions, sourceHead),
    enumRow('viewDistance', tr('set.viewDistance'), tr('set.viewDistance.hint'), viewOptions),
    enumRow('detail', tr('set.detail'), tr('set.detail.hint'), detailOptions),
    enumRow('renderScale', tr('set.renderScale'), tr('set.renderScale.hint'), scaleOptions),
    plainRow('msaa', 'toggle', tr('set.msaa'), tr('set.msaa.hint')),
    enumRow('frameRateLimit', tr('set.fps'), tr('set.fps.hint'), fpsOptions),
  ];
}

/**
 * The six pages, in the order the tabs are drawn.
 *
 * `settings` is the WORKING copy the screen is editing, which is what lets a row's hint
 * quote the choice next to it — the detail row asks the picture row which rung is selected.
 */
export function settingsPages(
  settings: Settings,
  environment: SettingsEnvironment,
  tr: Translate,
): readonly SettingsPage[] {
  const units: Units = settings.units;
  const percent = (value: number): string => `${Math.round(value * 100)}%`;

  return [
    {
      id: 'gameplay',
      title: tr('set.tab.gameplay'),
      hint: tr('set.tab.gameplay.hint'),
      rows: [
        // The one row that is not a preference. It is here because the sun is exactly what
        // a player wants to move when the light is wrong, and a pause menu is where he is
        // standing when he thinks of it.
        plainRow(
          null,
          'action',
          tr('set.time'),
          tr('set.time.hint'),
          (['morning', 'noon', 'evening', 'midnight'] as const).map((preset) => ({
            label: tr(
              preset === 'morning'
                ? 'set.time.morning'
                : preset === 'noon'
                  ? 'set.time.noon'
                  : preset === 'evening'
                    ? 'set.time.evening'
                    : 'set.time.night',
            ),
            hint: tr('set.time.hint'),
            run: () => environment.timePreset?.(preset),
          })),
        ),
        enumRow('gearboxMode', tr('set.gearbox'), tr('set.gearbox.hint'), [
          { value: 'manual', label: tr('set.gearbox.manual'), hint: tr('set.gearbox.hint') },
          { value: 'automatic', label: tr('set.gearbox.auto'), hint: tr('set.gearbox.hint') },
        ]),
        enumRow('weather', tr('set.weather'), tr('set.weather.hint'), WEATHER_FORCES.map((force) => ({
          value: force,
          label: tr(WEATHER_LABEL[force]),
          hint: tr('set.weather.hint'),
        }))),
        sliderRow(
          'dayCycleMinutes',
          tr('set.dayLength'),
          tr('set.dayLength.hint'),
          DAY_CYCLE_MIN_MINUTES,
          DAY_CYCLE_MAX_MINUTES,
          1,
          (value) => format(tr('set.minutes'), { n: Math.round(value) }),
        ),
        sliderRow(
          'poiSpacingMetres',
          tr('set.poiSpacing'),
          tr('set.poiSpacing.hint'),
          POI_SPACING_MIN_METRES,
          POI_SPACING_MAX_METRES,
          POI_SPACING_STEP_METRES,
          (value) => `${formattedDistance(value, units, value % 1000 === 0 ? 0 : 1)} ${tr(distanceUnitKey(units))}`,
        ),
        plainRow('bouncyCars', 'toggle', tr('set.bouncy'), tr('set.bouncy.hint')),
      ],
    },
    {
      id: 'graphics',
      title: tr('set.tab.graphics'),
      hint: tr('set.tab.graphics.hint'),
      rows: graphicsRows(settings, environment, tr),
    },
    {
      id: 'display',
      title: tr('set.tab.display'),
      hint: tr('set.tab.display.hint'),
      rows: [
        sliderRow(
          'fieldOfView',
          tr('set.fov'),
          tr('set.fov.hint'),
          FIELD_OF_VIEW_MIN,
          FIELD_OF_VIEW_MAX,
          1,
          (value) => `${Math.round(value)}\u00b0`,
        ),
        sliderRow(
          'mouseSensitivity',
          tr('set.mouse'),
          tr('set.mouse.hint'),
          MOUSE_SENSITIVITY_MIN,
          MOUSE_SENSITIVITY_MAX,
          0.0001,
          (value) => `${Math.round((value / DEFAULT_MOUSE_SENSITIVITY) * 100)}%`,
        ),
        plainRow('preciseSteering', 'toggle', tr('set.precise'), tr('set.precise.hint')),
      ],
    },
    {
      id: 'audio',
      title: tr('set.tab.audio'),
      hint: tr('set.tab.audio.hint'),
      rows: [
        sliderRow('masterVolume', tr('set.master'), tr('set.master.hint'), 0, 1, 0.01, percent),
        sliderRow('radioVolume', tr('set.radio'), tr('set.radio.hint'), 0, 1, 0.01, percent),
        sliderRow('uiVolume', tr('set.ui'), tr('set.ui.hint'), 0, 1, 0.01, percent),
      ],
    },
    {
      id: 'controls',
      title: tr('set.tab.controls'),
      hint: tr('set.tab.controls.hint'),
      rows: [plainRow('keyBindings', 'keys', tr('set.keys'), tr('set.keysSummary'))],
    },
    {
      id: 'system',
      title: tr('set.tab.system'),
      hint: tr('set.tab.system.hint'),
      rows: [
        enumRow('language', tr('set.language'), tr('set.language.hint'), LANGUAGES.map((code) => ({
          value: code,
          label: tr(code === 'ru' ? 'lang.ru' : 'lang.en'),
          hint: tr('set.language.hint'),
        }))),
        enumRow('units', tr('set.units'), tr('set.units.hint'), UNITS.map((unit) => ({
          value: unit,
          label: tr(unit === 'km' ? 'first.units.km' : 'first.units.mi'),
          hint: tr('set.units.hint'),
        }))),
      ],
    },
  ];
}

/** A language name in the language itself, for the first-run card and the settings row. */
export function languageName(language: Language, tr: Translate): string {
  return tr(language === 'ru' ? 'lang.ru' : 'lang.en');
}
