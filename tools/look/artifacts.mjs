/**
 * tools/look/artifacts.mjs — screenshots of the artefact gallery (`?artifact-gallery`).
 *
 *   npm run dev -- --port 5199          (in another terminal)
 *   node tools/look/artifacts.mjs <outdir> 'name:index[:hour],...'
 *
 * Index -1 is the overview; 0.. are the specimens, kind by kind, variants in turn.
 */
import fs from 'node:fs';
import { launch, sleep, until } from './boot.mjs';

const [out, list] = process.argv.slice(2);
if (!out || !list) {
  console.error("usage: node tools/look/artifacts.mjs <outdir> 'name:index[:hour],...'");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 720);
const URL = (process.env.URL ?? 'http://localhost:5199/') + '?artifact-gallery';
const browser = await launch({ W, H });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: +(process.env.DPR ?? 1) });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await until(page, () => window.__artifactGallery?.ready === true, null, 60000, 'the artefact gallery');
  for (const item of list.split(',')) {
    const [name, index, hour = '11'] = item.split(':');
    await page.evaluate(([index, hour]) => {
      window.__artifactGallery.time(+hour);
      window.__artifactGallery.view(+index);
    }, [index, hour]);
    await sleep(900);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`${out}/${name}.png`);
  }
} finally {
  await browser.close();
}
