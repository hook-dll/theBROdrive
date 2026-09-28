/**
 * tools/look/dirt.mjs
 *
 * The driven car's dust on paint, glass and lenses, on a real autopilot drive: for each
 * dirt level, a few chase-camera frames a second apart (to catch anything sliding over
 * the body as the car moves) from behind and from the rear three-quarter.
 *
 *   npm run dev -- --port 5199          (in another terminal)
 *   node tools/look/dirt.mjs <outdir> [levels=0.5,0.95]
 *
 * Environment as far.mjs (URL SEED TIER W H DPR), plus KM (default 3). Kill the dev
 * server when done: the user runs their own.
 */
import fs from 'node:fs';
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const [out, levels = '0.5,0.95'] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/look/dirt.mjs <outdir> [levels]');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 600);
const URL = process.env.URL ?? 'http://localhost:5199/';

const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL, W, H, DPR: +(process.env.DPR ?? 1), SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  await page.evaluate((km) => {
    const b = window.__bro;
    b.world.apply({ t: 'time_of_day', timeOfDay: 14 * 60 });
    b.jumpTo(km);
  }, +(process.env.KM ?? 3));
  await until(page, () => window.__bro.settled(), null, 120000, 'the world');
  await page.evaluate(() => {
    const b = window.__bro;
    b.autopilot.setMode('hurried');
    b.autopilot.setEngaged(true);
  });
  await sleep(6000);
  for (const level of levels.split(',')) {
    await page.evaluate((dirt) => {
      const b = window.__bro;
      const carId = b.world.state.player.drivingCarId;
      b.world.apply({ t: 'car_body_condition', carId, dirt, scratches: 0.1 });
    }, +level);
    for (const [view, yawOffset] of [['rear', 0], ['quarter', 0.7]]) {
      for (let f = 0; f < 3; f++) {
        await page.evaluate((off) => {
          const b = window.__bro;
          const v = b.vehicles.get(b.world.state.player.drivingCarId);
          const q = v.chassis.rotation();
          // Car heading from its quaternion; the chase camera looks along it.
          const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
          b.camera.setYaw(yaw + Math.PI + off);
          b.camera.pitch = b.camera.drivingPitch = -0.12;
        }, yawOffset);
        await sleep(900);
        await page.screenshot({ path: `${out}/dirt${level}-${view}-${f}.png` });
      }
    }
  }
} finally {
  await browser.close();
}
