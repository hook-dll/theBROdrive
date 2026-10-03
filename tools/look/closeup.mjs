/**
 * tools/look/closeup.mjs: close-ups of cars in the car lab, under the game's renderer.
 *
 *   node tools/look/closeup.mjs <outdir> <shots.json>
 *
 * shots.json: [{ "id": "rs_citroends", "name": "apillar", "at": [x, y, z], "d": 2.2,
 * "az": 35, "el": 25 }, ...] (at in metres in the car's frame: across, up, along with
 * the nose at -z; angles in degrees). Kill the preview server afterwards.
 */
import fs from 'node:fs';
import { launch, until } from './boot.mjs';

const [out, file] = process.argv.slice(2);
const shots = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1200);
const H = +(process.env.H ?? 800);
const URL = process.env.URL ?? 'http://localhost:5199/';
const browser = await launch({ W, H });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(`${URL}?car-lab&time=15`, { waitUntil: 'load', timeout: 60000 });
  await until(page, () => !!window.__carLab, null, 120000, 'the car lab');
  await new Promise((r) => setTimeout(r, 4000));
  for (const s of shots) {
    const png = await page.evaluate((s) => {
      window.__carLab.closeUp(s.id, s.at, s.d, (s.az * Math.PI) / 180, (s.el * Math.PI) / 180);
      window.__carLab.capture();
      return window.__carLab.capture();
    }, s);
    fs.writeFileSync(`${out}/${s.id}-${s.name}.png`, Buffer.from(png.split(',')[1], 'base64'));
  }
  console.log(`${shots.length} shots`);
} finally {
  await browser.close();
}
