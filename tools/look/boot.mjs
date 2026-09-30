/**
 * tools/look/boot.mjs
 *
 * The shared start of every look tool: headless Chrome on Metal, the menu, a New Drive,
 * the boot cover gone, the opening world settled, the player in the nearest car, the
 * graphics tier set. far.mjs and hitch.mjs both begin here, so neither re-invents it.
 */
import puppeteer from 'puppeteer-core';

export const HORIZON_M = { retro: 1500, acceptable: 1500, standard: 8000, blessing: 25000 };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(page, fn, arg, timeoutMs, what) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await page.evaluate(fn, arg)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export async function launch({ W, H }) {
  return puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: [
      '--use-angle=metal',
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--autoplay-policy=no-user-gesture-required',
      `--window-size=${W},${H}`,
    ],
  });
}

/** Menu → New drive → settled world → in the nearest car → tier. Returns the page. */
export async function bootIntoCar(browser, { URL, W, H, DPR = 1, SEED = 'flick', TIER }) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (/error|shader/i.test(t)) console.log('console: ' + t.slice(0, 800));
  });
  // The tier goes into the stored preferences BEFORE the page runs, which is the path a
  // player's own choice takes: the renderer, the light budget and the retro rung all
  // read it at construction. Setting it on the live state afterwards changed the menu's
  // idea of the tier and nothing the GPU was doing — the shadows and the MSAA of
  // whatever the launch had picked stayed on. Stored as `chosen` so no launch
  // measurement moves it; each launch is a fresh browser profile.
  if (TIER) {
    if (!HORIZON_M[TIER]) throw new Error(`unknown TIER ${TIER}`);
    await page.evaluateOnNewDocument((tier) => {
      const key = 'brodrive-settings-v1';
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { /* fresh */ }
      localStorage.setItem(key, JSON.stringify({
        ...stored,
        graphicsQuality: tier,
        graphicsQualitySource: 'chosen',
        msaa: tier === 'standard' || tier === 'blessing',
      }));
    }, TIER);
  }
  // The title screen has no seed field: the world is pinned by the URL instead.
  const url = new globalThis.URL(URL);
  url.searchParams.set('seed', SEED);
  await page.goto(url.href, { waitUntil: 'load', timeout: 60000 });

  const hasNewDrive = () => [...document.querySelectorAll('button')].some((b) => b.textContent === 'New drive');
  await until(page, hasNewDrive, null, 30000, 'the menu');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'New drive')?.click());
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

  return page;
}
