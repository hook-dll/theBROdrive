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
  readonly poiSpacingMetres: number;
  readonly dayCycleMinutesMin: number;
  readonly dayCycleMinutesMax: number;
  readonly poiSpacingMetresMin: number;
  readonly poiSpacingMetresMax: number;
  readonly poiSpacingMetresStep: number;
  readonly defaultMasterVolume: number;
  readonly defaultRadioVolume: number;
  readonly defaultInkStrength: number;
  readonly defaultMouseSensitivity: number;
  readonly mouseSensitivityMin: number;
  readonly mouseSensitivityMax: number;
  readonly trafficCountMin: number;
  readonly trafficCountMax: number;
  readonly trafficCountStep: number;
  readonly defaultTrafficCount: number;
}

export interface AudioConfig {
  readonly windFullMps: number;
  readonly windGain: number;
  readonly tyreFullMps: number;
  readonly tyreGain: number;
  readonly skidStartMps: number;
  readonly skidFullMps: number;
  readonly skidGain: number;
  readonly rubGain: number;
  readonly engineGainIdle: number;
  readonly engineGainLoad: number;
  readonly destroyedMetalGain: number;
  readonly landingFullMps: number;
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
  poiSpacingMetresMin: true,
  poiSpacingMetresMax: true,
  poiSpacingMetresStep: true,
  defaultMasterVolume: true,
  defaultRadioVolume: true,
  defaultInkStrength: true,
  defaultMouseSensitivity: true,
  mouseSensitivityMin: true,
  mouseSensitivityMax: true,
  trafficCountMin: true,
  trafficCountMax: true,
  trafficCountStep: true,
  defaultTrafficCount: true,
};

const AUDIO_FIELDS: Fields<AudioConfig> = {
  windFullMps: true,
  windGain: true,
  tyreFullMps: true,
  tyreGain: true,
  skidStartMps: true,
  skidFullMps: true,
  skidGain: true,
  rubGain: true,
  engineGainIdle: true,
  engineGainLoad: true,
  destroyedMetalGain: true,
  landingFullMps: true,
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