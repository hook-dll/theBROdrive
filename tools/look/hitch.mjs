/**
 * tools/look/hitch.mjs
 *
 * Hunts hitches — the world freezing for a moment — on a real autopilot drive in the
 * real game. Every presented-frame gap over 100 ms is recorded by the dev frame profiler
 * (core/frameprofiler.ts, `__broSpikes`) with the sections of the frame that closed it;
 * a gap no section accounts for happened between frames (GC, a message handler, a
 * shader compiled outside `draw`).
 *
 *   npm run build:dev && npx vite preview --port 5199   (in another terminal)
 *   node tools/look/hitch.mjs [minutes]  (default 4)
 *
 * A BUILD, not `npm run dev`: an edit saved while the drive runs hot-reloads the page
 * under it, and the drive dies with `__bro` undefined. A development build keeps the
 * profiler (`import.meta.env.DEV`) and nothing reloads it.
 *
 * Environment as far.mjs (URL SEED TIER W H DPR), plus MODE: the autopilot mode
 * (default 'hurried'), and KM: where on the road the drive starts (default 3). Kill the dev server when done: the user runs their own.
 */
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const minutes = +(process.argv[2] ?? 4);
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 600);
const URL = process.env.URL ?? 'http://localhost:5199/';

const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL, W, H, DPR: +(process.env.DPR ?? 1), SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  // The start car sits in a garage the autopilot does not drive out of: onto the road.
  await page.evaluate((km) => window.__bro.jumpTo(km), +(process.env.KM ?? 3));
  await until(page, () => window.__bro.settled(), null, 120000, 'the world at the start');
  await page.evaluate((mode) => {
    const b = window.__bro;
    b.autopilot.setMode(mode);
    b.autopilot.setEngaged(true);
    window.__broSpikes.length = 0;
  }, process.env.MODE ?? 'hurried');

  const seen = new Set();
  const endAt = Date.now() + minutes * 60_000;
  while (Date.now() < endAt) {
    await sleep(5000);
    const state = await page.evaluate(() => {
      const b = window.__bro;
      return {
        // The autopilot's own road position: `player.s` is only reprojected on foot.
        s: Math.round(b.autopilot.hintS),
        kmh: Math.round(Math.hypot(b.autopilot.controlledVehicle?.chassis.linvel().x ?? 0, b.autopilot.controlledVehicle?.chassis.linvel().z ?? 0) * 3.6),
        weather: b.weather.now.kind,
        spikes: window.__broSpikes.slice(),
      };
    });
    for (const spike of state.spikes) {
      if (seen.has(spike.atMs)) continue;
      seen.add(spike.atMs);
      console.log(`hitch ${spike.gapMs} ms at s=${state.s} (${state.weather})`, JSON.stringify(spike.sections), spike.note ?? '');
    }
    process.stdout.write(`  s=${state.s} m, ${state.kmh} km/h, ${state.weather}\n`);
  }
  console.log(`${seen.size} hitches over ${minutes} min`);
} finally {
  await browser.close();
}
