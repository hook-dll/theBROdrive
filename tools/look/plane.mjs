/**
 * tools/look/plane.mjs — screenshots of the story's light plane in `?plane-lab`.
 *
 *   npm run dev -- --port 5199          (in another terminal)
 *   node tools/look/plane.mjs <outdir> 'name:azimuth:elevation:distance[:targetY[:targetZ[:hour]]],...'
 *
 * Azimuth 0 looks at the nose from ahead; PI/2 at the left (+X) side.
 */
import fs from 'node:fs';
import { launch, sleep, until } from './boot.mjs';

const [out, list] = process.argv.slice(2);
if (!out || !list) {
  console.error("usage: node tools/look/plane.mjs <outdir> 'name:az:el:dist[:ty[:tz[:hour]]],...'");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 720);
const URL = (process.env.URL ?? 'http://localhost:5199/') + '?plane-lab';
const browser = await launch({ W, H });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: +(process.env.DPR ?? 1) });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await until(page, () => window.__planeLab?.ready === true, null, 60000, 'the plane lab');
  for (const item of list.split(',')) {
    const [name, az, el, dist, ty = '1.4', tz = '0', hour = '11'] = item.split(':');
    await page.evaluate(([az, el, dist, ty, tz, hour]) => {
      window.__planeLab.time(+hour);
      window.__planeLab.view(+az, +el, +dist, +ty, +tz);
    }, [az, el, dist, ty, tz, hour]);
    await sleep(900);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`${out}/${name}.png`);
  }
} finally {
  await browser.close();
}
