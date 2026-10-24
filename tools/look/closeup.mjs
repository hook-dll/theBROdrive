/**
 * tools/look/closeup.mjs
 *
 * Close shots of named scenery in the real game: boots into the car, jumps to each km,
 * waits for the world, finds the nearest object of each asked-for name (a node's `name`,
 * e.g. `card-machine`, `barrel-stand`, `key-box`, `lot-sign`, `poi-a-frame`), freezes the
 * simulation and draws it from its front three-quarter and its back three-quarter, near
 * enough to read its parts. Run it before and after a change to the object's build to
 * compare the two sets of pictures.
 *
 *   node tools/look/closeup.mjs <outdir> 'km:hour:name[,name...]' ...
 *
 * Environment as far.mjs (URL SEED TIER W H DPR); DIST: the camera's distance as a
 * multiple of the object's radius (default 2.4); RADIUS: metres to use as that radius
 * instead of the measured one, so a before and an after are framed alike even when the
 * change regrouped the object's meshes.
 */
import { mkdirSync } from 'node:fs';
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const [out, ...stops] = process.argv.slice(2);
if (!out || stops.length === 0) {
  console.error("usage: node tools/look/closeup.mjs <outdir> 'km:hour:name[,name...]' ...");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 720);
const DIST = +(process.env.DIST ?? 2.4);
const RADIUS = process.env.RADIUS ? +process.env.RADIUS : null;
const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL: process.env.URL ?? 'http://localhost:5199/', W, H, DPR: +(process.env.DPR ?? 1),
    SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  for (const stop of stops) {
    const [km, hour, names] = stop.split(':');
    await page.evaluate(([km, hour]) => {
      const b = window.__bro;
      b.loop.start?.();
      b.world.apply({ t: 'time_of_day', timeOfDay: +hour * 60 });
      b.jumpTo(+km);
    }, [km, hour]);
    await until(page, () => window.__bro.settled(), null, 120000, `the world at ${km} km`);
    await sleep(2500);
    for (const name of names.split(',')) {
      for (const view of ['front', 'back']) {
        const found = await page.evaluate(([name, view, dist, fixedRadius]) => {
          const b = window.__bro;
          const r = b.renderer;
          const cam = r.camera;
          let best = null;
          let bestD = Infinity;
          r.scene.traverse((o) => {
            if (o.name !== name && !o.name.startsWith(name + '-')) return;
            if (!o.visible) return;
            const p = o.matrixWorld.elements;
            const d = (p[12] - cam.position.x) ** 2 + (p[14] - cam.position.z) ** 2;
            if (d < bestD) { bestD = d; best = o; }
          });
          if (!best) return null;
          b.loop.stop();
          // The object's bounds by hand: its meshes' world bounding spheres.
          let cx = 0, cy = 0, cz = 0, n = 0, radius = 0;
          const centres = [];
          best.updateMatrixWorld(true);
          best.traverse((o) => {
            if (!o.isMesh || !o.geometry) return;
            if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
            const s = o.geometry.boundingSphere;
            const c = s.center.clone().applyMatrix4(o.matrixWorld);
            const k = Math.max(o.scale.x, o.scale.y, o.scale.z);
            centres.push([c, s.radius * k]);
            cx += c.x; cy += c.y; cz += c.z; n++;
          });
          cx /= n; cy /= n; cz /= n;
          for (const [c, rad] of centres) radius = Math.max(radius, Math.hypot(c.x - cx, c.y - cy, c.z - cz) + rad);
          if (fixedRadius !== null) {
            // Framed on the object's own origin, which no regrouping moves.
            radius = fixedRadius;
            cx = best.matrixWorld.elements[12];
            cy = best.matrixWorld.elements[13] + fixedRadius * 0.8;
            cz = best.matrixWorld.elements[14];
          }
          // The object's own -Z is its front (machines, stands); the view sits 35 degrees off it.
          const e = best.matrixWorld.elements;
          const fx = -e[8], fz = -e[10];
          const len = Math.hypot(fx, fz) || 1;
          const sign = view === 'front' ? 1 : -1;
          const a = Math.atan2(fz / len, fx / len) + sign * 0.6;
          const d = radius * dist;
          cam.position.set(cx + Math.cos(a) * d * sign, cy + radius * 0.35, cz + Math.sin(a) * d * sign);
          cam.lookAt(cx, cy, cz);
          cam.updateMatrixWorld(true);
          r.render();
          return { name: best.name, radius: +radius.toFixed(2) };
        }, [name, view, DIST, RADIUS]);
        if (!found) {
          console.log(`km ${km}: no ${name} in view range`);
          break;
        }
        await sleep(300);
        const file = `${out}/km${km}-${name}-${view}.png`;
        await page.screenshot({ path: file });
        console.log(`${file}  (${found.name}, r=${found.radius} m)`);
      }
    }
  }
} finally {
  await browser.close();
}
