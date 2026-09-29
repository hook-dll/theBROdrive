import gameplay from '../config/gameplay.json';
import audio from '../config/audio.json';
import graphics from '../config/graphics.json';
import materials from '../config/materials.json';

export interface MaterialsConfig {
  readonly paintRoughness: number;
  readonly paintMetalness: number;
}
export interface GameplayConfig {
  readonly dayCycleMinutes: number;
  /** Metres of arclength between POI slots (world/poi.ts `POI_SPACING`). */
  readonly poiSpacingMetres: number;
  readonly dayCycleMinutesMin: number;
  readonly dayCycleMinutesMax: number;
  readonly defaultMasterVolume: number;
  readonly defaultRadioVolume: number;
  readonly defaultInkStrength: number;
  readonly defaultMouseSensitivity: number;
  readonly mouseSensitivityMin: number;
  readonly mouseSensitivityMax: number;
  /**
   * Resting vertical field of view, degrees, and the bounds a player may set it to.
   *
   * Here rather than in the renderer because it is a preference with a default, like
   * the ink strength below it: `DEFAULT_FIELD_OF_VIEW` is what `Settings` starts at,
   * and the camera reads the setting rather than a constant of its own.
   */
  readonly fieldOfViewDegrees: number;
  readonly fieldOfViewMinDegrees: number;
  readonly fieldOfViewMaxDegrees: number;
}

export interface AudioConfig {
  readonly engineGain: number;
  readonly gearWhineGain: number;
  readonly windFullMps: number;
  readonly windGain: number;
  readonly tyreFullMps: number;
  /** Above `tyreFullMps` the tyre voice keeps growing, gently, until this speed. */
  readonly tyreTopMps: number;
  readonly tyreGain: number;
  readonly skidStartMps: number;
  readonly skidFullMps: number;
  readonly skidGain: number;
  readonly rubGain: number;
  readonly landingFullMps: number;
  readonly bumpStartMps: number;
  readonly bumpFullMps: number;
  readonly bumpGain: number;
  readonly impactGain: number;
  readonly trafficGain: number;
  readonly ambienceGain: number;
  readonly rainGain: number;
  readonly thunderGain: number;
  readonly wildlifeGain: number;
}

export interface GraphicsConfig {
  readonly shadowMapSize: number;
  readonly shadowFrustumHalfSize: number;
  readonly shadowNear: number;
  readonly shadowFar: number;
  readonly shadowBias: number;
  readonly shadowNormalBias: number;
  readonly hemisphereIntensityScale: number;
}

/**
 * Every field a config file MUST carry.
 *
 * Iterating the parsed JSON alone only proves that the keys PRESENT are numbers; a
 * missing one passed silently and reached the game as `undefined`. That is how
 * `defaultMouseSensitivity` disappeared from gameplay.json and turned the first
 * mouse movement into a NaN camera — an unrecoverable black screen, with nothing
 * logged anywhere. These maps are exhaustive by type, so deleting a key from a
 * config now fails the build instead of the frame.
 */
type Fields<T> = Record<keyof T, true>;

const MATERIALS_FIELDS: Fields<MaterialsConfig> = {
  paintRoughness: true,
  paintMetalness: true,
};

const GAMEPLAY_FIELDS: Fields<GameplayConfig> = {
  dayCycleMinutes: true,
  poiSpacingMetres: true,
  dayCycleMinutesMin: true,
  dayCycleMinutesMax: true,
  defaultMasterVolume: true,
  defaultRadioVolume: true,
  defaultInkStrength: true,
  defaultMouseSensitivity: true,
  mouseSensitivityMin: true,
  mouseSensitivityMax: true,
  fieldOfViewDegrees: true,
  fieldOfViewMinDegrees: true,
  fieldOfViewMaxDegrees: true,
};

const AUDIO_FIELDS: Fields<AudioConfig> = {
  engineGain: true,
  gearWhineGain: true,
  windFullMps: true,
  windGain: true,
  tyreFullMps: true,
  tyreTopMps: true,
  tyreGain: true,
  skidStartMps: true,
  skidFullMps: true,
  skidGain: true,
  rubGain: true,
  landingFullMps: true,
  bumpStartMps: true,
  bumpFullMps: true,
  bumpGain: true,
  impactGain: true,
  trafficGain: true,
  ambienceGain: true,
  rainGain: true,
  thunderGain: true,
  wildlifeGain: true,
};

const GRAPHICS_FIELDS: Fields<GraphicsConfig> = {
  shadowMapSize: true,
  shadowFrustumHalfSize: true,
  shadowNear: true,
  shadowFar: true,
  shadowBias: true,
  shadowNormalBias: true,
  hemisphereIntensityScale: true,
};

function validate<T extends object>(value: T, fields: Fields<T>, name: string): T {
  for (const [key, field] of Object.entries(value)) {
    if (!(key in fields)) throw new Error(`Unknown config ${name}.${key}`);
    if (typeof field !== 'number' || !Number.isFinite(field)) {
      throw new Error(`Invalid config ${name}.${key}: ${String(field)}`);
    }
  }
  for (const key of Object.keys(fields)) {
    if (!(key in value)) throw new Error(`Missing config ${name}.${key}`);
  }
  return value;
}

export const GAMEPLAY_CONFIG = validate(gameplay as GameplayConfig, GAMEPLAY_FIELDS, 'gameplay');
export const AUDIO_CONFIG = validate(audio as AudioConfig, AUDIO_FIELDS, 'audio');
export const GRAPHICS_CONFIG = validate(graphics as GraphicsConfig, GRAPHICS_FIELDS, 'graphics');
export const MATERIALS_CONFIG = validate(materials as MaterialsConfig, MATERIALS_FIELDS, 'materials');