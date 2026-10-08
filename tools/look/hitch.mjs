/**
 * tools/look/hitch.mjs
 *
 * Hunts hitches — the world freezing for a moment — on a real autopilot drive in the
 * real game. Every presented-frame gap over 100 ms is recorded by the dev frame profiler
 * (core/frameprofiler.ts, `__broSpikes`) with the sections of the frame that closed it;
 * a gap no section accounts for happened between frames (GC, a message handler, a
 * shader compiled outside `draw`).
 *
 * Smaller unevenness is logged too: every 30 s of driving prints the hour, the frame
 * interval's median, 99th percentile and worst, how many frames ran past 25 and 50 ms,
 * the adaptive resolution scale and whether the sun's and the headlamps' shadow maps
 * were being drawn — so a rough patch can be pinned to the time of day it happened at.
 * New shader programs linked during a draw are counted the same way.
 *
 *   npm run build:dev && npx vite preview --port 5199   (in another terminal)
 *   node tools/look/hitch.mjs [minutes]  (default 4)
 *
 * A BUILD, not `npm run dev`: an edit saved while the drive runs hot-reloads the page
 * under it, and the drive dies with `__bro` undefined. A development build keeps the
 * profiler (`import.meta.env.DEV`) and nothing reloads it.
 *
 * Environment as far.mjs (URL SEED TIER W H DPR), plus MODE: the autopilot mode
 * (default 'hurried'); KM: where on the road the drive starts (default 3); DAY: the
 * day+night cycle in real minutes (8 is the shortest the game allows; unset keeps the
 * default); HOUR: the hour to start at; HEADED=1: a visible window (boot.mjs). Kill the
 * server when done: the user runs their own.
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
  await page.evaluate(([mode, day, hour]) => {
    const b = window.__bro;
    if (day > 0) b.world.apply({ t: 'settings', settings: { ...b.state().settings, dayCycleMinutes: day } });
    if (hour >= 0) b.world.apply({ t: 'time_of_day', timeOfDay: hour * 60 });
    b.autopilot.setMode(mode);
    b.autopilot.setEngaged(true);
    window.__broSpikes.length = 0;

    // Frame pacing, measured where the player sees it: the interval between animation
    // frames, kept per window and drained by the node side.
    const pace = (window.__broPace = { gaps: [], programs: 0 });
    let last = 0;
    const tick = (now) => {
      if (last > 0) pace.gaps.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const r = b.renderer.renderer;
    const render = r.render.bind(r);
    r.render = (scene, camera) => {
      const before = r.info.programs.length;
      render(scene, camera);
      pace.programs += Math.max(0, r.info.programs.length - before);
    };
  }, [process.env.MODE ?? 'hurried', +(process.env.DAY ?? 0), +(process.env.HOUR ?? -1)]);

  const seen = new Set();
  const endAt = Date.now() + minutes * 60_000;
  let windowStart = Date.now();
  let gaps = [];
  let programs = 0;
  const flags = { sun: 0, lamp: 0, samples: 0 };
  while (Date.now() < endAt) {
    await sleep(5000);
    const state = await page.evaluate(() => {
      const b = window.__bro;
      const pace = window.__broPace;
      const gaps = pace.gaps;
      pace.gaps = [];
      const programs = pace.programs;
      pace.programs = 0;
      const lights = b.vehicleLights;
      const lamp = lights.shadowLight ?? null;
      return {
        // The autopilot's own road position: `player.s` is only reprojected on foot.
        s: Math.round(b.autopilot.hintS),
        kmh: Math.round(Math.hypot(b.autopilot.controlledVehicle?.chassis.linvel().x ?? 0, b.autopilot.controlledVehicle?.chassis.linvel().z ?? 0) * 3.6),
        weather: b.weather.now.kind,
        hour: b.state().timeOfDay / 60,
        scale: b.renderer.resolutionScale,
        sunShadow: b.sky.sunLight.shadow.autoUpdate && b.sky.sunLight.shadow.intensity > 0,
        lampShadow: lamp !== null && lamp.shadow.autoUpdate,
        spikes: window.__broSpikes.slice(),
        gaps,
        programs,
      };
    });
    for (const spike of state.spikes) {
      if (seen.has(spike.atMs)) continue;
      seen.add(spike.atMs);
      console.log(`hitch ${spike.gapMs} ms at s=${state.s} h=${state.hour.toFixed(2)} (${state.weather})`, JSON.stringify(spike.sections), spike.note ?? '');
    }
    gaps = gaps.concat(state.gaps);
    programs += state.programs;
    flags.samples++;
    if (state.sunShadow) flags.sun++;
    if (state.lampShadow) flags.lamp++;
    if (Date.now() - windowStart >= 30_000) {
      const sorted = gaps.slice().sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      const over = (ms) => gaps.filter((g) => g > ms).length;
      const shadows = `${flags.sun === flags.samples ? 'sun' : flags.sun > 0 ? 'sun~' : '-'}/${flags.lamp === flags.samples ? 'lamp' : flags.lamp > 0 ? 'lamp~' : '-'}`;
      console.log(
        `h=${state.hour.toFixed(2)} s=${state.s} ${state.kmh} km/h ${state.weather} scale=${state.scale.toFixed(2)} shadows=${shadows}`
          + ` frames=${gaps.length} p50=${at(0.5).toFixed(1)} p99=${at(0.99).toFixed(1)} max=${(sorted.at(-1) ?? 0).toFixed(0)}`
          + ` >25ms=${over(25)} >50ms=${over(50)} programs=${programs}`,
      );
      windowStart = Date.now();
      gaps = [];
      programs = 0;
      flags.sun = flags.lamp = flags.samples = 0;
    }
  }
  console.log(`${seen.size} hitches over ${minutes} min`);
} finally {
  await browser.close();
}
