import {
  Body,
  Equator,
  Horizon,
  Illumination,
  Observer,
} from 'astronomy-engine';
import { performance } from 'node:perf_hooks';

const observer = new Observer(27.15, -13.2, 70);
const localSolarNoonUtc = new Date('2026-03-20T12:52:48.000Z');
const sunEq = Equator(Body.Sun, localSolarNoonUtc, observer, true, true);
const sun = Horizon(localSolarNoonUtc, observer, sunEq.ra, sunEq.dec, 'normal');
if (sun.altitude < 61.5 || sun.altitude > 64.5) {
  throw new Error(`Equinox noon Sun altitude out of range: ${sun.altitude}`);
}
if (sun.azimuth < 175 || sun.azimuth > 185) {
  throw new Error(`Equinox noon Sun is not south: ${sun.azimuth}`);
}

const polaris = Horizon(localSolarNoonUtc, observer, 2 + 31 / 60 + 49 / 3600, 89.2641, 'normal');
if (polaris.altitude < 26 || polaris.altitude > 28.5) {
  throw new Error(`Polaris altitude does not match observer latitude: ${polaris.altitude}`);
}

const bodies = [Body.Sun, Body.Moon, Body.Mercury, Body.Venus, Body.Mars, Body.Jupiter, Body.Saturn, Body.Uranus, Body.Neptune];
const start = performance.now();
let checksum = 0;
for (let iteration = 0; iteration < 1000; iteration++) {
  const date = new Date(localSolarNoonUtc.getTime() + iteration * 60_000);
  for (const body of bodies) {
    const eq = Equator(body, date, observer, true, true);
    const hor = Horizon(date, observer, eq.ra, eq.dec, 'normal');
    const light = Illumination(body, date);
    if (![hor.altitude, hor.azimuth, light.mag].every(Number.isFinite)) {
      throw new Error(`${body} produced non-finite ephemeris output`);
    }
    checksum += hor.altitude + light.mag;
  }
}
const elapsed = performance.now() - start;
console.log(JSON.stringify({
  equinoxNoon: { altitudeDeg: sun.altitude, azimuthDeg: sun.azimuth },
  polarisAltitudeDeg: polaris.altitude,
  thousandNineBodyUpdatesMs: elapsed,
  averageUpdateMs: elapsed / 1000,
  checksum,
}, null, 2));
