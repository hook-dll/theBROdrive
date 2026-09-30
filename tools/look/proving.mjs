/**
 * tools/look/proving.mjs
 *
 * The proving-ground cars in the real game: each one in turn is dropped on the road
 * (`__bro.driveModel`), driven on the autopilot from the chase camera, logged once a
 * second and photographed every `SHOT_S`, so a model's stance, body fit and road
 * manners can be judged by eye rather than from a bench number.
 *
 *   npm run build:dev && npx vite preview --port 5199   (in another terminal)
 *   node tools/look/proving.mjs <outdir> [seconds per car] [modelId ...]
 *
 * Environment as hitch.mjs (URL SEED TIER W H DPR KM; MODE is the autopilot mode,
 * default 'hurried'). Kill the preview server when done: the user runs their own.
 */
import fs from 'node:fs';
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const [out, secondsArg, ...modelArgs] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/look/proving.mjs <outdir> [seconds per car] [modelId ...]');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const seconds = +(secondsArg ?? 40);
const models = modelArgs.length > 0 ? modelArgs : [
  'pg_2cv', 'pg_mini', 'pg_911sc', 'pg_mustang', 'pg_defender',
  'pg_t2', 'pg_elise', 'pg_testarossa', 'pg_integrale',
];
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 600);
const URL = process.env.URL ?? 'http://localhost:5199/';
const MODE = process.env.MODE ?? 'hurried';
const SHOT_S = 10;

const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL, W, H, DPR: +(process.env.DPR ?? 1), SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  let km = +(process.env.KM ?? 3);
  for (const model of models) {
    await page.evaluate((k) => window.__bro.jumpTo(k), km);
    await until(page, () => window.__bro.settled(), null, 120000, `the world at ${km} km`);
    await page.evaluate((id) => window.__bro.driveModel(id), model);
    await sleep(1500);
    await page.evaluate((k) => window.__bro.jumpTo(k), km);
    await until(page, () => window.__bro.settled(), null, 120000, `the world at ${km} km`);
    await page.evaluate((mode) => {
      const a = window.__bro.autopilot;
      a.setMode(mode);
      a.setEngaged(true);
    }, MODE);

    let top = 0;
    const log = [];
    for (let t = 1; t <= seconds; t++) {
      await sleep(1000);
      const s = await page.evaluate(() => {
        const b = window.__bro;
        const st = b.state();
        const id = st.player.drivingCarId;
        const car = id ? st.cars[id] : null;
        const v = b.autopilot.controlledVehicle;
        const lv = v?.chassis.linvel();
        return {
          model: car?.modelId ?? null,
          kmh: lv ? Math.round(Math.hypot(lv.x, lv.z) * 3.6) : 0,
          activity: b.autopilot.activity,
        };
      });
      top = Math.max(top, s.kmh);
      log.push(`${t}s ${s.model} ${s.kmh} km/h ${s.activity}`);
      if (t % SHOT_S === 0) {
        await page.screenshot({ path: `${out}/${model}-${String(t).padStart(3, '0')}.png` });
      }
    }
    fs.writeFileSync(`${out}/${model}.log`, `${log.join('\n')}\n`);
    console.log(`${model}: top ${top} km/h over ${seconds} s; last: ${log.at(-1)}`);
    km += 4;
  }
} finally {
  await browser.close();
}
