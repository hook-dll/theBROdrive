/**
 * tools/look/franticstats.mjs
 *
 * How well the frantic drivers keep their cars, measured in the real game on the real
 * stream: the player's car runs its own autopilot (MODE, default 'hurried') and every
 * ambient frantic car within physics range is sampled every frame while it is on its
 * wheels and off the rails. Per car, while it was watched:
 *
 *   top      fastest it went, km/h
 *   slip     worst body sideslip at speed (> 15 m/s), degrees: how far the car pointed
 *            away from where it was going. A clean pass stays under 2-3°.
 *   slides   times the sideslip passed SLIDE_DEG
 *   weaves   times the yaw rate swung side to side three times inside WEAVE_WINDOW_S,
 *            each swing past WEAVE_RATE: the sway after a manoeuvre
 *   offroad  seconds its driver reported being off the road
 *
 *   npm run build:dev && npx vite preview --port 5199   (in another terminal)
 *   node tools/look/franticstats.mjs [minutes]  (default 5)
 *
 * Environment as hitch.mjs (URL SEED TIER W H DPR HEADED), plus KM: where on the road
 * the drive starts (default 30: started at 3 km, the player's car stood still).
 * Kill the preview server when done: the user runs their own.
 */
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const minutes = +(process.argv[2] ?? 5);
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 600);
const URL = process.env.URL ?? 'http://localhost:5199/';

const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL, W, H, DPR: +(process.env.DPR ?? 1), SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  await page.evaluate((km) => window.__bro.jumpTo(km), +(process.env.KM ?? 30));
  await until(page, () => window.__bro.settled(), null, 120000, 'the world at the start');
  await page.evaluate((mode) => {
    const b = window.__bro;
    b.autopilot.setMode(mode);
    b.autopilot.setEngaged(true);
    const SLIDE_DEG = 6;
    const WEAVE_RATE = 0.12;
    const WEAVE_WINDOW_S = 3;
    const stats = (window.__franticStats = new Map());
    let last = 0;
    const tick = (now) => {
      requestAnimationFrame(tick);
      const dt = last > 0 ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      for (const car of b.traffic.carList) {
        if (car.style !== 'frantic' || car.rails !== null || car.rival) continue;
        const v = car.vehicle;
        const c = v.chassis;
        const lv = c.linvel();
        const q = c.rotation();
        // Body forward (+Z) and right (+X) in world, from the quaternion.
        const fx = 2 * (q.x * q.z + q.w * q.y);
        const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
        const rx = 1 - 2 * (q.y * q.y + q.z * q.z);
        const rz = 2 * (q.x * q.z - q.w * q.y);
        const along = lv.x * fx + lv.z * fz;
        const across = lv.x * rx + lv.z * rz;
        const speed = Math.hypot(lv.x, lv.z);
        let s = stats.get(car.id);
        if (!s) {
          s = { model: car.modelId, seen: 0, top: 0, slip: 0, slides: 0, sliding: false, weaves: 0, peaks: [], sign: 0, offroad: 0, gearbox: v.gearboxMode };
          stats.set(car.id, s);
        }
        s.seen += dt;
        s.top = Math.max(s.top, speed * 3.6);
        if (car.autopilot.activity === 'offroad') s.offroad += dt;
        if (speed > 15 && along > 0) {
          const slip = Math.abs(Math.atan2(across, along)) * 180 / Math.PI;
          s.slip = Math.max(s.slip, slip);
          if (slip > SLIDE_DEG && !s.sliding) s.slides++;
          s.sliding = slip > SLIDE_DEG * 0.7 ? s.sliding || slip > SLIDE_DEG : false;
          const r = c.angvel().y;
          const sign = r > WEAVE_RATE ? 1 : r < -WEAVE_RATE ? -1 : 0;
          if (sign !== 0 && sign !== s.sign) {
            s.sign = sign;
            s.peaks.push(now);
            while (s.peaks.length > 0 && now - s.peaks[0] > WEAVE_WINDOW_S * 1000) s.peaks.shift();
            if (s.peaks.length >= 3) {
              s.weaves++;
              s.peaks.length = 0;
            }
          }
        }
      }
    };
    requestAnimationFrame(tick);
  }, process.env.MODE ?? 'hurried');

  const endAt = Date.now() + minutes * 60_000;
  while (Date.now() < endAt) {
    await sleep(15000);
    const s = await page.evaluate(() => Math.round(window.__bro.autopilot.hintS));
    process.stdout.write(`  s=${s} m\n`);
  }
  const rows = await page.evaluate(() =>
    [...window.__franticStats.entries()].map(([id, s]) => ({
      id, model: s.model, seen: +s.seen.toFixed(1), top: Math.round(s.top), slip: +s.slip.toFixed(1),
      slides: s.slides, weaves: s.weaves, offroad: +s.offroad.toFixed(1),
    })),
  );
  const watched = rows.filter((r) => r.seen >= 3);
  for (const r of watched) console.log(JSON.stringify(r));
  const sum = (k) => watched.reduce((a, r) => a + r[k], 0);
  const seconds = sum('seen');
  console.log(
    `${watched.length} frantic cars, ${seconds.toFixed(0)} s watched: top ${Math.max(0, ...watched.map((r) => r.top))} km/h,`
      + ` slides ${sum('slides')} (${(sum('slides') / Math.max(1, seconds) * 60).toFixed(2)}/min),`
      + ` weaves ${sum('weaves')} (${(sum('weaves') / Math.max(1, seconds) * 60).toFixed(2)}/min),`
      + ` offroad ${sum('offroad').toFixed(1)} s, worst slip ${Math.max(0, ...watched.map((r) => r.slip)).toFixed(1)}°`,
  );
} finally {
  await browser.close();
}
