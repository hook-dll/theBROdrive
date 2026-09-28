/**
 * tools/look/frantic.mjs
 *
 * The frantic driver in the real game, from the chase camera, logged twice a second and
 * photographed in bursts, so a pass can be judged by eye frame by frame rather than from
 * a bench number. Two ways to watch it:
 *
 *   WATCH=self (default)  the player's own car on its frantic autopilot in the real
 *                         stream; a burst whenever it starts a pass — through the
 *                         middle, over the crown or on the verge.
 *   WATCH=npc             the player's car on its hurried autopilot, and a burst whenever
 *                         an ambient frantic driver comes within `NEAR_M` behind it: the
 *                         car the player is meant to see coming up the mirror and go by.
 *
 *   npm run build:dev && npx vite preview --port 5199   (in another terminal)
 *   node tools/look/frantic.mjs <outdir> [seconds]  (default 90)
 *
 * Environment as hitch.mjs (URL SEED TIER W H DPR KM). Kill the preview server when
 * done: the user runs their own.
 */
import fs from 'node:fs';
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const [out, secondsArg] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/look/frantic.mjs <outdir> [seconds]');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const seconds = +(secondsArg ?? 90);
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 600);
const URL = process.env.URL ?? 'http://localhost:5199/';
const WATCH = process.env.WATCH ?? 'self';
const NEAR_M = 45;

const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL, W, H, DPR: +(process.env.DPR ?? 1), SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  await page.evaluate((km) => window.__bro.jumpTo(km), +(process.env.KM ?? 3));
  await until(page, () => window.__bro.settled(), null, 120000, 'the world at the start');
  await page.evaluate((mode) => {
    const b = window.__bro;
    b.autopilot.setMode(mode);
    b.autopilot.setEngaged(true);
  }, WATCH === 'npc' ? 'hurried' : 'frantic');

  let burst = 0;
  let shot = 0;
  let wasPassing = false;
  const endAt = Date.now() + seconds * 1000;
  while (Date.now() < endAt) {
    // Private fields are read by name: this is a dev tool looking at a dev build.
    const state = await page.evaluate(() => {
      const b = window.__bro;
      const a = b.autopilot;
      const v = a.controlledVehicle;
      const cars = b.traffic.carList;
      let yielding = 0;
      let frantic = null;
      for (const car of cars) {
        if (car.autopilot.yieldValue > 0.3) yielding++;
        if (car.style !== 'frantic' || car.direction !== 1) continue;
        const rel = car.forwardS - a.hintS;
        if (!frantic || Math.abs(rel) < Math.abs(frantic.rel)) {
          frantic = {
            rel: Math.round(rel),
            lat: +car.roadLateral.toFixed(1),
            kmh: Math.round(car.vehicle.speedKmh),
            activity: car.autopilot.activity,
            middle: car.autopilot.middlePassing,
            model: car.modelId,
          };
        }
      }
      return {
        s: Math.round(a.hintS),
        kmh: Math.round(Math.hypot(v?.chassis.linvel().x ?? 0, v?.chassis.linvel().z ?? 0) * 3.6),
        target: Math.round(a.targetSpeedValue * 3.6),
        activity: a.activity,
        middle: a.middlePassing,
        urge: a.passUrge,
        line: +a.planLine.toFixed(2),
        yielding,
        cars: cars.length,
        frantic,
      };
    });
    const f = state.frantic;
    console.log(
      `s${state.s} ${state.kmh}>${state.target} km/h ${state.activity}${state.middle ? ' MIDDLE' : ''}` +
        `${state.urge ? ' urge' : ''} line ${state.line} yielding ${state.yielding}/${state.cars}` +
        (f ? ` | frantic ${f.model} ${f.rel} m lat ${f.lat} ${f.kmh} km/h ${f.activity}${f.middle ? ' MIDDLE' : ''}` : ''),
    );
    const passing =
      WATCH === 'npc'
        ? !!f && f.rel > -NEAR_M && f.rel < 15
        : state.activity === 'pass' || state.activity === 'avoid' || state.middle;
    if (passing && !wasPassing) burst = 10;
    wasPassing = passing;
    if (burst > 0) {
      burst--;
      const tag = WATCH === 'npc' ? `f${f?.rel ?? 'x'}` : `${state.activity}${state.middle ? '-middle' : ''}`;
      await page.screenshot({ path: `${out}/${String(shot++).padStart(3, '0')}-s${state.s}-${tag}.png` });
    }
    await sleep(burst > 0 ? 250 : 500);
  }
} finally {
  await browser.close();
}
