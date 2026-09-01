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
/** Sky illumination present before the direct solar disc clears the horizon. */
const TWILIGHT_DIFFUSE_LUX = 2_000;
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
    frame.keyIlluminanceLux = Math.max(sunLux, moonLux);

    // Civil-twilight sky bounce begins well before the direct disc. Previously
    // diffuse light was only a fraction of direct sunLux, so the whole environment
    // remained at moon level until the narrow horizon transmission gate opened.
    const twilight = smoothstep(-6, 6, frame.sun.altitudeDeg);
    frame.diffuseIlluminanceLux =
      sunLux * 0.16 + moonLux * 0.2 + twilight * TWILIGHT_DIFFUSE_LUX + 0.001;
    return frame;
  }
}
