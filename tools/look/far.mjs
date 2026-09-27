/**
 * tools/look/far.mjs
 *
 * Screenshots of the real game at far stretches of the road, for judging the land, the
 * sky and the distance by eye. Headless Chrome on the Metal backend, so it renders the
 * same shaders the player sees.
 *
 *   npm run dev -- --port 5199          (in another terminal)
 *   node tools/look/far.mjs <outdir> 'km:hour[:look],...'
 *
 * `look` is `road` (default, the chase camera behind the car), `sun`, `anti` (toward
 * and away from the sun), or `y<radians>` for an absolute camera yaw.
 *
 * Environment:
 *   URL    dev server (default http://localhost:5199/)
 *   SEED   world seed typed into New Drive (default 'flick')
 *   TIER   acceptable | standard | blessing; the menu's Low/Medium/High (default: as boot picks)
 *   PITCH  camera pitch, radians, positive looks up (default 0.12: horizon in frame)
 *   W H DPR  viewport (default 1280x600 at 1)
 *
 * THE WORLD IS WAITED FOR, NOT SLEPT ON. `__bro.jumpTo(km)` holds the car on the road
 * until every visual tile has attached and no streaming job is pending, and the game
 * reprojects its road position after any jump (main.ts, JUMP_REPROJECT_M), so the vista
 * and the palette are at the new kilometre. Rebuilding this from `rescueTo` and fixed
 * sleeps went wrong every time: cars falling through unstreamed ground, far hills in
 * the last kilometre's colours. Do not reintroduce that; extend the hook instead.
 *
 * Kill the dev server when done: the user runs their own.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [out, list] = process.argv.slice(2);
if (!out || !list) {
  console.error("usage: node tools/look/far.mjs <outdir> 'km:hour[:look],...'");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 600);
const URL = process.env.URL ?? 'http://localhost:5199/';
const PITCH = +(process.env.PITCH ?? 0.12);
const HORIZON_M = { acceptable: 1500, standard: 8000, blessing: 25000 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(page, fn, arg, timeoutMs, what) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await page.evaluate(fn, arg)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', `--window-size=${W},${H}`],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: +(process.env.DPR ?? 1) });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (/error|shader/i.test(t)) console.log('console: ' + t.slice(0, 800));
  });
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });

  const hasNewDrive = () => [...document.querySelectorAll('button')].some((b) => b.textContent === 'New Drive');
  await until(page, hasNewDrive, null, 30000, 'the menu');
  const seedInput = await page.$('input[placeholder^="blank = random"]');
  if (seedInput) {
    await seedInput.click({ clickCount: 3 });
    await seedInput.type(process.env.SEED ?? 'flick');
  }
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'New Drive')?.click());
  await until(page, () => !!window.__bro, null, 60000, 'the game');
  // The boot cover measures the GPU and may still change the tier underneath; nothing
  // is set until it has gone (app/bootwarmup.ts hides it last).
  await until(
    page,
    () => document.getElementById('launch-loading')?.classList.contains('is-hidden') ?? true,
    null,
    90000,
    'the boot cover',
  );
  await until(page, () => window.__bro.settled(), null, 60000, 'the opening world');

  // Into the nearest car: the chase camera is what the player looks through.
  await page.evaluate(() => {
    const b = window.__bro;
    const p = b.player.position;
    let best = null;
    let bestD = Infinity;
    for (const [id, v] of b.vehicles) {
      const t = v.chassis.translation();
      const d = (t.x - p.x) ** 2 + (t.z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    }
    if (best) b.world.apply({ t: 'enter_car', carId: best });
  });

  if (process.env.TIER) {
    const metres = HORIZON_M[process.env.TIER];
    if (!metres) throw new Error(`unknown TIER ${process.env.TIER}`);
    await page.evaluate(([tier, m]) => {
      const b = window.__bro;
      b.world.apply({ t: 'settings', settings: { ...b.world.state.settings, graphicsQuality: tier } });
      b.renderer.setViewDistance(m);
      b.vista.setViewDistance(m);
    }, [process.env.TIER, metres]);
  }

  for (const item of list.split(',')) {
    const [km, hour, look = 'road'] = item.split(':');
    await page.evaluate(([km, hour]) => {
      const b = window.__bro;
      b.world.apply({ t: 'time_of_day', timeOfDay: +hour * 60 });
      b.weather.force(null);
      b.jumpTo(+km);
    }, [km, hour]);
    await until(page, () => window.__bro.settled(), null, 120000, `the world at ${km} km`);
    await page.evaluate(([look, pitch]) => {
      const b = window.__bro;
      const d = b.sky.sunDirection;
      const sign = look === 'sun' ? 1 : look === 'anti' ? -1 : 0;
      if (sign !== 0) b.camera.setYaw(Math.atan2(d.x * sign, d.z * sign));
      if (look[0] === 'y') b.camera.setYaw(+look.slice(1));
      // Private in TypeScript only; the rig re-reads these every frame.
      b.camera.pitch = b.camera.drivingPitch = pitch;
    }, [look, PITCH]);
    // The camera's own easing and the exposure's adaptation.
    await sleep(1500);
    const name = `${out}/km${km}-h${hour}-${look}.png`;
    await page.screenshot({ path: name });
    const info = await page.evaluate(() => {
      const b = window.__bro;
      const s = b.sky;
      return {
        s: Math.round(b.world.state.player.s ?? b.player.s),
        el: +s.sunElevation.toFixed(3),
        fog: '#' + b.renderer.fog.color.getHexString(),
        weatherFog: +b.renderer.fog.density.toFixed(6),
        kind: b.weather.now.kind,
      };
    });
    console.log(name, JSON.stringify(info));
  }
} finally {
  await browser.close();
}
