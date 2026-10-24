/**
 * tools/look/draws.mjs
 *
 * What a frame's draw calls and shader programs are spent on: boots into the car at a
 * tier, jumps to each km in turn, and once the world there has settled draws one frame
 * and prints the renderer's totals (calls, triangles, linked programs) and the owners
 * with the most draws (grouped by the nearest named ancestor and the material type), and
 * every program linked so far by its material type and name. Run it before and after a
 * material change to see what the change bought.
 *
 *   node tools/look/draws.mjs 'km:hour,...'   (default '3:12,21:12,40:22')
 *
 * Environment as far.mjs (URL SEED TIER W H DPR); TOP: how many owners to list (25).
 */
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const stops = (process.argv[2] ?? '3:12,21:12,40:22').split(',');
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 720);
const TOP = +(process.env.TOP ?? 25);
const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL: process.env.URL ?? 'http://localhost:5199/', W, H, DPR: +(process.env.DPR ?? 1),
    SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  for (const stop of stops) {
    const [km, hour] = stop.split(':');
    await page.evaluate(([km, hour]) => {
      const b = window.__bro;
      b.world.apply({ t: 'time_of_day', timeOfDay: +hour * 60 });
      b.jumpTo(+km);
    }, [km, hour]);
    await until(page, () => window.__bro.settled(), null, 120000, `the world at ${km} km`);
    await sleep(2500);
    if (process.env.PROGRAMS === '1') await page.evaluate(() => { window.__drawsPrograms = true; });
    const report = await page.evaluate((top) => {
      const b = window.__bro;
      const r = b.renderer.renderer;
      const scene = b.renderer.scene;
      const groups = new Map();
      scene.traverseVisible((o) => {
        if (!o.isMesh && !o.isPoints && !o.isLine) return;
        if (o.layers.mask === 4) return; // the kit's pick proxies: never drawn
        let named = '';
        for (let p = o; p; p = p.parent) if (p.name) { named = p.name; break; }
        const m = [].concat(o.material)[0];
        // An unnamed material is told by what it is made of, to find it in the source.
        const what = m.name ? ' ' + m.name
          : ` ${m.color ? '#' + m.color.getHexString() : ''}${m.map ? ' map' : ''}${m.vertexColors ? ' vc' : ''}` +
            `${m.flatShading ? ' flat' : ''}${m.transparent ? ' tr' : ''}${m.roughness !== undefined ? ' r' + m.roughness : ''}`;
        const k = `${named || '?'}  ${m.type}${what}${o.isInstancedMesh ? ' [inst]' : ''}`;
        groups.set(k, (groups.get(k) ?? 0) + 1);
      });
      const rows = [...groups].sort((a, b) => b[1] - a[1]).slice(0, top)
        .map(([k, n]) => `${String(n).padStart(5)}  ${k}`);
      const programs = new Map();
      for (const p of r.info.programs ?? []) {
        const key = p.name || p.cacheKey.split(',')[0];
        programs.set(key, (programs.get(key) ?? 0) + 1);
      }
      const progRows = [...programs].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${String(n).padStart(4)}  ${k}`);
      // Which materials in the scene draw with which program (PROGRAMS=1): the lit
      // program only, the depth ones are three's own.
      if (window.__drawsPrograms) {
        const users = new Map();
        const describe = (m) => `${m.type}${m.name ? ' ' + m.name : ''}${m.color ? ' #' + m.color.getHexString() : ''}` +
          `${m.map ? ' map' : ''}${m.vertexColors ? ' vc' : ''}${m.flatShading ? ' flat' : ''}${m.transparent ? ' tr' : ''}`;
        scene.traverse((o) => {
          for (const m of [].concat(o.material ?? [])) {
            const prog = r.properties.get(m).currentProgram;
            if (!prog) continue;
            const set = users.get(prog) ?? new Set();
            set.add(describe(m) + (o.isInstancedMesh ? ' [inst]' : '') + (o.isSkinnedMesh ? ' [skin]' : ''));
            users.set(prog, set);
          }
        });
        progRows.push('-- programs and their materials');
        let i = 0;
        for (const p of r.info.programs ?? []) {
          const set = users.get(p);
          progRows.push(`#${i++} ${p.name}: ${set ? [...set].slice(0, 6).join(' | ') + (set.size > 6 ? ` (+${set.size - 6})` : '') : '(none in scene)'}`);
        }
      }
      return `info ${JSON.stringify(r.info.render)}  programs ${r.info.programs?.length}\n` +
        `-- meshes by owner (visible, not culled)\n${rows.join('\n')}\n-- programs by material\n${progRows.join('\n')}`;
    }, TOP);
    console.log(`=== km ${km} h${hour}\n${report}`);
  }
} finally {
  await browser.close();
}
