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
import fs from 'node:fs';
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

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

const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL, W, H, DPR: +(process.env.DPR ?? 1), SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });

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
