import * as THREE from 'three';
import {
  Body,
  Equator,
  Horizon,
  Illumination,
  Observer,
  Rotation_EQJ_HOR,
} from 'astronomy-engine';
import {
  astronomicalDate,
  OBSERVER_ELEVATION_M,
  OBSERVER_LATITUDE_DEG,
  OBSERVER_LONGITUDE_DEG,
} from '../game/calendar';
import { DAY_LENGTH } from '../game/state';

const AU_KM = 149_597_870.7;
const SUN_RADIUS_AU = 695_700 / AU_KM;
const MOON_RADIUS_AU = 1_737.4 / AU_KM;
const BASE_EXTINCTION_MAG = 0.2;
const SUN_REFERENCE_MAG = -26.74;
const SUN_REFERENCE_LUX = 120_000;
const FULL_MOON_REFERENCE_MAG = -12.74;
const FULL_MOON_REFERENCE_LUX = 0.25;
/** Broad hand-off band: one key light rotates from Moon to Sun through twilight. */
const SUN_KEY_BLEND_START_DEG = -2;
const SUN_KEY_BLEND_END_DEG = 3;
/**
 * Twilight sky illuminance, as horizontal lux, at the moment the Sun's centre
 * touches the horizon. Roughly the measured clear-sky figure for sunset.
 */
const TWILIGHT_HORIZON_LUX = 400;
/**
 * Degrees of solar depression per e-fold of that sky light.
 *
 * Twilight decays close to exponentially with the Sun's depth below the horizon:
 * about 400 lux at the geometric horizon, 3 lux at the end of civil twilight
 * (-6 degrees), a hundredth of a lux around nautical (-12), and nothing that
 * outshines the stars by astronomical (-18). 1.26 degrees per e-fold is the fit
 * through those anchors.
 *
 * WHY AN EXPONENTIAL AND NOT A smoothstep: this term IS the entire sky bounce
 * once the direct disc is gone, and a smoothstep hits EXACTLY ZERO at its lower
 * edge. It used to, at -6 degrees, and below that the only diffuse light left was
 * a 0.001 lux epsilon. The exposure below divides by that illuminance, so the
 * scene held full brightness right up to -6 degrees and then fell off a cliff
 * inside the quarter-degree the smoothstep needed to reach zero -- under a second
 * of any day length, which is why the step looked identical however slow the
 * clock was set. An exponential has no lower edge to fall off.
 */
const TWILIGHT_DECAY_DEG = 1.26;
/**
 * Airglow, zodiacal light and integrated starlight: what a moonless desert sky
 * still puts on the ground. Small, but a real floor rather than an epsilon, so
 * the illuminance this module reports is never a number picked to avoid a divide.
 */
const NIGHT_SKY_LUX = 0.002;
const KEY_IDENTITY_ROTATION = new THREE.Quaternion();
const KEY_TARGET_ROTATION = new THREE.Quaternion();
const KEY_BLEND_ROTATION = new THREE.Quaternion();

export const PLANET_BODIES = [
  Body.Mercury,
  Body.Venus,
  Body.Mars,
  Body.Jupiter,
  Body.Saturn,
  Body.Uranus,
  Body.Neptune,
] as const;

export interface ApparentBody {
  readonly body: Body;
  readonly direction: THREE.Vector3;
  altitudeDeg: number;
  azimuthDeg: number;
  magnitude: number;
  angularRadiusRad: number;
}

export class CelestialFrame {
  readonly sun = makeBody(Body.Sun);
  readonly moon = makeBody(Body.Moon);
  readonly planets = PLANET_BODIES.map(makeBody);
  readonly equatorialToWorld = new THREE.Matrix4();
  readonly keyDirection = new THREE.Vector3(0, 1, 0);
  /** Smooth share of the shadow key coming from the Sun, 0..1. */
  keySunWeight = 0;
  keyIlluminanceLux = 0;
  diffuseIlluminanceLux = 0;
  date = new Date(0);
}

function makeBody(body: Body): ApparentBody {
  return {
    body,
    direction: new THREE.Vector3(),
    altitudeDeg: -90,
    azimuthDeg: 0,
    magnitude: 99,
    angularRadiusRad: 0,
  };
}

function horizontalDirection(azimuthDeg: number, altitudeDeg: number, out: THREE.Vector3): void {
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const altitude = THREE.MathUtils.degToRad(altitudeDeg);
  const horizontal = Math.cos(altitude);
  out.set(
    horizontal * Math.sin(azimuth),
    Math.sin(altitude),
    horizontal * Math.cos(azimuth),
  );
}

/** Kasten-Young optical air mass, extended smoothly for the horizon transition. */
function airMass(altitudeDeg: number): number {
  const a = Math.max(-0.99, altitudeDeg);
  return 1 / (
    Math.sin(THREE.MathUtils.degToRad(a)) +
    0.50572 * Math.pow(a + 6.07995, -1.6364)
  );
}

export function atmosphericTransmission(altitudeDeg: number): number {
  // Refraction, the solar disc's finite diameter and sky scattering make sunrise a
  // band, not an event at altitude zero. The old -0.12..0.08 degree gate packed the
  // entire direct-light onset into under a second at the default clock.
  const horizon = smoothstep(-1.5, 3, altitudeDeg);
  const mass = airMass(Math.max(0.01, altitudeDeg));
  return horizon * Math.pow(10, -0.4 * BASE_EXTINCTION_MAG * Math.max(0, mass - 1));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function updateBody(body: ApparentBody, date: Date, observer: Observer): void {
  const equator = Equator(body.body, date, observer, true, true);
  const horizontal = Horizon(date, observer, equator.ra, equator.dec, 'normal');
  const illumination = Illumination(body.body, date);
  body.altitudeDeg = horizontal.altitude;
  body.azimuthDeg = horizontal.azimuth;
  body.magnitude = illumination.mag;
  horizontalDirection(horizontal.azimuth, horizontal.altitude, body.direction);

  if (body.body === Body.Sun) {
    body.angularRadiusRad = Math.atan(SUN_RADIUS_AU / illumination.geo_dist);
  } else if (body.body === Body.Moon) {
    body.angularRadiusRad = Math.atan(MOON_RADIUS_AU / illumination.geo_dist);
  } else {
    body.angularRadiusRad = 0;
  }
}

export class AstronomySystem {
  readonly frame = new CelestialFrame();
  private readonly observer = new Observer(
    OBSERVER_LATITUDE_DEG,
    OBSERVER_LONGITUDE_DEG,
    OBSERVER_ELEVATION_M,
  );
  private lastUpdateMilliseconds = Number.NaN;

  update(calendarEpoch: string, dayIndex: number, timeOfDay: number): CelestialFrame {
    const date = astronomicalDate(calendarEpoch, dayIndex, timeOfDay, DAY_LENGTH);
    const frame = this.frame;
    const rotation = Rotation_EQJ_HOR(date, this.observer).rot;
    // Star rotation must follow every rendered clock value. Caching it with the
    // slower planetary ephemeris produced visible jumps on long day settings.
    frame.equatorialToWorld.set(
      -rotation[1][0], -rotation[1][1], -rotation[1][2], 0,
       rotation[2][0],  rotation[2][1],  rotation[2][2], 0,
       rotation[0][0],  rotation[0][1],  rotation[0][2], 0,
       0, 0, 0, 1,
    );
    const milliseconds = date.getTime();
    frame.date = date;
    // Sun and Moon drive scene illumination and must be refreshed every frame.
    // Planetary positions can retain their cheaper five-second cadence.
    updateBody(frame.sun, date, this.observer);
    updateBody(frame.moon, date, this.observer);
    if (Math.abs(milliseconds - this.lastUpdateMilliseconds) >= 5_000) {
      this.lastUpdateMilliseconds = milliseconds;
      for (const planet of frame.planets) updateBody(planet, date, this.observer);
    }

    const sunLux =
      SUN_REFERENCE_LUX *
      Math.pow(10, -0.4 * (frame.sun.magnitude - SUN_REFERENCE_MAG)) *
      atmosphericTransmission(frame.sun.altitudeDeg);
    const moonLux =
      FULL_MOON_REFERENCE_LUX *
      Math.pow(10, -0.4 * (frame.moon.magnitude - FULL_MOON_REFERENCE_MAG)) *
      atmosphericTransmission(frame.moon.altitudeDeg);
    // Rotate the single shadow key across a broad twilight band. Normalizing a
    // linear direction blend is singular when Sun and Moon are opposite: at equal
    // weights its vector collapses toward zero, then flips at the horizon. A
    // quaternion slerp follows a unit-length arc and cannot produce that step.
    frame.keySunWeight = smoothstep(
      SUN_KEY_BLEND_START_DEG,
      SUN_KEY_BLEND_END_DEG,
      frame.sun.altitudeDeg,
    );
    KEY_TARGET_ROTATION.setFromUnitVectors(frame.moon.direction, frame.sun.direction);
    KEY_BLEND_ROTATION.slerpQuaternions(
      KEY_IDENTITY_ROTATION,
      KEY_TARGET_ROTATION,
      frame.keySunWeight,
    );
    frame.keyDirection.copy(frame.moon.direction).applyQuaternion(KEY_BLEND_ROTATION).normalize();
    // The key's BRIGHTNESS rides the same weight as its direction and, in sky.ts,
    // its colour — so one number describes the whole hand-over and the three can
    // never disagree. `Math.max` used to pick the brighter of the two instead,
    // which is a corner wherever they cross: the Sun overtakes a full Moon at
    // about 1.2 degrees of depression, and there the key's output stepped by an
    // order of magnitude between one frame and the next while its direction and
    // colour were still the Moon's.
    frame.keyIlluminanceLux = moonLux + (sunLux - moonLux) * frame.keySunWeight;

    // Sky bounce. Three sources, all continuous in solar altitude, because the
    // exposure downstream is a reciprocal of their sum and inherits every kink:
    //
    //  - the daylight sky, a fixed share of the direct beam it scatters;
    //  - moonlight scattered the same way;
    //  - twilight, decaying exponentially with solar depression and pinned above
    //    the horizon, where the beam term has already taken over as the larger of
    //    the two (1400 lux against 400 by three degrees up).
    //
    // Plus the night-sky floor, which is what the sum settles on once the Sun is
    // deep enough that nothing else contributes.
    const twilightLux =
      TWILIGHT_HORIZON_LUX *
      Math.exp(Math.min(frame.sun.altitudeDeg, 0) / TWILIGHT_DECAY_DEG);
    frame.diffuseIlluminanceLux =
      sunLux * 0.16 + moonLux * 0.2 + twilightLux + NIGHT_SKY_LUX;
    return frame;
  }
}
