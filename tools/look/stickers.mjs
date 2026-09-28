/**
 * tools/look/stickers.mjs
 *
 * The sticker catalog, looked at: the whole atlas as one PNG, then the driven car
 * covered with every design (`__bro.stickerSheet`) on a real autopilot drive, chase
 * camera from four sides, clean, then scratched, then dusty — the layer order the
 * paint shader promises (clean paint, stickers, scratches, dust).
 *
 *   npm run dev -- --port 5199          (in another terminal)
 *   node tools/look/stickers.mjs <outdir>
 *
 * Environment as far.mjs (URL SEED TIER W H DPR), plus KM (default 3). Kill the dev
 * server when done: the user runs their own.
 */
import fs from 'node:fs';
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const [out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/look/stickers.mjs <outdir>');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 720);
const URL = process.env.URL ?? 'http://localhost:5199/';

const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL, W, H, DPR: +(process.env.DPR ?? 1), SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  const png = await page.evaluate(() => window.__bro.stickerAtlasPng());
  fs.writeFileSync(`${out}/atlas.png`, Buffer.from(png.split(',')[1], 'base64'));
  await page.evaluate((km) => {
    const b = window.__bro;
    b.world.apply({ t: 'time_of_day', timeOfDay: 15 * 60 });
    b.weather.force('clear');
    b.jumpTo(km);
  }, +(process.env.KM ?? 3));
  await until(page, () => window.__bro.settled(), null, 120000, 'the world');
  const count = await page.evaluate(() => window.__bro.stickerSheet());
  console.log(`${count} stickers placed`);
  // One frame in motion first: the print must ride the panel, not slide over it.
  await page.evaluate(() => {
    const b = window.__bro;
    b.autopilot.setMode('hurried');
    b.autopilot.setEngaged(true);
  });
  await sleep(5000);
  await page.screenshot({ path: `${out}/driving-0.png` });
  await sleep(700);
  await page.screenshot({ path: `${out}/driving-1.png` });
  await page.evaluate(() => window.__bro.autopilot.setEngaged(false));
  await sleep(6000);

  // Then a close orbit of the parked car. The chase rig recentres behind the car after
  // a moment of no look input, so the yaw is re-set every frame while it settles.
  const orbit = async (name, yawOffset) => {
    await page.evaluate((off) => {
      const b = window.__bro;
      clearInterval(window.__orbit);
      window.__orbit = setInterval(() => {
        const q = b.vehicles.get(b.world.state.player.drivingCarId).chassis.rotation();
        const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
        b.camera.setYaw(yaw + Math.PI + off);
        b.camera.pitch = b.camera.drivingPitch = -0.35;
        b.camera.logDistance = Math.log(3.6);
      }, 16);
    }, yawOffset);
    await sleep(1500);
    await page.screenshot({ path: `${out}/${name}.png` });
  };
  for (const [state, dirt, scratches] of [['clean', 0, 0], ['scratched', 0, 0.8], ['dusty', 0.75, 0.5]]) {
    await page.evaluate(([d, sc]) => {
      const b = window.__bro;
      b.world.apply({ t: 'car_body_condition', carId: b.world.state.player.drivingCarId, dirt: d, scratches: sc });
    }, [dirt, scratches]);
    for (const [view, yawOffset] of [['rear', 0.5], ['left', Math.PI / 2], ['front', Math.PI - 0.5], ['right', -Math.PI / 2]]) {
      if (state !== 'clean' && (view === 'front' || view === 'right')) continue;
      await orbit(`${state}-${view}`, yawOffset);
    }
  }
} finally {
  await browser.close();
}
