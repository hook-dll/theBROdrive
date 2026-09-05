import gameplay from '../config/gameplay.json';
import audio from '../config/audio.json';
import graphics from '../config/graphics.json';

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

function validate<T extends object>(value: T, name: string): T {
  for (const [key, numberValue] of Object.entries(value)) {
    if (typeof numberValue !== 'number' || !Number.isFinite(numberValue)) {
      throw new Error(`Invalid config ${name}.${key}`);
    }
  }
  return value;
}

export const GAMEPLAY_CONFIG = validate(gameplay as GameplayConfig, 'gameplay');
export const AUDIO_CONFIG = validate(audio as AudioConfig, 'audio');
export const GRAPHICS_CONFIG = validate(graphics as GraphicsConfig, 'graphics');
