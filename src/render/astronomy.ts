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
  phaseFraction: number;
}

export class CelestialFrame {
  readonly sun = makeBody(Body.Sun);
  readonly moon = makeBody(Body.Moon);
  readonly planets = PLANET_BODIES.map(makeBody);
  readonly equatorialToWorld = new THREE.Matrix4();
  readonly keyDirection = new THREE.Vector3(0, 1, 0);
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
    phaseFraction: 0,
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

/** Kasten-Young optical air mass; infinity below the geometric horizon. */
function airMass(altitudeDeg: number): number {
  if (altitudeDeg <= -1) return Number.POSITIVE_INFINITY;
  const a = Math.max(-0.99, altitudeDeg);
  return 1 / (
    Math.sin(THREE.MathUtils.degToRad(a)) +
    0.50572 * Math.pow(a + 6.07995, -1.6364)
  );
}

export function atmosphericTransmission(altitudeDeg: number): number {
  if (altitudeDeg <= 0) return 0;
  const mass = airMass(altitudeDeg);
  return Math.pow(10, -0.4 * BASE_EXTINCTION_MAG * Math.max(0, mass - 1));
}

function updateBody(body: ApparentBody, date: Date, observer: Observer): void {
  const equator = Equator(body.body, date, observer, true, true);
  const horizontal = Horizon(date, observer, equator.ra, equator.dec, 'normal');
  const illumination = Illumination(body.body, date);
  body.altitudeDeg = horizontal.altitude;
  body.azimuthDeg = horizontal.azimuth;
  body.magnitude = illumination.mag;
  body.phaseFraction = illumination.phase_fraction;
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
    if (Math.abs(milliseconds - this.lastUpdateMilliseconds) < 5_000) return frame;
    this.lastUpdateMilliseconds = milliseconds;
    frame.date = date;
    updateBody(frame.sun, date, this.observer);
    updateBody(frame.moon, date, this.observer);
    for (const planet of frame.planets) updateBody(planet, date, this.observer);


    const sunLux =
      SUN_REFERENCE_LUX *
      Math.pow(10, -0.4 * (frame.sun.magnitude - SUN_REFERENCE_MAG)) *
      atmosphericTransmission(frame.sun.altitudeDeg);
    const moonLux =
      FULL_MOON_REFERENCE_LUX *
      Math.pow(10, -0.4 * (frame.moon.magnitude - FULL_MOON_REFERENCE_MAG)) *
      atmosphericTransmission(frame.moon.altitudeDeg);

    if (sunLux >= moonLux) {
      frame.keyDirection.copy(frame.sun.direction);
      frame.keyIlluminanceLux = sunLux;
    } else {
      frame.keyDirection.copy(frame.moon.direction);
      frame.keyIlluminanceLux = moonLux;
    }
    frame.diffuseIlluminanceLux = sunLux * 0.16 + moonLux * 0.2 + 0.001;
    return frame;
  }
}
