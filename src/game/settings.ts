/**
 * Player preferences, carried in the authoritative state so they survive saves
 * and can be changed from the pause menu without touching device code.
 *
 * Settings are preferences, not simulation: nothing here may reference
 * Three.js, Rapier or the input devices. The wiring that turns them into
 * behaviour lives at the edges — InputReader.setKeyBindings() for keys,
 * Vehicle/Drivetrain for the gearbox mode, the loop's TIME_SCALE for the day
 * length.
 */

import { BINDABLE_ACTIONS } from '../core/input';

export type GearboxMode = 'manual' | 'automatic';
export type TimeOfDayPreset = 'morning' | 'noon' | 'evening' | 'midnight';
/**
 * Rendering tier. Three deliberately separate internal-resolution targets; shadow
 * and streetlight budgets follow the same low/standard/high ordering. MSAA remains
 * an independent option.
 *
 *  - `acceptable`: 60% of native and adaptive below that for weak integrated GPUs.
 *  - `standard`: the authored look at native resolution.
 *  - `blessing`: up to 2x native resolution per axis, locked against adaptive
 *    downscaling. The final resolve into the display is supersampling, not a quality
 *    reduction: four internal pixels contribute to each native pixel.
 */
export type GraphicsQuality = 'acceptable' | 'standard' | 'blessing';

/**
 * View-distance tier. Three points on one axis: how far the desert is drawn
 * before the fog dissolves it. None of it touches the simulation, so a save
 * plays identically at any of them.
 *
 *  - `near`: 1.5 km, the authored horizon and the cheapest tier. It is what the
 *    game already drew before the setting existed.
 *  - `far`: 8 km, for a machine that can afford a deep horizon.
 *  - `vast`: 25 km, deliberately extravagant. An immersive horizon is a thing a
 *    player should be able to spend a machine on, and this is the top of that
 *    ladder; it is the most expensive tier by a wide margin because the far
 *    plane, and therefore the depth budget, must stretch to match.
 *
 * The fog scales below are why the tiers work at all (see
 * VIEW_DISTANCE_FOG_SCALE): the fog is exponential and tuned so the world
 * dissolves at ~1.5 km, so a wider draw distance without a matching thinning of
 * the fog draws nothing new.
 */
export type ViewDistance = 'near' | 'far' | 'vast';

/** Draw distance per tier, metres from the player. */
export const VIEW_DISTANCE_METRES: Record<ViewDistance, number> = {
  near: 1500,
  far: 8000,
  vast: 25000,
};

/**
 * Fog-density multiplier per tier. The fog is `FogExp2` — exponential — and
 * tuned so the world dissolves into the haze at ~1.5 km at density 1. A wider
 * draw distance without a matching thinning of the fog draws desert the fog has
 * already hidden, so each tier thins the fog to keep its horizon resolving
 * rather than turning into a haze wall a little further away.
 */
export const VIEW_DISTANCE_FOG_SCALE: Record<ViewDistance, number> = {
  near: 1,
  far: 0.42,
  vast: 0.16,
};

export interface Settings {
  gearboxMode: GearboxMode;
  /** Real minutes for one full day+night cycle. Clamped to [8, 128]. */
  dayCycleMinutes: number;
  /** Metres between POI slots. Clamped to 500..5000 in 100 m increments. */
  poiSpacingMetres: number;
  /**
   * Mouse-look radians per CSS pixel. Stored as a preference so pointer lock has
   * the same feel across sessions.
   */
  mouseSensitivity: number;
  /**
   * Volume of the synthesised game audio (engine, wind, tyres, foley), 0..1. The
   * radio has its own, because it is broadcast material at whatever level the
   * station mastered it and balancing it against the car is a taste decision.
   */
  masterVolume: number;
  /** Car-radio volume, 0..1. */
  radioVolume: number;
  /** Action id -> key codes, overriding the defaults. Absent = default. */
  keyBindings: Record<string, readonly string[]>;
  /**
   * Rendering tier. A device preference rather than a taste one, but it lives
   * here with the rest so it survives a reload like every other choice.
   */
  graphicsQuality: GraphicsQuality;
  /**
   * How far the desert is drawn. A machine preference like `graphicsQuality`,
   * but stored here with the rest so it survives a reload like every other
   * choice.
   */
  viewDistance: ViewDistance;
  /** Four-sample geometry-edge antialiasing on the scene render target. */
  msaa: boolean;
  /** Post-process landscape outline amount, 0..1. */
  inkStrength: number;
  /**
   * Steer the car with horizontal mouse movement. Off by default: the keyboard is
   * the control everyone arrives expecting, and a mouse that suddenly steers is a
   * car in a ditch. Holding the right button hands the mouse back to the camera
   * without disturbing the wheel.
   */
  mouseSteering: boolean;
}

export const DAY_CYCLE_MIN_MINUTES = 8;
export const DAY_CYCLE_MAX_MINUTES = 128;
export const POI_SPACING_MIN_METRES = 500;
export const POI_SPACING_MAX_METRES = 5000;
export const POI_SPACING_STEP_METRES = 100;
export const DEFAULT_POI_SPACING_METRES = 1200;

export const DEFAULT_MASTER_VOLUME = 0.8;
export const DEFAULT_RADIO_VOLUME = 0.6;
export const DEFAULT_INK_STRENGTH = 0.6;
export const DEFAULT_MOUSE_SENSITIVITY = 0.0022;
export const MOUSE_SENSITIVITY_MIN = 0.0004;
export const MOUSE_SENSITIVITY_MAX = 0.006;

/**
 * Default day length in real minutes. 24 matches state.ts's DAY_LENGTH
 * (24 * 60 s) at TIME_SCALE 1 — the historical behaviour; a faster or slower
 * cycle is opt-in.
 */
const DEFAULT_DAY_CYCLE_MINUTES = 24;

export const DEFAULT_SETTINGS: Settings = {
  // Automatic by default: the gearbox is driver assist, not the game. Shifting by
  // hand stays one wheel notch away for anyone who wants it.
  gearboxMode: 'automatic',
  dayCycleMinutes: DEFAULT_DAY_CYCLE_MINUTES,
  poiSpacingMetres: DEFAULT_POI_SPACING_METRES,
  mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
  masterVolume: DEFAULT_MASTER_VOLUME,
  radioVolume: DEFAULT_RADIO_VOLUME,
  // Absent entries mean "use the default binding", so the empty record is the
  // correct default: it can never diverge from BINDABLE_ACTIONS. Shared by
  // design — Settings objects are replaced wholesale through world.apply
  // deltas, never mutated in place.
  keyBindings: {},
  // The authored look. Nothing auto-detects the GPU: guessing wrong either robs a
  // capable machine or leaves a weak one stuttering, and the pause menu is one
  // key away.
  graphicsQuality: 'standard',
  // The authored horizon. Like `graphicsQuality`, nothing auto-detects the GPU;
  // the pause menu is one key away and the near tier is the safe floor.
  viewDistance: 'near',
  msaa: true,
  inkStrength: DEFAULT_INK_STRENGTH,
  // Off by default; M switches it on, and the pause menu remembers which.
  mouseSteering: false,
};

/**
 * Fractions of the local mean-solar game clock. Astronomy is date-dependent, so
 * these are camera-friendly clock presets rather than fixed celestial elevations:
 * seasons and lunar phase remain untouched.
 */
export const TIME_OF_DAY_PRESETS: Record<TimeOfDayPreset, number> = {
  morning: 0.34,
  noon: 0.5,
  evening: 0.72,
  midnight: 0.0,
};

/** Known action ids, for dropping unknown keys out of hand-edited bindings. */
const BINDABLE_IDS: Record<string, true> = {};
for (const action of BINDABLE_ACTIONS) BINDABLE_IDS[action.id] = true;

/**
 * Rebuilds a valid Settings from anything: fresh defaults, an old save with no
 * settings field, or hand-edited JSON. Unknown action ids and malformed binding
 * values are dropped (the action keeps its default keys); the day length is
 * clamped into [8, 128]. Returns a fresh object, never aliasing the input, so
 * the caller can store it in state without sharing mutable memory.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const obj =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const dayCycleRaw =
    typeof obj.dayCycleMinutes === 'number' && Number.isFinite(obj.dayCycleMinutes)
      ? obj.dayCycleMinutes
      : DEFAULT_DAY_CYCLE_MINUTES;
  const poiSpacingRaw =
    typeof obj.poiSpacingMetres === 'number' && Number.isFinite(obj.poiSpacingMetres)
      ? obj.poiSpacingMetres
      : DEFAULT_POI_SPACING_METRES;

  const sensitivityRaw =
    typeof obj.mouseSensitivity === 'number' && Number.isFinite(obj.mouseSensitivity)
      ? obj.mouseSensitivity
      : DEFAULT_MOUSE_SENSITIVITY;

  // Missing unit-interval settings mean an old save: use the authored default.
  const unitInterval = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : fallback;

  const settings: Settings = {
    // Anything that is not exactly the automatic string is manual: the
    // historical mode, and the safe fallback for garbage input.
    gearboxMode: obj.gearboxMode === 'automatic' ? 'automatic' : 'manual',
    dayCycleMinutes: Math.min(DAY_CYCLE_MAX_MINUTES, Math.max(DAY_CYCLE_MIN_MINUTES, dayCycleRaw)),
    poiSpacingMetres:
      Math.round(
        Math.min(POI_SPACING_MAX_METRES, Math.max(POI_SPACING_MIN_METRES, poiSpacingRaw)) /
          POI_SPACING_STEP_METRES,
      ) * POI_SPACING_STEP_METRES,
    mouseSensitivity: Math.min(MOUSE_SENSITIVITY_MAX, Math.max(MOUSE_SENSITIVITY_MIN, sensitivityRaw)),
    masterVolume: unitInterval(obj.masterVolume, DEFAULT_MASTER_VOLUME),
    radioVolume: unitInterval(obj.radioVolume, DEFAULT_RADIO_VOLUME),
    inkStrength: unitInterval(obj.inkStrength, DEFAULT_INK_STRENGTH),
    keyBindings: {},
    // Anything unrecognised is standard, so an old save (which has no such field)
    // keeps the look it was made with.
    graphicsQuality:
      obj.graphicsQuality === 'acceptable' || obj.graphicsQuality === 'blessing'
        ? obj.graphicsQuality
        : 'standard',
    // Anything unrecognised is near, so an old save (which has no such field)
    // keeps the horizon it was made with.
    viewDistance:
      obj.viewDistance === 'far' || obj.viewDistance === 'vast' ? obj.viewDistance : 'near',
    // `eyeAdaptation` lived here once and is deliberately not migrated: exposure is
    // analytic now, so a stored preference has nothing left to select.
    // Preserve the old tier behavior once, then this becomes an independent choice.
    msaa:
      typeof obj.msaa === 'boolean'
        ? obj.msaa
        : obj.graphicsQuality !== 'acceptable',
    // Anything but an explicit true is off, which is what an old save (no such
    // field) should get: nothing surprising happens the first time you drive it.
    mouseSteering: obj.mouseSteering === true,
  };

  const rawBindings = obj.keyBindings;
  if (typeof rawBindings === 'object' && rawBindings !== null && !Array.isArray(rawBindings)) {
    for (const [id, value] of Object.entries(rawBindings as Record<string, unknown>)) {
      if (!(id in BINDABLE_IDS)) continue;
      if (!Array.isArray(value)) continue;
      const codes: string[] = [];
      for (const code of value) if (typeof code === 'string') codes.push(code);
      // An empty binding is treated as absent: falling back to the default keys
      // is always safer than silently unbinding an action.
      if (codes.length > 0) settings.keyBindings[id] = codes;
    }
  }
  return settings;
}

/**
 * Where preferences live BETWEEN drives, and why that is not the save file.
 *
 * `Settings` is stored inside `WorldState`, so it travels in the save — which is
 * right for the ones that describe a playthrough (gearbox mode, day length) and
 * wrong for every one that describes the MACHINE. Graphics quality and view
 * distance are properties of the GPU in front of the player, not of a drive, and
 * putting them in the save meant starting a new drive silently reset them to
 * `standard`/`near`: set them once, start a fresh drive, and they were gone.
 *
 * So they are mirrored here as well, keyed per browser rather than per save. On
 * load this copy wins over whatever the save carried, because the machine has not
 * changed since the last session and the save may be years old or from another
 * computer entirely.
 *
 * Everything goes through `sanitizeSettings` on the way out, which already accepts
 * arbitrary JSON — so a corrupted or hand-edited entry degrades to defaults instead
 * of breaking the boot. Nothing here throws: a browser with storage disabled or a
 * full quota simply gets the old per-save behaviour back.
 */
const SETTINGS_KEY = 'brodrive-settings-v1';

/** The stored preferences, or null if there are none or they cannot be read. */
export function loadStoredSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return null;
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Mirrors preferences to browser storage. Called on every settings change. */
export function storeSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage disabled or full. Preferences still apply for this session; they
    // just will not outlive it, which is exactly the old behaviour.
  }
}
