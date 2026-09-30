/**
 * tools/look/night.mjs — a night drive on the hurried autopilot from the chase camera,
 * photographed whenever an oncoming car is 20-170 m ahead: for judging what other
 * cars' headlamps lay on the road (pools and the sheen on the asphalt).
 *
 *   npm run dev -- --port 5199          (in another terminal)
 *   node tools/look/night.mjs <outdir> [seconds]    (default 90)
 *
 * Environment: URL SEED TIER W H DPR KM HOUR (default 23) WET (0..1, forces rain-wet road).
 */
import fs from 'node:fs';
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const [out, secondsArg] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/look/night.mjs <outdir> [seconds]');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const seconds = +(secondsArg ?? 90);
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 600);
const URL = process.env.URL ?? 'http://localhost:5199/';

const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL, W, H, DPR: +(process.env.DPR ?? 1), SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  await page.evaluate(([km, hour]) => {
    const b = window.__bro;
    b.world.apply({ t: 'time_of_day', timeOfDay: hour * 60 });
    b.weather.force(null);
    b.jumpTo(km);
  }, [+(process.env.KM ?? 30), +(process.env.HOUR ?? 23)]);
  await until(page, () => window.__bro.settled(), null, 120000, 'the world at the start');
  await page.evaluate(() => {
    const b = window.__bro;
    const id = b.state().player.drivingCarId;
    const v = id ? b.vehicles.get(id) : null;
    // Off -> dipped.
    v?.cycleHeadlights();
    b.autopilot.setMode('hurried');
    b.autopilot.setEngaged(true);
  });

  let shot = 0;
  let cooldown = 0;
  const endAt = Date.now() + seconds * 1000;
  while (Date.now() < endAt) {
    const near = await page.evaluate(() => {
      const b = window.__bro;
      const a = b.autopilot;
      let best = null;
      for (const car of b.traffic.carList) {
        const rel = car.forwardS - a.hintS;
        const oncoming = car.direction !== 1;
        if (rel > 20 && rel < 170 && (best === null || rel < best.rel)) best = { rel: Math.round(rel), oncoming };
      }
      return best;
    });
    if (near && cooldown <= 0) {
      const name = `${out}/${String(shot++).padStart(3, '0')}-${near.oncoming ? 'on' : 'ahead'}-${near.rel}m.png`;
      await page.screenshot({ path: name });
      console.log(name);
      cooldown = 2;
    }
    cooldown--;
    await sleep(400);
  }
} finally {
  await browser.close();
}
