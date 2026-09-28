/**
 * tools/sound/levels.mjs — how loud each bus is in the real game, by scenario.
 *
 *   npm run dev -- --port 5199          (in another terminal)
 *   node tools/sound/levels.mjs [scenarios]   default: idle,drive,cabin,storm,thunder,night,radio
 *
 * `thunder` fires a near and a far stroke on demand (`__bro.audio.thunder`); `night`
 * stands still at 23:00 in clear weather. Sound files that fail to load are reported.
 *
 * Boots into the car (tools/look/boot.mjs), sets every volume slider to 100 %, and for
 * each scenario samples `__bro.audio.meter()` five times a second: per bus, the median
 * and loudest K-weighted loudness (LUFS-ish, ~0.7 s windows) and the highest peak. The
 * targets it is read against are in src/audio/mixer.ts (GAIN STAGING). `out` is after
 * the limiter: if its peak sits at -1 dBFS while `master` goes higher, the limiter
 * worked for it.
 *
 * Environment: URL, SEED, KM (default 3). Kill the dev server when done.
 */
import { bootIntoCar, launch, sleep, until } from '../look/boot.mjs';

const list = (process.argv[2] ?? 'idle,drive,cabin,storm,thunder,night,radio').split(',');
const URL = process.env.URL ?? 'http://localhost:5199/';
const browser = await launch({ W: 960, H: 540 });

async function sample(page, seconds) {
  const rows = [];
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    rows.push(await page.evaluate(() => window.__bro.audio.meter()));
    await sleep(200);
  }
  const buses = Object.keys(rows[0]);
  const out = {};
  for (const bus of buses) {
    const l = rows.map((r) => r[bus].lufs).filter((v) => v > -90).sort((a, b) => a - b);
    const p = Math.max(...rows.map((r) => r[bus].peakDb));
    out[bus] = l.length
      ? `${l[Math.floor(l.length / 2)].toFixed(1).padStart(6)} med ${l[l.length - 1].toFixed(1).padStart(6)} max  pk ${p.toFixed(1).padStart(6)}`
      : '   silent';
  }
  return out;
}

try {
  const page = await bootIntoCar(browser, { URL, W: 960, H: 540, SEED: process.env.SEED ?? 'flick' });
  page.on('console', (m) => {
    if (/sound .* failed|limiter|worklet/i.test(m.text())) console.log('console: ' + m.text());
  });
  await page.evaluate((km) => {
    const b = window.__bro;
    const settings = { ...b.world.state.settings, masterVolume: 1, carVolume: 1, worldVolume: 1, radioVolume: 1 };
    b.world.apply({ t: 'settings', settings });
    b.audio.applySettings(settings);
    b.world.apply({ t: 'time_of_day', timeOfDay: 13 * 60 });
    b.weather.force('clear');
    b.jumpTo(km);
  }, +(process.env.KM ?? 3));
  await until(page, () => window.__bro.settled(), null, 120000, 'the world');
  // The context unlocks on a gesture.
  await page.keyboard.press('Shift');
  await sleep(1500);

  for (const name of list) {
    await page.evaluate((name) => {
      const b = window.__bro;
      b.camera.setMode(name === 'cabin' ? 'hood' : 'chase');
      if (name === 'idle' || name === 'radio') b.autopilot.setEngaged(false);
      if (name === 'drive' || name === 'cabin' || name === 'storm') {
        b.autopilot.setMode('hurried');
        b.autopilot.setEngaged(true);
      }
      b.weather.force(name === 'storm' ? 'storm' : 'clear', name === 'storm' ? 0.5 : null);
      b.world.apply({ t: 'time_of_day', timeOfDay: (name === 'night' ? 23 : 13) * 60 });
      if (name === 'thunder' || name === 'night') b.autopilot.setEngaged(false);
      if (name === 'thunder') {
        b.audio.thunder(900, 1);
        setTimeout(() => b.audio.thunder(900, -1), 200);
        setTimeout(() => b.audio.thunder(4000, 2), 16000);
      }
      if (name === 'radio') b.audio.cycleRadio(b.world.state.player.drivingCarId);
    }, name);
    await sleep(name === 'storm' ? 8000 : name === 'thunder' ? 0 : 4000);
    const r = await sample(page, name === 'storm' || name === 'thunder' ? 30 : 12);
    const kmh = await page.evaluate(() => {
      const v = window.__bro.vehicles.get(window.__bro.world.state.player.drivingCarId);
      const l = v.chassis.linvel();
      return Math.round(Math.hypot(l.x, l.z) * 3.6);
    });
    console.log(`\n[${name}] ${kmh} km/h${name === 'radio' ? ' ' + (await page.evaluate(() => window.__bro.audio.radioReadout)) : ''}`);
    for (const [bus, line] of Object.entries(r)) console.log(`  ${bus.padEnd(6)} ${line}`);
    if (name === 'radio') await page.evaluate(() => window.__bro.audio.cycleRadio(window.__bro.world.state.player.drivingCarId));
  }
} finally {
  await browser.close();
}
