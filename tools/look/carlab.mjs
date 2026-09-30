/**
 * tools/look/carlab.mjs
 *
 * Car-lab portraits: each named model framed on its own from a set of azimuths, under
 * the game's renderer and sky (`?car-lab`, dev builds only), written as PNGs. For
 * judging a body against another at the same angle and light.
 *
 *   npm run build:dev && npx vite preview --port 5199   (in another terminal)
 *   node tools/look/carlab.mjs <outdir> <modelId ...>
 *
 * AZ is a comma list of azimuths in degrees (default 35,90,150). W H as far.mjs.
 * Kill the preview server when done: the user runs their own.
 */
import fs from 'node:fs';
import { launch, until } from './boot.mjs';

const [out, ...models] = process.argv.slice(2);
if (!out || models.length === 0) {
  console.error('usage: node tools/look/carlab.mjs <outdir> <modelId ...>');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1200);
const H = +(process.env.H ?? 700);
const URL = process.env.URL ?? 'http://localhost:5199/';
const AZ = (process.env.AZ ?? '35,90,150').split(',').map(Number);

const browser = await launch({ W, H });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(`${URL}?car-lab&time=15`, { waitUntil: 'load', timeout: 60000 });
  await until(page, () => !!window.__carLab, null, 120000, 'the car lab');
  await new Promise((r) => setTimeout(r, 4000));
  for (const id of models) {
    for (const az of AZ) {
      const png = await page.evaluate(
        (m, a) => {
          window.__carLab.focus(m, (a * Math.PI) / 180);
          return window.__carLab.capture();
        },
        id,
        az,
      );
      fs.writeFileSync(`${out}/${id}-${az}.png`, Buffer.from(png.split(',')[1], 'base64'));
    }
    console.log(`${id}: ${AZ.length} views`);
  }
} finally {
  await browser.close();
}
