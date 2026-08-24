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
 * Rendering tier. Three points on one axis: how many pixels the scene is drawn at,
 * whether its edges are multisampled, and how many streetlamps are lit. None of it
 * touches the simulation, so a save plays identically under any of them.
 *
 *  - `acceptable`: for weak integrated GPUs. Measured on an Intel N100 / UHD
 *    Graphics, this is the difference between one frame in five missing its
 *    deadline and none of them doing so.
 *  - `standard`: the authored look, native resolution, edges smoothed.
 *  - `blessing`: for a machine with pixels to spare. Renders ABOVE native and
 *    downsamples, which is the one thing that genuinely removes aliasing from the
 *    ink outlines and the far dune ridges rather than merely softening it.
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
}

export const DAY_CYCLE_MIN_MINUTES = 8;
export const DAY_CYCLE_MAX_MINUTES = 128;

export const DEFAULT_MASTER_VOLUME = 0.8;
export const DEFAULT_RADIO_VOLUME = 0.6;
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
};

/**
 * Fraction of the in-game day each preset maps to (0..1 of DAY_LENGTH).
 *
 * Chosen against the sun geometry in src/render/sky.ts:
 *   phase = (dayFrac - 0.25) * 2π
 *   sunElevation = asin(sin(phase) * cos(SOUTH_TILT))   // SOUTH_TILT = 0.45 rad
 *   isNight = sunElevation < NIGHT_ELEVATION (-0.08 rad)
 * so the sun crosses the horizon at dayFrac 0.25 (rise) and 0.75 (set), peaks
 * at 0.5 and bottoms out at 0.0.
 *   - noon:     0.50 -> elevation +64.2°, the apex; south of the zenith.
 *   - midnight: 0.00 -> elevation -64.2°, deep night: isNight is true and the
 *     star fade is fully in.
 *   - morning:  0.34 -> elevation +28.8°: full daylight (the day factor
 *     saturates at 0.3 rad) but the sun still low in the east with long
 *     shadows, and clearly earlier than the 0.36 (~35°) mid-morning start of a
 *     new game so the preset reads as a different time of day.
 *   - evening:  0.72 -> elevation +9.7° and falling: the sunset glow factor is
 *     ~0.66, so the horizon is warmly lit while isNight is still false.
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

  const sensitivityRaw =
    typeof obj.mouseSensitivity === 'number' && Number.isFinite(obj.mouseSensitivity)
      ? obj.mouseSensitivity
      : DEFAULT_MOUSE_SENSITIVITY;

  // A missing volume means an old save from before there was any sound: it gets
  // the default, not silence.
  const volume = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : fallback;

  const settings: Settings = {
    // Anything that is not exactly the automatic string is manual: the
    // historical mode, and the safe fallback for garbage input.
    gearboxMode: obj.gearboxMode === 'automatic' ? 'automatic' : 'manual',
    dayCycleMinutes: Math.min(DAY_CYCLE_MAX_MINUTES, Math.max(DAY_CYCLE_MIN_MINUTES, dayCycleRaw)),
    mouseSensitivity: Math.min(MOUSE_SENSITIVITY_MAX, Math.max(MOUSE_SENSITIVITY_MIN, sensitivityRaw)),
    masterVolume: volume(obj.masterVolume, DEFAULT_MASTER_VOLUME),
    radioVolume: volume(obj.radioVolume, DEFAULT_RADIO_VOLUME),
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
