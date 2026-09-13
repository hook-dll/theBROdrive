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

import { GAMEPLAY_CONFIG } from '../config';
import { BINDABLE_ACTIONS } from '../core/input';
export type GearboxMode = 'manual' | 'automatic';
export type TimeOfDayPreset = 'morning' | 'noon' | 'evening' | 'midnight';
/**
 * Rendering tier: the ONE ladder, and everything it owns.
 *
 * There used to be two controls — quality and view distance — and they were not two
 * axes at all. The horizon setting never changed what the world STREAMS: the desert
 * tiles (±2 of 240 m) and road chunks (±6 of 200 m) are the same at every tier. What it
 * changed was the far plane, the vista's ring tessellation, how many mesas are built,
 * and the fog. Measured on the vista, a cell load costs 13.0 ms at 1.5 km and 32.8 ms
 * at 25 km, and the mesa vertex count goes from 897 to 16 419. That is a "how much can
 * this machine afford" decision, which is exactly what the quality tier already is —
 * so as a free control it only offered a player the chance to pick 25 km on a machine
 * that cannot rebuild a cell inside a frame and hitch on every cell crossing.
 *
 * So one ladder owns all of it, and each rung is a coherent statement about a machine
 * rather than a knob.
 *
 * THE PIXEL NUMBERS ARE ABSOLUTE CEILINGS, and that is the second half of the fix. The
 * tiers used to resolve their resolution as `min(DPR x multiplier, DPR cap)` — a display
 * PERCENTAGE — for everything except `acceptable`, which was the only tier with an
 * absolute budget. On a display whose device-pixel-ratio is 1, which is every 4K
 * television and every monitor at 100% scaling, the percentage resolves to exactly 1.0
 * at every tier: a mini-PC on a 4K TV and a 4090 on a 4K TV were both asked for
 * 8.29 megapixels. Measured across the four devices this game is played on, `standard`
 * on an Intel N100 at 4K and `standard` on a 4090 at 4K were the same load, and the
 * only way down was `acceptable` at 1.44 Mpx — a 5.8x cliff, with no rung in between.
 *
 * An absolute ceiling makes a rung mean the same thing on a phone, a mini-PC and a
 * workstation. Below the ceiling the display's own sharpness still decides, and above
 * it a supersampling multiplier lets the top rung spend headroom it is told it has.
 */
export type GraphicsQuality = 'acceptable' | 'standard' | 'blessing';

/**
 * One rung. Every number here is a consequence of the same question — what can this
 * machine afford — which is what makes it a tier rather than a collection of switches.
 */
export interface GraphicsTier {
  /**
   * Absolute ceiling on rendered scene pixels, on a desktop presentation. The render
   * scale is `min(DPR x supersample, sqrt(ceiling / cssPixels))`, so a large display
   * cannot exceed this and a small one is never downscaled below its own sharpness.
   */
  readonly maxPixels: number;
  /** The same ceiling under phone presentation, where a DPR of 3 invites millions. */
  readonly mobileMaxPixels: number;
  /**
   * Absolute FLOOR on rendered scene pixels: where dynamic resolution stops. Absolute
   * rather than a fraction of the ceiling, because a fraction says nothing about what
   * the image looks like — 0.55 of a phone's budget and 0.55 of a 4K workstation's are
   * different pictures, and the whole point of a floor is the picture it guarantees.
   */
  readonly minPixels: number;
  readonly mobileMinPixels: number;
  /** Supersampling headroom above the display, for a rung told it has some. */
  readonly supersample: number;
  /** Sun shadow map. The one per-frame pass a weak machine cannot afford at any size. */
  readonly shadows: boolean;
  /** Default for `Settings.msaa`; a player may still choose otherwise. */
  readonly msaa: boolean;
  /**
   * Whether a phone presentation gets the sun shadow pass at this rung.
   *
   * Not a taste a rung may offer a phone. The shadow pass renders the world a SECOND
   * time from the light, and on a phone that is the largest single GPU cost in a frame
   * and a sustained one — the whole reason a phone gets warm rather than slow. A phone's
   * rung buys sharpness, so this is off on every rung and only the desktop column keeps
   * the choice.
   */
  readonly mobileShadows: boolean;
  /**
   * The desktop rung whose horizon and fog a phone presentation inherits.
   *
   * A phone's pixel cap does nothing for the vista, because the vista costs CPU terrain
   * sampling and that is set by RADIUS, not by how many pixels the screen has. Measured
   * on the vista with a 5950X: a cell rebuild costs 13.0 ms at 4 km, 17.3 ms at 8 km and
   * 32.8 ms at 25 km, and a phone core is slower than that — so the 25 km map is a
   * multi-frame hitch on every cell crossing. Naming an AUTHORED pair rather than
   * inventing a horizon keeps the fog the tuned one.
   */
  readonly mobileVista: GraphicsQuality;
  /** Catalogue star depth, as a limiting visual magnitude. */
  readonly starMagnitude: number;
  /** How far the desert is drawn before the fog dissolves it, metres. */
  readonly horizonM: number;
  /** Fog-density multiplier that keeps the horizon resolving instead of hazing out. */
  readonly fogScale: number;
  /**
   * Permanent spotlights compiled into every lit material, for car headlamps.
   *
   * A rung rather than a taste: the count is an ARRAY SIZE in the shader, so every lit
   * fragment pays for it whether or not a lamp is claiming the slot, and it can only
   * change by recompiling the world's materials. That is why the menu says so.
   */
  readonly vehicleLightSlots: number;
  /** The same, for the street-lamp pool. */
  readonly streetLightSlots: number;
  /** Reach multiplier for a projected headlamp beam; the top rung throws light further. */
  readonly headlightDistanceScale: number;
}

/**
 * The rungs, weakest first. Read them as three machines, not three presets:
 *
 *  - `acceptable` — a phone, or a mini-PC on a television. No shadow pass, because it is
 *    the one cost that cannot be paid in pixels. The authored horizon.
 *  - `standard` — an ordinary desktop with a discrete GPU or a good integrated one.
 *    Native on a 1440p display, shadows on, 8 km of horizon.
 *  - `blessing` — a machine with headroom to spare. Supersamples, 25 km of horizon,
 *    and a sky deep enough to be crowded rather than plotted.
 *
 * A rung is a statement about the MACHINE, and a phone is two machines at once: the one
 * that draws the picture and the one that gets hot. Its pixel ceiling and its vista are
 * the first; its shadow pass and its frame rate are the second — and the second is the
 * player's, because no browser will tell the game how warm the phone is.
 */
export const GRAPHICS_TIERS: Record<GraphicsQuality, GraphicsTier> = {
  acceptable: {
    maxPixels: 1600 * 900,
    mobileMaxPixels: 960 * 540,
    minPixels: 1280 * 720,
    mobileMinPixels: 640 * 360,
    supersample: 1,
    shadows: false,
    msaa: false,
    mobileShadows: false,
    mobileVista: 'acceptable',
    starMagnitude: 7,
    horizonM: 1500,
    fogScale: 1,
    vehicleLightSlots: 2,
    streetLightSlots: 2,
    headlightDistanceScale: 1,
  },
  standard: {
    maxPixels: 2560 * 1440,
    mobileMaxPixels: 1280 * 720,
    minPixels: 1600 * 900,
    mobileMinPixels: 960 * 540,
    supersample: 1,
    shadows: true,
    msaa: true,
    mobileShadows: false,
    mobileVista: 'standard',
    starMagnitude: 8,
    horizonM: 8000,
    fogScale: 0.42,
    vehicleLightSlots: 6,
    streetLightSlots: 6,
    headlightDistanceScale: 1,
  },
  blessing: {
    // 4800x2700, which is 4K with the 1.25x supersampling this rung always had.
    maxPixels: 4800 * 2700,
    mobileMaxPixels: 1600 * 900,
    minPixels: 1920 * 1080,
    mobileMinPixels: 1280 * 720,
    supersample: 1.25,
    shadows: true,
    msaa: true,
    mobileShadows: false,
    mobileVista: 'standard',
    starMagnitude: 8.5,
    horizonM: 25000,
    fogScale: 0.16,
    vehicleLightSlots: 18,
    streetLightSlots: 8,
    headlightDistanceScale: 3,
  },
};

/**
 * The rung whose vista a presentation actually gets, which is not always its own: a
 * phone inherits the authored pair its rung names. See `GraphicsTier.mobileVista`.
 */
function vistaRungFor(quality: GraphicsQuality, mobilePresentation: boolean): GraphicsQuality {
  return mobilePresentation ? GRAPHICS_TIERS[quality].mobileVista : quality;
}

/** Convenience readers, so callers ask the question they mean. */
export function viewDistanceFor(quality: GraphicsQuality, mobilePresentation: boolean): number {
  return GRAPHICS_TIERS[vistaRungFor(quality, mobilePresentation)].horizonM;
}

/** The fog that dissolves the horizon this presentation actually has. */
export function viewDistanceFogScaleFor(
  quality: GraphicsQuality,
  mobilePresentation: boolean,
): number {
  return GRAPHICS_TIERS[vistaRungFor(quality, mobilePresentation)].fogScale;
}

/** Whether this presentation pays for a sun shadow pass. */
export function shadowsFor(quality: GraphicsQuality, mobilePresentation: boolean): boolean {
  return mobilePresentation ? GRAPHICS_TIERS[quality].mobileShadows : GRAPHICS_TIERS[quality].shadows;
}

/**
 * Presentation cap in FPS.
 *
 * On a phone this is the player's own thermal setting, because a browser exposes no
 * thermal state, no battery temperature and no clock speed — the machine cannot say
 * whether it is hot, only the person holding it can. On a desktop there is no cap at
 * all: the adaptive controller already holds the GPU at its target by moving resolution,
 * and nothing there is running on a battery.
 */
export function presentationFpsFor(
  mobilePresentation: boolean,
  mobileFrameRate: number,
): number | null {
  return mobilePresentation ? mobileFrameRate : null;
}

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
  /** Maximum number of temporary road-traffic cars; zero disables traffic. */
  trafficCount: number;
  /** Action id -> key codes, overriding the defaults. Absent = default. */
  keyBindings: Record<string, readonly string[]>;
  /**
   * Rendering tier. A device preference rather than a taste one, but it lives
   * here with the rest so it survives a reload like every other choice.
   */
  graphicsQuality: GraphicsQuality;
  /** Four-sample geometry-edge antialiasing on the scene render target. */
  msaa: boolean;
  /**
   * Frames per second a phone presentation may present: 30 or 60.
   *
   * The one thermal control in the game, and it is the player's to make because nothing
   * else can make it. It is also the largest lever there is: half the frames is half the
   * GPU work, half the render-side CPU and half the presenting, while the simulation
   * keeps its fixed 60 Hz so the car still handles identically.
   *
   * Deliberately NOT on the rendering rung, which is where it used to live, because that
   * coupled a phone's sharpness to its heat: the only way off a blurry 960x540 picture on
   * a 1440p screen was to accept 60 FPS with it. How sharp the picture is and how warm
   * the phone gets are different questions and now have different answers.
   */
  mobileFrameRate: number;
  /** Post-process landscape outline amount, 0..1. */
  inkStrength: number;
  /**
   * Persistent precise control: mouse travel and A/D move one linear virtual wheel
   * that stays where the player leaves it. Off by default because standard steering
   * is the familiar self-centering keyboard behavior.
   */
  preciseSteering: boolean;
}

export const DAY_CYCLE_MIN_MINUTES = GAMEPLAY_CONFIG.dayCycleMinutesMin;
export const DAY_CYCLE_MAX_MINUTES = GAMEPLAY_CONFIG.dayCycleMinutesMax;
export const POI_SPACING_MIN_METRES = GAMEPLAY_CONFIG.poiSpacingMetresMin;
export const POI_SPACING_MAX_METRES = GAMEPLAY_CONFIG.poiSpacingMetresMax;
export const POI_SPACING_STEP_METRES = GAMEPLAY_CONFIG.poiSpacingMetresStep;
export const DEFAULT_POI_SPACING_METRES = GAMEPLAY_CONFIG.poiSpacingMetres;

export const DEFAULT_MASTER_VOLUME = GAMEPLAY_CONFIG.defaultMasterVolume;
export const DEFAULT_RADIO_VOLUME = GAMEPLAY_CONFIG.defaultRadioVolume;
export const DEFAULT_INK_STRENGTH = GAMEPLAY_CONFIG.defaultInkStrength;
export const DEFAULT_MOUSE_SENSITIVITY = GAMEPLAY_CONFIG.defaultMouseSensitivity;
export const MOUSE_SENSITIVITY_MIN = GAMEPLAY_CONFIG.mouseSensitivityMin;
export const MOUSE_SENSITIVITY_MAX = GAMEPLAY_CONFIG.mouseSensitivityMax;
export const TRAFFIC_COUNT_MIN = GAMEPLAY_CONFIG.trafficCountMin;
export const TRAFFIC_COUNT_MAX = GAMEPLAY_CONFIG.trafficCountMax;
export const TRAFFIC_COUNT_STEP = GAMEPLAY_CONFIG.trafficCountStep;
export const DEFAULT_TRAFFIC_COUNT = GAMEPLAY_CONFIG.defaultTrafficCount;

/** The frame rates a phone may present at. Cool first: it is the default. */
export const MOBILE_FRAME_RATES = [30, 60] as const;
export const DEFAULT_MOBILE_FRAME_RATE = 30;

/** Default day length in real minutes. */
const DEFAULT_DAY_CYCLE_MINUTES = GAMEPLAY_CONFIG.dayCycleMinutes;


export const DEFAULT_SETTINGS: Settings = {
  // Automatic by default: the gearbox is driver assist, not the game. Shifting by
  // hand stays one wheel notch away for anyone who wants it.
  gearboxMode: 'automatic',
  dayCycleMinutes: DEFAULT_DAY_CYCLE_MINUTES,
  poiSpacingMetres: DEFAULT_POI_SPACING_METRES,
  mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
  masterVolume: DEFAULT_MASTER_VOLUME,
  radioVolume: DEFAULT_RADIO_VOLUME,
  trafficCount: DEFAULT_TRAFFIC_COUNT,
  // Absent entries mean "use the default binding", so the empty record is the
  // correct default: it can never diverge from BINDABLE_ACTIONS. Shared by
  // design — Settings objects are replaced wholesale through world.apply
  // deltas, never mutated in place.
  keyBindings: {},
  // The authored look. Nothing auto-detects the GPU: guessing wrong either robs a
  // capable machine or leaves a weak one stuttering, and the pause menu is one
  // key away.
  graphicsQuality: 'standard',
  msaa: true,
  // Cool by default. A phone that is too slow can be made faster by moving up the
  // ladder; a phone that is too hot has no such lever, and heat is what damages it.
  mobileFrameRate: DEFAULT_MOBILE_FRAME_RATE,
  inkStrength: DEFAULT_INK_STRENGTH,
  // Off by default; M switches it on, and the pause menu remembers which.
  preciseSteering: false,
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
  const trafficCountRaw =
    typeof obj.trafficCount === 'number' && Number.isFinite(obj.trafficCount)
      ? obj.trafficCount
      : DEFAULT_TRAFFIC_COUNT;

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
    trafficCount:
      Math.round(
        Math.min(TRAFFIC_COUNT_MAX, Math.max(TRAFFIC_COUNT_MIN, trafficCountRaw)) /
          TRAFFIC_COUNT_STEP,
      ) * TRAFFIC_COUNT_STEP,
    inkStrength: unitInterval(obj.inkStrength, DEFAULT_INK_STRENGTH),
    keyBindings: {},
    // Anything unrecognised is standard, so an old save (which has no such field)
    // keeps the look it was made with.
    graphicsQuality:
      obj.graphicsQuality === 'acceptable' || obj.graphicsQuality === 'blessing'
        ? obj.graphicsQuality
        : 'standard',
    // A save's `viewDistance` is DELIBERATELY DROPPED rather than migrated. The horizon
    // is a property of the rendering rung now, and the two ladders do not line up: an old
    // save asking for `vast` on `acceptable` was a combination that should never have
    // been offerable, and there is no honest way to guess which half the player meant.
    // The tier they chose is the answer, and it is right there in the same object.
    // `eyeAdaptation` lived here once and is deliberately not migrated: exposure is
    // analytic now, so a stored preference has nothing left to select.
    // Preserve the old tier behavior once, then this becomes an independent choice.
    msaa:
      typeof obj.msaa === 'boolean'
        ? obj.msaa
        : obj.graphicsQuality !== 'acceptable',
    // Snap to an offered rate rather than clamping, so a hand-edited 31 or 144 cannot
    // become a frame rate the menu has no button for.
    mobileFrameRate:
      typeof obj.mobileFrameRate === 'number'
      && MOBILE_FRAME_RATES.some((rate) => rate === obj.mobileFrameRate)
        ? obj.mobileFrameRate
        : DEFAULT_MOBILE_FRAME_RATE,
    // `mouseSteering` is the pre-precise-control name in existing saves. Read it once;
    // every newly sanitized Settings object writes only the truthful new field.
    preciseSteering: obj.preciseSteering === true || obj.mouseSteering === true,
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
